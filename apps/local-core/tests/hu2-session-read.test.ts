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

async function startServer(): Promise<{ baseUrl: string; repository: SqliteMetadataRepository; root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-hu2-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'hu2-project' as never, name: 'HU2', rootPath: projectRoot })
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository, apiToken: 'test-hu2-token' })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: `http://${address.host}:${address.port}`, repository, root }
}

const HEADERS = { authorization: 'Bearer test-hu2-token', 'content-type': 'application/json' }

async function call(baseUrl: string, path: string, body: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

async function createText(baseUrl: string): Promise<{ viewId: string; artifactId: string }> {
  const result = await call(baseUrl, '/projects/hu2-project/curation/text', {
    scopeId: 'scope-hu2-project-root',
    title: 'doc',
    body: 'original body v1',
  })
  return { viewId: result.json.value.viewId, artifactId: result.json.value.artifactId }
}

describe('HU-2 Session Read-Before-Write', () => {
  it('full read records lease; update with session succeeds', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl)
    const read = await call(baseUrl, '/projects/hu2-project/curation/read', { viewIds: [viewId], sessionId: 's1', readMode: 'full' })
    expect(read.status).toBe(200)
    const update = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's1', body: 'updated by agent v2' }, 'PUT')
    expect(update.status).toBe(200)
  })

  it('update without full read is rejected with NO_READ_CURRENT_REVISION', async () => {
    const { baseUrl } = await startServer()
    const { viewId, artifactId } = await createText(baseUrl)
    const update = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's-no-read', body: 'should fail' }, 'PUT')
    expect(update.status).toBe(409)
    expect(update.json.error.message).toContain('NO_READ_CURRENT_REVISION')
    expect(update.json.error.message).toContain(artifactId)
  })

  it('preview/search mode read does NOT grant lease', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl)
    // 默认 readMode（非 full）→ 不记 lease
    await call(baseUrl, '/projects/hu2-project/curation/read', { viewIds: [viewId], sessionId: 's-preview' })
    const update = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's-preview', body: 'should fail' }, 'PUT')
    expect(update.status).toBe(409)
    expect(update.json.error.message).toContain('NO_READ_CURRENT_REVISION')
  })

  it('external edit after read makes lease stale (STALE_ARTIFACT_REVISION)', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl)
    await call(baseUrl, '/projects/hu2-project/curation/read', { viewIds: [viewId], sessionId: 's1', readMode: 'full' })
    // 用户（无 session）直接改 → revision 前进
    const userEdit = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, body: 'user edited v2' }, 'PUT')
    expect(userEdit.status).toBe(200)
    // Agent 用旧 lease 再写 → stale
    const stale = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's1', body: 'agent stale write' }, 'PUT')
    expect(stale.status).toBe(409)
    expect(stale.json.error.message).toContain('STALE_ARTIFACT_REVISION')
  })

  it('reread after stale grants fresh lease and update succeeds', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl)
    await call(baseUrl, '/projects/hu2-project/curation/read', { viewIds: [viewId], sessionId: 's1', readMode: 'full' })
    await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, body: 'user edited v2' }, 'PUT')
    const stale = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's1', body: 'stale' }, 'PUT')
    expect(stale.status).toBe(409)
    // reread full → fresh lease
    await call(baseUrl, '/projects/hu2-project/curation/read', { viewIds: [viewId], sessionId: 's1', readMode: 'full' })
    const retry = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's1', body: 'reconciled v3' }, 'PUT')
    expect(retry.status).toBe(200)
  })

  it('Core restart drops leases; same session must reread (NOT_READ heals by reread)', async () => {
    const { baseUrl, repository, root } = await startServer()
    const { viewId } = await createText(baseUrl)
    await call(baseUrl, '/projects/hu2-project/curation/read', { viewIds: [viewId], sessionId: 's-restart', readMode: 'full' })
    // 重启：关 server，开新 server（同一 DB）
    const closedServer = servers.pop()!
    await closedServer.close()
    const closedRepoIndex = repositories.indexOf(repository)
    if (closedRepoIndex >= 0) repositories.splice(closedRepoIndex, 1)
    repository.close()
    const reopened = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
    repositories.push(reopened)
    const server2 = createLocalCoreServer({ port: 0, metadataRepository: reopened, apiToken: 'test-hu2-token' })
    servers.push(server2)
    const address = await server2.start()
    const base2 = `http://${address.host}:${address.port}`
    // 旧 lease 已随进程丢失 → 拒绝
    const denied = await call(base2, '/projects/hu2-project/curation/text', { viewId, sessionId: 's-restart', body: 'after restart' }, 'PUT')
    expect(denied.status).toBe(409)
    expect(denied.json.error.message).toContain('NO_READ_CURRENT_REVISION')
    // reread heal
    await call(base2, '/projects/hu2-project/curation/read', { viewIds: [viewId], sessionId: 's-restart', readMode: 'full' })
    const healed = await call(base2, '/projects/hu2-project/curation/text', { viewId, sessionId: 's-restart', body: 'healed after restart' }, 'PUT')
    expect(healed.status).toBe(200)
  })
})

describe('HU-2b structured CAS conflicts (任务三第二刀)', () => {
  it('not-read 409 carries structured conflicts + conflictHint', async () => {
    const { baseUrl } = await startServer()
    const { viewId, artifactId } = await createText(baseUrl)
    const update = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's-structured', body: 'should fail' }, 'PUT')
    expect(update.status).toBe(409)
    expect(update.json.error.message).toContain('NO_READ_CURRENT_REVISION')
    expect(update.json.value.conflicts).toHaveLength(1)
    expect(update.json.value.conflicts[0].reason).toBe('not-read')
    expect(update.json.value.conflicts[0].artifactId).toBe(artifactId)
    expect(update.json.value.conflictHint).toContain('Read before write')
  })

  it('stale 409 carries expectedRevisionId + currentRevisionId', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl)
    await call(baseUrl, '/projects/hu2-project/curation/read', { viewIds: [viewId], sessionId: 's-structured-2', readMode: 'full' })
    await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, body: 'user v2' }, 'PUT')
    const stale = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's-structured-2', body: 'agent stale' }, 'PUT')
    expect(stale.status).toBe(409)
    expect(stale.json.error.message).toContain('STALE_ARTIFACT_REVISION')
    expect(stale.json.value.conflicts[0].reason).toBe('stale')
    expect(stale.json.value.conflicts[0].expectedRevisionId).toBeTruthy()
    expect(stale.json.value.conflicts[0].currentRevisionId).toBeTruthy()
    expect(stale.json.value.conflictHint).toContain('changed since your last read')
  })

  it('mutation-layer guard fires even when route precheck passes (lease source is server-side)', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl)
    // sessionId 提供且 artifact 存在（route precheck 通过），但从未 full-read → mutation 层拒绝
    const update = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, sessionId: 's-mutation-layer', body: 'x' }, 'PUT')
    expect(update.status).toBe(409)
    expect(update.json.value.conflicts[0].reason).toBe('not-read')
  })

  it('GUI direct edit without sessionId still bypasses the guard', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl)
    const direct = await call(baseUrl, '/projects/hu2-project/curation/text', { viewId, body: 'user direct edit' }, 'PUT')
    expect(direct.status).toBe(200)
    expect(direct.json.value.revisionId).toBeTruthy()
  })
})
