import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PersistedContextManifestV0 } from '@local-creative-os/contracts'
import type { Run, RuntimeDispatch } from '@local-creative-os/domain'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

const TOKEN = 'test-skill-author-token'
const HEADERS = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function startServer(): Promise<{ baseUrl: string; repo: SqliteMetadataRepository; projectId: string }> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-skill-author-e2e-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  mkdirSync(projectRoot, { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-30T09:00:00.000Z')
  repository.save(snapshot)
  createRun(repository, snapshot, 'completed-run', 'completed')
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository, apiToken: TOKEN })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: `http://${address.host}:${address.port}`, repo: repository, projectId: String(snapshot.project.id) }
}

function createRun(repository: SqliteMetadataRepository, snapshot: ReturnType<typeof createMvpSampleSnapshot>, id: string, status: Run['status']): Run {
  const manifestJson = JSON.stringify({ schemaVersion: 0, sequence: 0, runKey: id, target: { artifactId: String(snapshot.artifacts[0]!.id) }, references: [{ artifactId: String(snapshot.artifacts[1]!.id) }] })
  const manifestId = `manifest-sa-${id}` as PersistedContextManifestV0['id']
  repository.createContextManifest({
    id: manifestId,
    projectId: snapshot.project.id,
    schemaVersion: 0,
    targetArtifactId: snapshot.artifacts[0]!.id,
    targetRevisionId: snapshot.artifacts[0]!.currentRevisionId,
    canonicalJson: manifestJson,
    manifestHash: createHash('sha256').update(manifestJson).digest('hex'),
    createdAt: '2026-08-30T09:00:00.000Z',
  })
  const run: Run = {
    id: `run-sa-${id}` as Run['id'],
    projectId: snapshot.project.id,
    workspaceId: snapshot.workspaces[0]!.id,
    targetArtifactId: snapshot.artifacts[0]!.id,
    targetRevisionId: snapshot.artifacts[0]!.currentRevisionId,
    contextManifestId: manifestId,
    provider: 'codex',
    requestedProvider: 'codex',
    outputIntent: 'revise',
    returnGroupId: `return-group-sa-${id}`,
    status,
    instruction: 'Summarize the meeting notes into a decision list',
    createdAt: '2026-08-30T09:00:00.000Z',
    updatedAt: '2026-08-30T09:05:00.000Z',
  }
  repository.createRunWithDispatch(run, {
    id: `dispatch-sa-${id}` as RuntimeDispatch['id'],
    runId: run.id,
    provider: 'codex',
    idempotencyKey: String(run.id),
    status: 'planned',
    attemptCount: 0,
    createdAt: '2026-08-30T09:00:00.000Z',
    updatedAt: '2026-08-30T09:00:00.000Z',
  } as never)
  return run
}

async function call(baseUrl: string, path: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: HEADERS,
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

async function waitRunFinished(baseUrl: string, runId: string): Promise<{ status: string; exitCode?: number }> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const runs = await call(baseUrl, '/agentlets/runs', undefined, 'GET')
    const run = (runs.json.value as Array<{ id: string; status: string; exitCode?: number }>).find((entry) => entry.id === runId)
    if (run !== undefined && run.status !== 'running') return run
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`agentlet run ${runId} did not finish in time`)
}

describe('P0-D Skill Author agentlet semantic bridge (real harness reachback)', () => {
  it('execute → real harness → structured SkillProposal persisted (pending, createdBy=system)', async () => {
    const { baseUrl, repo, projectId } = await startServer()
    void repo
    const execute = await call(baseUrl, `/projects/${encodeURIComponent(projectId)}/skill-author/execute`, {
      schemaVersion: 1,
      projectId,
      runId: 'run-sa-completed-run',
      intent: '把这段整理归纳成技能',
    })
    expect(execute.status).toBe(201)
    const run = execute.json.value?.run as { id: string; agentletId: string; status: string } | undefined
    expect(run?.agentletId).toBe('lcos-skill-author')
    expect(run?.status).toBe('running')
    const finished = await waitRunFinished(baseUrl, run!.id)
    expect(finished.status).toBe('exited')
    expect(finished.exitCode).toBe(0)
    // proposal 持久化（pending, createdBy=system）
    const proposals = repo.listSkillProposals(projectId)
    expect(proposals.length).toBeGreaterThanOrEqual(1)
    const proposal = proposals[0]
    expect(proposal!.status).toBe('pending')
    expect(proposal!.createdBy).toBe('system')
  })

  it('ingest an invalid output fails closed with 422 VALIDATION', async () => {
    const { baseUrl, projectId } = await startServer()
    const ingested = await call(baseUrl, '/projects/' + encodeURIComponent(projectId) + '/skill-author/ingest', {
      sessionId: 'agentlet-session',
      schemaVersion: 1,
      kind: 'skill-proposal',
      agentletId: 'lcos-skill-author',
      // draft 缺失 → invalid
      methodFact: { methods: [], facts: [] },
      source: { runId: 'run-1', prompt: 'x', intent: 'analyze', orderedReferenceCount: 0, provider: 'codex', runCompletedAt: new Date().toISOString() },
      summary: 'bad',
    })
    expect(ingested.status).toBe(422)
    expect(ingested.json.error?.code).toBe('VALIDATION')
  })
})