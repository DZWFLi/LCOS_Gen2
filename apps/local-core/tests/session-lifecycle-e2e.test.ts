import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  BridgeTaskEnvelopeV0,
  BridgeTaskIdentity,
} from '../src/runtime-adapter.js'
import { ContextManifestService } from '../src/context-manifest-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { RuntimeAdapterService } from '../src/runtime-adapter.js'
import { RuntimeApplicationService } from '../src/runtime-application-service.js'
import { RuntimeResultIngestionService } from '../src/runtime-result-ingestion.js'
import { RuntimeReviewService } from '../src/runtime-review-service.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class HealthyBridge implements BridgeRuntimePort {
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    return {
      taskId: `task-${envelope.lcosRunId}`,
      lcosRunId: envelope.lcosRunId,
      status: 'assigned',
      requestFingerprint: envelope.requestFingerprint,
      contractVersion: envelope.contractVersion,
    }
  }
  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> { return undefined }
  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> { return undefined }
}

class ThrowingBridge extends HealthyBridge {
  override async createTask(): Promise<BridgeTaskIdentity> {
    throw new Error('bridge offline: ECONNREFUSED 127.0.0.1:43122')
  }
}

async function startServer(bridge: BridgeRuntimePort) {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-session-e2e-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-session-e2e-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-27T12:00:00.000Z')
  repository.save(snapshot)
  const review = new RuntimeReviewService(repository, undefined, () => 'sess-e2e')
  const application = new RuntimeApplicationService(
    repository,
    new ContextManifestService(repository),
    new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
    new RuntimeResultIngestionService(repository, bridge),
    review,
    undefined,
    () => 'sess-e2e',
  )
  const server = createLocalCoreServer({
    port: 0,
    metadataRepository: repository,
    runtimeReviewService: review,
    runtimeApplicationService: application,
  })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: `http://${address.host}:${address.port}`, snapshot }
}

const HEADERS = { 'content-type': 'application/json' }

async function call(baseUrl: string, path: string, body: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

async function createRun(baseUrl: string, projectId: string) {
  const run = await call(baseUrl, `/projects/${projectId}/runs`, {
    instruction: 'Analyze the material.',
    outputIntent: 'analyze',
  })
  expect(run.status).toBe(201)
  return run.json.value?.review?.run?.id as string
}

describe('Session lifecycle HTTP 面（Phase 5 端到端）', () => {
  it('run 创建 → GET session-lifecycle 显示 connecting；compose 自动接线（无需手动 attach）', async () => {
    const { baseUrl, snapshot } = await startServer(new HealthyBridge())
    await createRun(baseUrl, String(snapshot.project.id))
    const lifecycle = await call(baseUrl, `/projects/${snapshot.project.id}/session-lifecycle`, undefined, 'GET')
    expect(lifecycle.status).toBe(200)
    const workbuddy = lifecycle.json.value.states.find((state: { provider: string }) => state.provider === 'workbuddy')
    expect(workbuddy).toBeDefined()
    expect(workbuddy.phase).toBe('connecting')
    expect(workbuddy.lastTransitionReason).toContain('created')
  })

  it('桥掉线（dispatch 失败）→ disconnected；POST recover → connecting', async () => {
    const { baseUrl, snapshot } = await startServer(new ThrowingBridge())
    const runId = await createRun(baseUrl, String(snapshot.project.id))
    const dispatch = await call(baseUrl, `/runs/${runId}/dispatch`, {})
    expect(dispatch.status).toBe(200)
    expect(dispatch.json.value?.providerError).toBeDefined()
    const afterFailure = await call(baseUrl, `/projects/${snapshot.project.id}/session-lifecycle`, undefined, 'GET')
    const workbuddy = afterFailure.json.value.states.find((state: { provider: string }) => state.provider === 'workbuddy')
    expect(workbuddy.phase).toBe('disconnected')
    expect(workbuddy.lastTransitionReason).toContain('bridge error')
    const recover = await call(baseUrl, `/projects/${snapshot.project.id}/session-lifecycle/workbuddy/recover`, {})
    expect(recover.status).toBe(200)
    expect(recover.json.value.state.phase).toBe('connecting')
  })

  it('recover 拒绝非法 provider；项目不存在 404', async () => {
    const { baseUrl, snapshot } = await startServer(new HealthyBridge())
    const badProvider = await call(baseUrl, `/projects/${snapshot.project.id}/session-lifecycle/openai/recover`, {})
    expect(badProvider.status).toBe(400)
    const missingProject = await call(baseUrl, `/projects/nope/session-lifecycle`, undefined, 'GET')
    expect(missingProject.status).toBe(404)
  })
})
