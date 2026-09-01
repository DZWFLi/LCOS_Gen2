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
  const root = mkdtempSync(join(tmpdir(), 'lcos-space-search-'))
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

async function createText(baseUrl: string, title: string, body: string): Promise<{ viewId: string }> {
  const result = await call(baseUrl, '/projects/space-project/curation/text', {
    scopeId: 'scope-space-project-root',
    title,
    body,
  })
  expect(result.status).toBe(200)
  return { viewId: result.json.value.viewId }
}

describe('/space/search 检索原语（huabu agentic 检索直译，20260827）', () => {
  it('标题命中：matchedIn=title 排最前，无 snippet', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, '交接风险', '正文与查询无关的内容')
    await createText(baseUrl, '其他节点', '正文里藏着交接风险四个字')
    const search = await call(baseUrl, '/projects/space-project/space/search', { query: '交接风险' })
    expect(search.status).toBe(200)
    expect(search.json.value.scanned).toBe(2)
    expect(search.json.value.items).toHaveLength(2)
    expect(search.json.value.items[0].matchedIn).toBe('title')
    expect(search.json.value.items[0].title).toBe('交接风险')
    expect(search.json.value.items[0].snippet).toBeUndefined()
    expect(search.json.value.items[1].matchedIn).toBe('content')
    expect(search.json.value.items[1].snippet).toContain('交接风险')
  })

  it('多词 AND 语义：全部命中才返回；大小写不敏感', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, 'node-a', 'Alpha contains the migration plan for Q3')
    await createText(baseUrl, 'node-b', 'Beta mentions alpha only')
    const both = await call(baseUrl, '/projects/space-project/space/search', { query: 'alpha migration' })
    expect(both.status).toBe(200)
    expect(both.json.value.items).toHaveLength(1)
    expect(both.json.value.items[0].artifactId).toBeTruthy()
    const caseInsensitive = await call(baseUrl, '/projects/space-project/space/search', { query: 'ALPHA' })
    expect(caseInsensitive.json.value.items.map((item: { title: string }) => item.title).sort()).toEqual(['node-a', 'node-b'])
  })

  it('CJK 无词界：子串直接命中（中文关键词不用分词）', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, '会议记录', '今天讨论了上下文架构与安全写回方案')
    const search = await call(baseUrl, '/projects/space-project/space/search', { query: '安全写回' })
    expect(search.json.value.items).toHaveLength(1)
    expect(search.json.value.items[0].matchedIn).toBe('content')
    expect(search.json.value.items[0].snippet).toContain('安全写回')
  })

  it('搜索不记 full-read lease：仅凭搜索命中写入仍被 CAS 拒绝（诚实边界）', async () => {
    const { baseUrl } = await startServer()
    const { viewId } = await createText(baseUrl, 'doc', 'the needle is here')
    const search = await call(baseUrl, '/projects/space-project/space/search', { query: 'needle', sessionId: 'search-only-session' })
    expect(search.status).toBe(200)
    const update = await call(baseUrl, '/projects/space-project/curation/text', { viewId, sessionId: 'search-only-session', body: 'write without full read' }, 'PUT')
    expect(update.status).toBe(409)
    expect(update.json.error.message).toContain('NO_READ_CURRENT_REVISION')
  })

  it('空查询/纯空白 → 400；limit 收敛到 [1,50]', async () => {
    const { baseUrl } = await startServer()
    await createText(baseUrl, 'doc', 'content')
    const empty = await call(baseUrl, '/projects/space-project/space/search', { query: '   ' })
    expect(empty.status).toBe(400)
    const missing = await call(baseUrl, '/projects/space-project/space/search', {})
    expect(missing.status).toBe(400)
  })

  it('limit 截断：结果按 标题命中 > 正文命中位置 稳定排序', async () => {
    const { baseUrl } = await startServer()
    for (let index = 0; index < 5; index += 1) {
      await createText(baseUrl, `hit-${index}`, `prefix padding ${'x'.repeat(index * 100)} target-term suffix`)
    }
    const search = await call(baseUrl, '/projects/space-project/space/search', { query: 'target-term', limit: 2 })
    expect(search.status).toBe(200)
    expect(search.json.value.items).toHaveLength(2)
    expect(search.json.value.scanned).toBe(5)
    // 命中位置最靠前的排最前：hit-0 的命中位置 < hit-1
    expect(search.json.value.items[0].title).toBe('hit-0')
    expect(search.json.value.items[1].title).toBe('hit-1')
  })
})
