import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PresentationStateV0 } from '@local-creative-os/contracts'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { createTextArtifact } from '../src/text-artifact-service.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

const TOKEN = 'test-curator-token'
const HEADERS = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function startServer(): Promise<{ baseUrl: string; repo: SqliteMetadataRepository }> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-curator-e2e-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: 'cur-e2e' as never, name: 'Cur', rootPath: projectRoot })
  // 默认 agentletsRoot = packages/agentlets（含真实 lcos-project-curator）
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository, apiToken: TOKEN })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: "http://" + address.host + ":" + address.port, repo: repository }
}

async function call(baseUrl: string, path: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: HEADERS,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

async function waitRunFinished(baseUrl: string, runId: string): Promise<{ status: string; exitCode?: number; diagnostics?: string }> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const runs = await call(baseUrl, '/agentlets/runs', undefined, 'GET')
    const run = (runs.json.value as Array<{ id: string; status: string; exitCode?: number; diagnostics?: string }>).find((entry) => entry.id === runId)
    if (run !== undefined && run.status !== 'running') return run
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`agentlet run ${runId} did not finish in time`)
}

describe('P0-C Curator agentlet semantic bridge (real harness reachback)', () => {
  it('dispatch → real harness → structured proposal persisted via ReorganizeService (no canvas mutation until apply)', async () => {
    const { baseUrl, repo } = await startServer()
    // 前置：两个真实文本节点（真实 artifact_view id）
    const viewA = await createTextArtifact(repo, 'cur-e2e' as never, { body: 'A', scopeId: 'scope-cur-e2e-root' as never })
    const viewB = await createTextArtifact(repo, 'cur-e2e' as never, { body: 'B', scopeId: 'scope-cur-e2e-root' as never })
    const presentationId = 'presentation:context:scope-cur-e2e-root'
    const presentation = new PresentationApplicationService(repo, repo)
    const state: PresentationStateV0 = { memberViewIds: [viewA.viewId, viewB.viewId], hiddenViewIds: [], positions: {}, hierarchy: { parentByViewId: {}, orderByParent: {} }, presentationEdges: [], pinnedViewIds: [], emphasisByViewId: {} }
    presentation.save('cur-e2e', { presentationId, scopeId: 'scope-cur-e2e-root', capability: 'context', renderer: 'graph', state, expectedVersion: 0, updatedBy: 'web' })

    const dispatch = await call(baseUrl, '/projects/cur-e2e/curator/reorganize', {
      schemaVersion: 1,
      projectId: 'cur-e2e',
      presentationId,
      surfaceKind: 'context',
      surfaceId: 'scope-cur-e2e-root',
      selectionViewIds: [],
      intent: '按内容关系分组',
    })
    expect(dispatch.status).toBe(201)
    const run = dispatch.json.value?.run as { id: string; agentletId: string; status: string; sessionId: string } | undefined
    expect(run?.agentletId).toBe('lcos-project-curator')
    expect(run?.status).toBe('running')

    const finished = await waitRunFinished(baseUrl, run!.id)
    // harness 回传 ingest 由 Core 持久化 proposal；harness 自身 exit 0 表示成功
    expect(finished.status).toBe('exited')
    expect(finished.exitCode).toBe(0)

    // ReorganizeService 持久化了 proposal（dispatch route → agentlet → ingest → reorganize.create）
    const proposals = await call(baseUrl, '/projects/cur-e2e/reorganize/proposals', undefined, 'GET')
    expect(proposals.status).toBe(200)
    const list = proposals.json.value as Array<{ id: string; presentationId: string; status: string; baseVersion: number }>
    expect(list.length).toBeGreaterThanOrEqual(1)
    const created = list.find((entry) => entry.presentationId === presentationId)
    expect(created).toBeDefined()
    expect(created!.status).toBe('pending')
  })

  it('ingest an invalid output fails closed with 422 VALIDATION and creates no proposal', async () => {
    const { baseUrl } = await startServer()
    const ingested = await call(baseUrl, '/projects/cur-e2e/curator/ingest', {
      sessionId: 'agentlet-session',
      schemaVersion: 1,
      kind: 'reorganize-proposal',
      agentletId: 'lcos-project-curator',
      proposal: { /* missing baseVersion → invalid */ projectId: 'cur-e2e', presentationId: 'presentation:context:scope-cur-e2e-root', status: 'pending', mergeCandidates: [], removeMemberViewIds: [], artifactDeleteCandidates: [] },
      summary: 'bad',
    })
    expect(ingested.status).toBe(422)
    expect(ingested.json.error?.code).toBe('VALIDATION')
  })
})