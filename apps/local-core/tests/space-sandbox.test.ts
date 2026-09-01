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
  const root = mkdtempSync(join(tmpdir(), 'lcos-space-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'space-project' as never, name: 'SPACE', rootPath: projectRoot })
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository, apiToken: 'test-space-token' })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: `http://${address.host}:${address.port}` }
}

const HEADERS = { authorization: 'Bearer test-space-token', 'content-type': 'application/json' }

async function call(baseUrl: string, path: string, body: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: HEADERS,
    body: JSON.stringify(body),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

async function createText(baseUrl: string, title: string): Promise<{ viewId: string; artifactId: string }> {
  const result = await call(baseUrl, '/projects/space-project/curation/text', {
    scopeId: 'scope-space-project-root',
    title,
    body: `body of ${title} v1`,
  })
  expect(result.status).toBe(200)
  return { viewId: result.json.value.viewId, artifactId: result.json.value.artifactId }
}

describe('/space/ 虚拟命名空间（任务四 P1）', () => {
  it('ls 列出节点虚拟路径 + L1 扫描头（preview + contentHash）', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, 'doc')
    const ls = await call(baseUrl, '/projects/space-project/space/ls', {})
    expect(ls.status).toBe(200)
    const item = ls.json.value.items.find((entry: { path: string }) => entry.path === '/space/nodes/doc.md')
    expect(item).toBeDefined()
    expect(item.artifactId).toBeTruthy()
    expect(item.revisionId).toBeTruthy()
    expect(item.contentHash).toBeTruthy()
    expect(item.preview).toContain('body of doc')
  })

  it('read 按虚拟路径返回全文 + revision；路径在用户编辑后保持稳定', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'doc')
    const read1 = await call(baseUrl, '/projects/space-project/space/read', { path: '/space/nodes/doc.md' })
    expect(read1.status).toBe(200)
    expect(read1.json.value.content).toBe('body of doc v1')
    expect(read1.json.value.viewId).toBe(viewId)
    expect(read1.json.value.truncated).toBe(false)
    // 用户直编（无 sessionId）→ revision 前进，但路径不变
    await call(baseUrl, '/projects/space-project/curation/text', { viewId, body: 'user edited v2' }, 'PUT')
    const read2 = await call(baseUrl, '/projects/space-project/space/read', { path: '/space/nodes/doc.md' })
    expect(read2.status).toBe(200)
    expect(read2.json.value.content).toBe('user edited v2')
    expect(read2.json.value.path).toBe('/space/nodes/doc.md')
    expect(read2.json.value.revisionId).not.toBe(read1.json.value.revisionId)
  })

  it('read 带 sessionId 记 full-read lease → 后续 curation/text 写入通过 CAS（读通道与写通道闭环）', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'doc')
    const read = await call(baseUrl, '/projects/space-project/space/read', { path: '/space/nodes/doc.md', sessionId: 'space-s1' })
    expect(read.status).toBe(200)
    const update = await call(baseUrl, '/projects/space-project/curation/text', { viewId, sessionId: 'space-s1', body: 'agent write after space read' }, 'PUT')
    expect(update.status).toBe(200)
  })

  it('未通过 /space/ 或 /curation/read full-read 的 session 写入仍被 CAS 拒绝', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'doc')
    const update = await call(baseUrl, '/projects/space-project/curation/text', { viewId, sessionId: 'space-s-no-read', body: 'should fail' }, 'PUT')
    expect(update.status).toBe(409)
    expect(update.json.error.message).toContain('NO_READ_CURRENT_REVISION')
  })

  it('CJK 标题 → CJK 虚拟路径；Windows 保留字符被剥除', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, '竞品分析')
    await createText(baseUrl, 'a/b:c?')
    const ls = await call(baseUrl, '/projects/space-project/space/ls', {})
    const paths: string[] = ls.json.value.items.map((entry: { path: string }) => entry.path)
    expect(paths).toContain('/space/nodes/竞品分析.md')
    expect(paths).toContain('/space/nodes/abc.md')
  })

  it('同名标题确定性消歧：后来者（id 序）追加短 id 后缀', async () => {
    const { baseUrl } = await startServer()
    const first = await createText(baseUrl, 'doc')
    const second = await createText(baseUrl, 'doc')
    const ls = await call(baseUrl, '/projects/space-project/space/ls', {})
    const paths: string[] = ls.json.value.items.map((entry: { path: string }) => entry.path)
    const docPaths = paths.filter((path) => path.startsWith('/space/nodes/doc'))
    expect(docPaths).toHaveLength(2)
    expect(docPaths).toContain('/space/nodes/doc.md')
    // 消歧后缀指向其中一个 artifactId 前 8 位
    const suffixed = docPaths.find((path) => path !== '/space/nodes/doc.md')!
    const suffix = suffixed.replace('/space/nodes/doc-', '').replace('.md', '')
    expect([first.artifactId.slice(0, 8), second.artifactId.slice(0, 8)]).toContain(suffix)
    // 两条路径都能读到且内容各自正确
    for (const path of docPaths) {
      const read = await call(baseUrl, '/projects/space-project/space/read', { path })
      expect(read.status).toBe(200)
      expect(read.json.value.content).toBe('body of doc v1')
    }
  })

  it('拒绝：缺前缀 / 穿越 / allowlist 外区域（400 且消息可指导自纠）', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, 'doc')
    const noPrefix = await call(baseUrl, '/projects/space-project/space/read', { path: 'nodes/doc.md' })
    expect(noPrefix.status).toBe(400)
    expect(noPrefix.json.error.message).toContain('must begin with "/space/"')
    const traversal = await call(baseUrl, '/projects/space-project/space/read', { path: '/space/nodes/../escape.md' })
    expect(traversal.status).toBe(400)
    expect(traversal.json.error.message).toContain('traversal')
    const allowlist = await call(baseUrl, '/projects/space-project/space/read', { path: '/space/skills/a/SKILL.md' })
    expect(allowlist.status).toBe(400)
    expect(allowlist.json.error.message).toContain('outside the agent read allowlist')
    const missingPath = await call(baseUrl, '/projects/space-project/space/read', {})
    expect(missingPath.status).toBe(400)
  })

  it('不存在的节点路径 → 404 并提示 /space/ls 重发现', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, 'doc')
    const missing = await call(baseUrl, '/projects/space-project/space/read', { path: '/space/nodes/unknown.md' })
    expect(missing.status).toBe(404)
    expect(missing.json.error.message).toContain('not found')
    expect(missing.json.error.message).toContain('/space/ls')
  })

  it('项目不存在 → 404', async () => {
    const { baseUrl } = await startServer()
    const missing = await call(baseUrl, '/projects/no-such-project/space/ls', {})
    expect(missing.status).toBe(404)
    expect(missing.json.error.message).toContain('Project not found')
  })
})
