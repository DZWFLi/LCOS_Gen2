import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

async function startServer(): Promise<{ baseUrl: string }> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-cr-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'cr-project' as never, name: 'CR', rootPath: projectRoot })
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository, apiToken: 'test-cr-token' })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: `http://${address.host}:${address.port}` }
}

const HEADERS = { authorization: 'Bearer test-cr-token', 'content-type': 'application/json' }

async function call(baseUrl: string, path: string, body: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: HEADERS,
    body: method === 'GET' ? undefined : JSON.stringify(body),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

async function createText(baseUrl: string, body: string, sessionId?: string): Promise<{ viewId: string; artifactId: string }> {
  const result = await call(baseUrl, '/projects/cr-project/curation/text', {
    scopeId: 'scope-cr-project-root',
    title: 'doc',
    body,
    ...(sessionId === undefined ? {} : { sessionId }),
  })
  expect(result.status).toBe(200)
  return { viewId: result.json.value.viewId, artifactId: result.json.value.artifactId }
}

async function readBody(baseUrl: string, viewId: string): Promise<string> {
  const read = await call(baseUrl, '/projects/cr-project/curation/read', { viewIds: [viewId] })
  expect(read.status).toBe(200)
  return String(read.json.value.nodes[0]?.boundedText ?? '')
}

async function latestChangeSet(baseUrl: string): Promise<{ id: string; changes: Array<Record<string, unknown>>; actorKind: string; actorId?: string }> {
  const list = await call(baseUrl, '/projects/cr-project/change-sets', undefined, 'GET')
  expect(list.status).toBe(200)
  const items = list.json.value as Array<{ id: string; changes: Array<Record<string, unknown>>; actorKind: string; actorId?: string }>
  return items[0]
}

describe('change-review 后端 · agent 文本修订（任务四 P1）', () => {
  it('agent 经 CAS 通道修订 → 记 artifact_text_update ChangeSet（actor 归因 + before/after 修订）', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'v1 body')
    await call(baseUrl, '/projects/cr-project/curation/read', { viewIds: [viewId], sessionId: 's1', readMode: 'full' })
    const update = await call(baseUrl, '/projects/cr-project/curation/text', { viewId, sessionId: 's1', body: 'v2 by agent' }, 'PUT')
    expect(update.status).toBe(200)

    const changeSet = await latestChangeSet(baseUrl)
    expect(changeSet.actorKind).toBe('agent')
    expect(changeSet.actorId).toBe('s1')
    const item = changeSet.changes.find((change) => change.type === 'artifact_text_update')
    expect(item).toBeDefined()
    expect(item!.inverse).toMatchObject({ type: 'restore_artifact_text' })
    expect(item!.beforeRevisionId).not.toBe(item!.afterRevisionId)
    expect(item!.forward).toMatchObject({ type: 'restore_artifact_text' })
  })

  it('GUI 直编（无 sessionId）不记账——用户自己的动作不是 review 项', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'v1 body')
    const direct = await call(baseUrl, '/projects/cr-project/curation/text', { viewId, body: 'user edit' }, 'PUT')
    expect(direct.status).toBe(200)
    const list = await call(baseUrl, '/projects/cr-project/change-sets', undefined, 'GET')
    expect(list.json.value).toHaveLength(0)
  })

  it('revert 把 current 指回 before（正文恢复 v1）；reapply 恢复 agent 版（v2）', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'v1 body')
    await call(baseUrl, '/projects/cr-project/curation/read', { viewIds: [viewId], sessionId: 's1', readMode: 'full' })
    await call(baseUrl, '/projects/cr-project/curation/text', { viewId, sessionId: 's1', body: 'v2 by agent' }, 'PUT')
    const changeSet = await latestChangeSet(baseUrl)

    const revert = await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/revert`, {})
    expect(revert.status).toBe(200)
    expect(revert.json.value.status).toBe('reverted')
    expect(await readBody(baseUrl, viewId)).toBe('v1 body')

    const reapply = await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/reapply`, {})
    expect(reapply.status).toBe(200)
    expect(reapply.json.value.status).toBe('applied')
    expect(await readBody(baseUrl, viewId)).toBe('v2 by agent')
  })

  it('agent 写之后有人再写 → revert 409（绝不覆盖新工作）', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'v1 body')
    await call(baseUrl, '/projects/cr-project/curation/read', { viewIds: [viewId], sessionId: 's1', readMode: 'full' })
    await call(baseUrl, '/projects/cr-project/curation/text', { viewId, sessionId: 's1', body: 'v2 by agent' }, 'PUT')
    // 用户直编 → current 前进到 v3
    await call(baseUrl, '/projects/cr-project/curation/text', { viewId, body: 'v3 by user' }, 'PUT')
    const changeSet = await latestChangeSet(baseUrl)
    const revert = await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/revert`, {})
    expect(revert.status).toBe(409)
    expect(revert.json.error.message).toContain('refusing to overwrite newer work')
  })

  it('revert 之后有人基于恢复版再写 → reapply 409', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'v1 body')
    await call(baseUrl, '/projects/cr-project/curation/read', { viewIds: [viewId], sessionId: 's1', readMode: 'full' })
    await call(baseUrl, '/projects/cr-project/curation/text', { viewId, sessionId: 's1', body: 'v2 by agent' }, 'PUT')
    const changeSet = await latestChangeSet(baseUrl)
    await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/revert`, {})
    // 用户在恢复版上再写
    await call(baseUrl, '/projects/cr-project/curation/text', { viewId, body: 'v3 by user' }, 'PUT')
    const reapply = await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/reapply`, {})
    expect(reapply.status).toBe(409)
  })
})

describe('change-review 后端 · agent 文本创建（任务四 P1）', () => {
  it('agent 带 sessionId 创建 → 记 artifact_text_create；revert 删除节点', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'agent created body', 's-create')
    const changeSet = await latestChangeSet(baseUrl)
    expect(changeSet.actorKind).toBe('agent')
    const item = changeSet.changes.find((change) => change.type === 'artifact_text_create')
    expect(item).toBeDefined()
    expect(item!.inverse).toMatchObject({ type: 'delete_artifact' })

    expect(await readBody(baseUrl, viewId)).toBe('agent created body')
    const revert = await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/revert`, {})
    expect(revert.status).toBe(200)
    // 节点已删：read 不再返回该 view
    const read = await call(baseUrl, '/projects/cr-project/curation/read', { viewIds: [viewId] })
    expect(read.json.value.nodes).toHaveLength(0)
  })

  it('创建被后人编辑过 → revert 409（防误删用户后续工作，huabu CREATE fingerprint 纪律）', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'agent created body', 's-create')
    // 用户在 GUI 改正文（current 前进，contentHash 变）
    await call(baseUrl, '/projects/cr-project/curation/text', { viewId, body: 'user enriched' }, 'PUT')
    const changeSet = await latestChangeSet(baseUrl)
    const revert = await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/revert`, {})
    expect(revert.status).toBe(409)
    expect(revert.json.error.message).toContain('refusing to overwrite newer work')
  })

  it('artifact_text_create 是 undo-only：reapply 返回 FORWARD_STATE_UNAVAILABLE 语义的 409', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, 'agent created body', 's-create')
    const changeSet = await latestChangeSet(baseUrl)
    await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/revert`, {})
    const reapply = await call(baseUrl, `/projects/cr-project/change-sets/${changeSet.id}/reapply`, {})
    expect(reapply.status).toBe(409)
    expect(reapply.json.error.message).toContain('does not contain enough forward state to redo')
  })

  it('GUI 直建（无 sessionId）不记账', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, 'user created body')
    const list = await call(baseUrl, '/projects/cr-project/change-sets', undefined, 'GET')
    expect(list.json.value).toHaveLength(0)
  })
})

describe('change-review 后端 · applyPatch 批内创建（同事务记账）', () => {
  it('curation/apply 的 createTexts → 同一 ChangeSet 内含 artifact_text_create（原子）', async () => {
    const { baseUrl } = await startServer()
    const apply = await call(baseUrl, '/projects/cr-project/curation/apply', {
      schemaVersion: 0,
      projectId: 'cr-project',
      scopeId: 'scope-cr-project-root',
      createTexts: [{ clientRef: 'a', title: '批量节点', body: 'batch body' }],
      relations: [],
    })
    expect(apply.status).toBe(200)
    expect(apply.json.value.applied).toBe(true)

    const changeSet = await latestChangeSet(baseUrl)
    expect(changeSet.actorKind).toBe('agent')
    const item = changeSet.changes.find((change) => change.type === 'artifact_text_create')
    expect(item).toBeDefined()
    expect(item!.viewId).toBe(apply.json.value.completedSteps.find((step: { step: string }) => step.step === 'createText')?.viewId)
  })
})
