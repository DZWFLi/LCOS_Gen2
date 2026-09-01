import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

const TOKEN = 'test-agentlet-token'
const HEADERS = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function startServer(agentletsRoot: string): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-agentlet-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'ag-project' as never, name: 'AG', rootPath: projectRoot })
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository, apiToken: TOKEN, agentletsRoot })
  servers.push(server)
  const address = await server.start()
  return `http://${address.host}:${address.port}`
}

async function call(baseUrl: string, path: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: HEADERS,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

/** 测试 agentlet：Reachback 全链路（space/ls → space/read → curation/text 创建）。 */
function writeEchoAgentlet(agentletsRoot: string): void {
  const dir = join(agentletsRoot, 'echo-writer')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'agentlet.yaml'), [
    'schema: lcos-agentlet-schema-v1',
    'name: echo-writer',
    'description: 测试用 agentlet（reachback 闭环）',
    'command:',
    '  node: node main.mjs',
    'timeoutSeconds: 60',
    '',
  ].join('\n'), 'utf8')
  writeFileSync(join(dir, 'main.mjs'), `
const base = process.env.LCOS_CORE_URL
const token = process.env.LCOS_AGENTLET_TOKEN
const projectId = process.env.LCOS_PROJECT_ID
const scopeId = process.env.LCOS_SCOPE_ID
const sessionId = process.env.LCOS_SESSION_ID
const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token }
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const json = await res.json()
  if (!res.ok || json.ok === false) throw new Error(method + ' ' + path + ' -> ' + res.status + ' ' + (json?.error?.message ?? ''))
  return json.value ?? json
}
const ls = await call('POST', '/projects/' + encodeURIComponent(projectId) + '/space/ls', {})
const first = ls.items[0]
if (!first) throw new Error('project has no nodes to read')
const read = await call('POST', '/projects/' + encodeURIComponent(projectId) + '/space/read', { path: first.path, sessionId })
const created = await call('POST', '/projects/' + encodeURIComponent(projectId) + '/curation/text', {
  scopeId, title: 'Agentlet 摘要', body: 'reachback 闭环：细读了 ' + first.title, sessionId, x: 600, y: 600,
})
console.log(JSON.stringify({ ok: true, read: first.title, created: created.viewId }))
`, 'utf8')
}

async function waitRunFinished(baseUrl: string, runId: string): Promise<{ status: string; exitCode?: number; diagnostics?: string }> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const runs = await call(baseUrl, '/agentlets/runs', undefined, 'GET')
    const run = (runs.json.value as Array<{ id: string; status: string; exitCode?: number; diagnostics?: string }>).find((entry) => entry.id === runId)
    if (run !== undefined && run.status !== 'running') return run
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`agentlet run ${runId} did not finish in time`)
}

describe('Agentlet Runtime（任务四 P3：打包 + spawn + Reachback 闭环）', () => {
  it('list：扫描 manifest 返回摘要（含 harness 列表）；坏 manifest warn+skip 不 brick', async () => {
    const agentletsRoot = mkdtempSync(join(tmpdir(), 'lcos-agentlets-root-'))
    roots.push(agentletsRoot)
    writeEchoAgentlet(agentletsRoot)
    // 坏 manifest：schema 不符
    const bad = join(agentletsRoot, 'bad-one')
    mkdirSync(bad, { recursive: true })
    writeFileSync(join(bad, 'agentlet.yaml'), 'schema: wrong-schema\nname: bad-one\ndescription: x\ncommand:\n  node: node x.mjs\n', 'utf8')
    const baseUrl = await startServer(agentletsRoot)

    const list = await call(baseUrl, '/agentlets', undefined, 'GET')
    expect(list.status).toBe(200)
    const names = (list.json.value as Array<{ name: string; harnesses: string[]; timeoutSeconds: number }>).map((entry) => entry.name)
    expect(names).toContain('echo-writer')
    expect(names).not.toContain('bad-one')
    const echo = (list.json.value as Array<{ name: string; harnesses: string[]; timeoutSeconds: number }>).find((entry) => entry.name === 'echo-writer')
    expect(echo?.harnesses).toEqual(['node'])
    expect(echo?.timeoutSeconds).toBe(60)
  })

  it('launch：spawn → Reachback 闭环 → 画布出现产出节点 + ChangeSet 归因到 agentlet sessionId', async () => {
    const agentletsRoot = mkdtempSync(join(tmpdir(), 'lcos-agentlets-root-'))
    roots.push(agentletsRoot)
    writeEchoAgentlet(agentletsRoot)
    const baseUrl = await startServer(agentletsRoot)

    // 前置材料：一个文本节点供 agentlet 细读
    const seeded = await call(baseUrl, '/projects/ag-project/curation/text', { scopeId: 'scope-ag-project-root', title: '种子文档', body: '种子正文 v1' })
    expect(seeded.status).toBe(200)

    const launch = await call(baseUrl, '/projects/ag-project/agentlets/echo-writer/launch', { instruction: '巡检并产出摘要' })
    expect(launch.status).toBe(201)
    const run = launch.json.value as { id: string; sessionId: string; status: string; agentlet: string; harness: string }
    expect(run.agentlet).toBe('echo-writer')
    expect(run.harness).toBe('node')
    expect(run.sessionId).toMatch(/^agentlet-echo-writer-/)
    expect(run.status).toBe('running')

    const finished = await waitRunFinished(baseUrl, run.id)
    expect(finished.status).toBe('exited')
    expect(finished.exitCode).toBe(0)

    // 画布验证：产出节点存在
    const graph = await call(baseUrl, '/projects/ag-project/graph', undefined, 'GET')
    const artifact = (graph.json.value.artifacts as Array<{ id: string; title: string }>).find((entry) => entry.title === 'Agentlet 摘要')
    expect(artifact).toBeDefined()
    // 坐标透传：agentlet 传的 (600, 600) 必须落位（layout-recipes 前置）
    const createdView = (graph.json.value.artifactViews as Array<{ artifactId: string; position: { x: number; y: number } }>).find((view) => view.artifactId === artifact!.id)
    expect(createdView?.position).toEqual({ x: 600, y: 600 })

    // ChangeSet 验证：agent 写记账归因到 agentlet sessionId（P1 change-review 联动）
    const changeSets = await call(baseUrl, '/projects/ag-project/change-sets?limit=50', undefined, 'GET')
    const attributed = (changeSets.json.value as Array<{ actorKind: string; actorId?: string; changes: Array<{ type: string }> }>)
      .find((entry) => entry.actorId === run.sessionId)
    expect(attributed).toBeDefined()
    expect(attributed!.actorKind).toBe('agent')
    expect(attributed!.changes[0]!.type).toBe('artifact_text_create')

    // runs 列表携带终态与归因
    const runs = await call(baseUrl, '/agentlets/runs?projectId=ag-project', undefined, 'GET')
    const recorded = (runs.json.value as Array<{ id: string; status: string; sessionId: string }>).find((entry) => entry.id === run.id)
    expect(recorded?.status).toBe('exited')
    expect(recorded?.sessionId).toBe(run.sessionId)
  })

  it('launch 拒绝：未知 agentlet → 404；项目不存在 → 404', async () => {
    const agentletsRoot = mkdtempSync(join(tmpdir(), 'lcos-agentlets-root-'))
    roots.push(agentletsRoot)
    writeEchoAgentlet(agentletsRoot)
    const baseUrl = await startServer(agentletsRoot)

    const unknown = await call(baseUrl, '/projects/ag-project/agentlets/no-such-agentlet/launch', {})
    expect(unknown.status).toBe(404)
    expect(unknown.json.error.message).toContain('Agentlet not found')

    const noProject = await call(baseUrl, '/projects/no-such-project/agentlets/echo-writer/launch', {})
    expect(noProject.status).toBe(404)
  })

  it('launch 拒绝：manifest 未声明的 harness → 400 且列出可用项', async () => {
    const agentletsRoot = mkdtempSync(join(tmpdir(), 'lcos-agentlets-root-'))
    roots.push(agentletsRoot)
    writeEchoAgentlet(agentletsRoot)
    const baseUrl = await startServer(agentletsRoot)

    const wrong = await call(baseUrl, '/projects/ag-project/agentlets/echo-writer/launch', { harness: 'claude' })
    expect(wrong.status).toBe(400)
    expect(wrong.json.error.message).toContain('does not declare harness "claude"')
    expect(wrong.json.error.message).toContain('node')
  })

  it('agentlet 目录缺失 → list 为空（向后兼容，不报错）', async () => {
    const emptyRoot = mkdtempSync(join(tmpdir(), 'lcos-agentlets-empty-'))
    roots.push(emptyRoot)
    const baseUrl = await startServer(emptyRoot)
    const list = await call(baseUrl, '/agentlets', undefined, 'GET')
    expect(list.status).toBe(200)
    expect(list.json.value).toEqual([])
  })

  it('manifest name 与目录名不一致 → skip（防伪装）', async () => {
    const agentletsRoot = mkdtempSync(join(tmpdir(), 'lcos-agentlets-root-'))
    roots.push(agentletsRoot)
    writeEchoAgentlet(agentletsRoot)
    const impostor = join(agentletsRoot, 'not-echo')
    mkdirSync(impostor, { recursive: true })
    writeFileSync(join(impostor, 'agentlet.yaml'), 'schema: lcos-agentlet-schema-v1\nname: echo-writer\ndescription: 伪装成别的目录\ncommand:\n  node: node main.mjs\n', 'utf8')
    const baseUrl = await startServer(agentletsRoot)
    const list = await call(baseUrl, '/agentlets', undefined, 'GET')
    const names = (list.json.value as Array<{ name: string }>).map((entry) => entry.name)
    expect(names).toContain('echo-writer')
    expect(names.filter((name) => name === 'echo-writer')).toHaveLength(1)
  })
})
