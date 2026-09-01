import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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

class FakeBridge implements BridgeRuntimePort {
  task: BridgeTaskIdentity | undefined
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    this.task = {
      taskId: `task-${envelope.lcosRunId}`,
      lcosRunId: envelope.lcosRunId,
      status: 'assigned',
      requestFingerprint: envelope.requestFingerprint,
      contractVersion: envelope.contractVersion,
    }
    return this.task
  }
  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> { return this.task }
  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> { return undefined }
}

describe('Runtime HTTP closure', () => {
  it('creates a canonical Run and exposes it for browser restart recovery', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-one')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-one',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!

    const createdResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Create a new Markdown draft.',
        outputIntent: 'revise',
        targetArtifactId: target.id,
        targetRevisionId: target.currentRevisionId,
        resultPolicy: { type: 'draft_revision_per_target' },
      }),
    })
    expect(createdResponse.status).toBe(201)
    await expect(createdResponse.json()).resolves.toMatchObject({
      ok: true,
      value: {
        review: {
          run: {
            id: 'run-http-one',
            status: 'created',
            targetRevisionId: target.currentRevisionId,
            resultPolicy: { type: 'draft_revision_per_target' },
          },
          dispatch: { status: 'planned' },
        },
      },
    })

    const listResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/runs?limit=1`)
    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toMatchObject({
      ok: true,
      value: [{ run: { id: 'run-http-one' }, presentationPhase: 'created' }],
    })
  })

  it('exposes durable run events and cancels a bound Run over HTTP', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-two')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-two',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!

    const createdResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Revise the script.',
        outputIntent: 'revise',
        targetArtifactId: target.id,
      }),
    })
    expect(createdResponse.status).toBe(201)
    const createdBody = await createdResponse.json() as { value: { review: { run: { id: string } } } }
    const runId = createdBody.value.review.run.id

    const eventsResponse = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/events`)
    expect(eventsResponse.status).toBe(200)
    const eventsBody = await eventsResponse.json() as { value: { type: string; sequence: number }[] }
    expect(eventsBody.value.map((event) => event.type)).toEqual(['run.queued'])

    await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/dispatch`, { method: 'POST', body: '{}' })
    const cancelResponse = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(cancelResponse.status).toBe(200)
    const cancelBody = await cancelResponse.json() as { value: { review: { run: { status: string } } } }
    expect(cancelBody.value.review.run.status).toBe('cancelled')

    const eventsAfter = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/events`)
    const eventsAfterBody = await eventsAfter.json() as { value: { type: string }[] }
    expect(eventsAfterBody.value.map((event) => event.type)).toEqual([
      'run.queued',
      'run.cancelled',
    ])
  })

  it('serves Run Proposal, Workspace Membership and Provider status contracts', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-three')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-three',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const workspaceId = String(snapshot.workspaces[0]!.id)
    const viewId = String(snapshot.artifactViews[0]!.id)

    const proposeResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/runs/propose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '分析这份脚本的节奏问题',
        requestedProvider: 'auto',
        contextItems: [{ artifactId: String(snapshot.artifacts[0]!.id), revisionId: String(snapshot.artifactRevisions[0]!.id), order: 1 }],
        editTargets: [],
        resultPolicy: { type: 'reply_only' },
      }),
    })
    expect(proposeResponse.status).toBe(200)
    const proposeBody = await proposeResponse.json() as { value: { summary: string; proposal: { intent: string } } }
    expect(proposeBody.value.proposal.intent).toBe('analyze')
    expect(proposeBody.value.summary).toContain('分析')

    const addResponse = await fetch(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewIds: [viewId] }),
    })
    expect(addResponse.status).toBe(200)
    const addBody = await addResponse.json() as { value: { artifactViewId: string }[] }
    expect(addBody.value.map((item) => item.artifactViewId)).toContain(viewId)

    const listResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/workspace-memberships`)
    const listBody = await listResponse.json() as { value: { artifactViewId: string }[] }
    expect(listBody.value.map((item) => item.artifactViewId)).toContain(viewId)

    const removeResponse = await fetch(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(viewId)}`, {
      method: 'DELETE',
    })
    expect(removeResponse.status).toBe(200)
    const removeBody = await removeResponse.json() as { value: { artifactViewId: string }[] }
    expect(removeBody.value).toHaveLength(0)

    const providersResponse = await fetch(`${baseUrl}/runtime/providers`)
    expect(providersResponse.status).toBe(200)
    const providersBody = await providersResponse.json() as { value: { provider: string; availability: string }[] }
    expect(providersBody.value.map((item) => item.provider)).toEqual(['workbuddy', 'codex', 'auto'])
  })

  it('serves revision/process/workspace-state/session backend contracts', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-four')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-four',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const artifactId = String(snapshot.artifacts[0]!.id)
    const revisionId = String(snapshot.artifactRevisions[0]!.id)
    const workspaceId = String(snapshot.workspaces[0]!.id)

    const searchResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/artifacts/search?q=${encodeURIComponent(snapshot.artifacts[0]!.title.slice(0, 3))}`)
    const searchBody = await searchResponse.json() as { value: { id: string }[] }
    expect(searchBody.value.map((item) => item.id)).toContain(artifactId)

    const detailResponse = await fetch(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}`)
    const detailBody = await detailResponse.json() as { value: { artifact: { id: string }; revisions: { id: string }[] } }
    expect(detailBody.value.artifact.id).toBe(artifactId)
    expect(detailBody.value.revisions.map((item) => item.id)).toContain(revisionId)

    const listResponse = await fetch(`${baseUrl}/artifacts/${encodeURIComponent(artifactId)}/revisions`)
    const listBody = await listResponse.json() as { value: { id: string }[] }
    expect(listBody.value.map((item) => item.id)).toContain(revisionId)

    const compareResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/revisions/compare?base=${encodeURIComponent(revisionId)}&head=${encodeURIComponent(revisionId)}`)
    expect(compareResponse.status).toBe(200)
    const compareBody = await compareResponse.json() as { value: { changed: boolean; contentAvailable: boolean } }
    expect(compareBody.value.changed).toBe(false)
    expect(compareBody.value.contentAvailable).toBe(true)

    const projectionResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/process-projection`)
    expect(projectionResponse.status).toBe(200)
    const projectionBody = await projectionResponse.json() as { value: { kind: string; schemaVersion: number }[] }
    expect(projectionBody.value).toEqual([])

    const saveStateResponse = await fetch(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/states`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '现场A' }),
    })
    expect(saveStateResponse.status).toBe(201)
    const saveStateBody = await saveStateResponse.json() as { value: { id: string; workspaceId?: string } }
    expect(saveStateBody.value.workspaceId).toBe(workspaceId)

    const statesResponse = await fetch(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/states`)
    const statesBody = await statesResponse.json() as { value: { id: string }[] }
    expect(statesBody.value.map((item) => item.id)).toContain(saveStateBody.value.id)

    const restoreResponse = await fetch(`${baseUrl}/workspaces/${encodeURIComponent(workspaceId)}/states/${encodeURIComponent(saveStateBody.value.id)}/restore`, {
      method: 'POST',
    })
    expect(restoreResponse.status).toBe(200)

    const sessionResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/session-summaries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '收口', summary: '方向已定', handoffRef: 'docs/x.md' }),
    })
    expect(sessionResponse.status).toBe(201)
    const sessionsResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/session-summaries`)
    const sessionsBody = await sessionsResponse.json() as { value: { title: string }[] }
    expect(sessionsBody.value.map((item) => item.title)).toContain('收口')
  })

  it('exports and reopens a .lcosproj project file over HTTP', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    const outDir = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-out-'))
    roots.push(dbRoot, projectRoot, outDir)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-five')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-five',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const targetFile = join(outDir, '项目.lcosproj')

    const exportResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/export-lcosproj`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetPath: targetFile }),
    })
    expect(exportResponse.status).toBe(201)
    const exportBody = await exportResponse.json() as { value: { path: string; projectId: string; schemaVersion: number } }
    expect(exportBody.value.projectId).toBe(String(snapshot.project.id))
    expect(exportBody.value.schemaVersion).toBe(18)
    expect(existsSync(targetFile)).toBe(true)

    const inspectResponse = await fetch(`${baseUrl}/lcosproj/inspect?file=${encodeURIComponent(targetFile)}`)
    expect(inspectResponse.status).toBe(200)
    const inspectBody = await inspectResponse.json() as { value: { project: { id: string } } }
    expect(inspectBody.value.project.id).toBe(String(snapshot.project.id))

    const openResponse = await fetch(`${baseUrl}/lcosproj/open`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filePath: targetFile }),
    })
    expect(openResponse.status).toBe(200)
    const openBody = await openResponse.json() as { value: { project: { id: string }; tables: { artifacts: number } } }
    expect(openBody.value.project.id).toBe(String(snapshot.project.id))
    expect(openBody.value.tables.artifacts).toBe(snapshot.artifacts.length)
  })

  it('creates a managed Text Artifact that can enter Run Context', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-six')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-six',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const scopeId = String(snapshot.scopes[0]!.id)
    const workspaceId = String(snapshot.workspaces[0]!.id)

    const createResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/text-artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '开场要压到三秒。', scopeId, workspaceId, x: 40, y: 60 }),
    })
    expect(createResponse.status).toBe(201)
    const created = await createResponse.json() as { value: { artifactId: string; revisionId: string; viewId: string } }
    const artifact = repository.getArtifact(created.value.artifactId)
    expect(artifact?.managed).toBe(true)
    expect(artifact?.kind).toBe('markdown')
    expect(repository.getArtifactRevision(created.value.revisionId)?.status).toBe('current')
    expect(repository.listWorkspaceMembers(workspaceId as never).map((item) => String(item.artifactViewId)))
      .toContain(created.value.viewId)

    const proposeResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/runs/propose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: '根据这条文本分析节奏问题',
        requestedProvider: 'auto',
        contextItems: [{ artifactId: created.value.artifactId, revisionId: created.value.revisionId, order: 1 }],
        editTargets: [],
        resultPolicy: { type: 'reply_only' },
      }),
    })
    expect(proposeResponse.status).toBe(200)
    const proposeBody = await proposeResponse.json() as { value: { proposal: { contextItems: { artifactId: string }[] } } }
    expect(proposeBody.value.proposal.contextItems.map((item) => item.artifactId)).toContain(created.value.artifactId)
  })

  it('freezes ActiveContextV2 versioning: monotonic version, expectedVersion conflict, afterVersion poll', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-seven')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-seven',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const scopeId = String(snapshot.scopes[0]!.id)
    const viewA = String(snapshot.artifactViews[0]!.id)
    const viewB = String(snapshot.artifactViews[1]!.id)
    const put = (body: Record<string, unknown>) => fetch(`${baseUrl}/projects/${snapshot.project.id}/active-context`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeId, selectedViewIds: [viewA], pinnedContextIds: [], excludedContextIds: [], ...body }),
    })

    const first = await put({ updatedBy: 'web' })
    expect(first.status).toBe(200)
    const firstBody = await first.json() as { value: { version: number; schemaVersion: number; contextItems: { viewId: string }[]; updatedBy: string } }
    expect(firstBody.value.version).toBe(1)
    expect(firstBody.value.schemaVersion).toBe(2)
    expect(firstBody.value.updatedBy).toBe('web')
    expect(firstBody.value.contextItems.map((item) => item.viewId)).toContain(viewA)

    const second = await put({ selectedViewIds: [viewB], expectedVersion: 1, updatedBy: 'codex' })
    const secondBody = await second.json() as { value: { version: number; updatedBy: string } }
    expect(second.status).toBe(200)
    expect(secondBody.value.version).toBe(2)
    expect(secondBody.value.updatedBy).toBe('codex')

    const conflict = await put({ selectedViewIds: [viewA], expectedVersion: 1 })
    expect(conflict.status).toBe(409)
    const conflictBody = await conflict.json() as { error: { code: string } }
    expect(conflictBody.error.code).toBe('ACTIVE_CONTEXT_CONFLICT')

    const started = Date.now()
    const poll = await fetch(`${baseUrl}/projects/${snapshot.project.id}/active-context?afterVersion=2`)
    const elapsed = Date.now() - started
    const pollBody = await poll.json() as { value: { version: number } }
    expect(pollBody.value.version).toBe(2)
    expect(elapsed).toBeGreaterThanOrEqual(900)
  })

  it('serves frozen ContextManifest by id (get_lcos_run_context)', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-eight')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-eight',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
      contextManifestService: new ContextManifestService(repository),
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const artifactId = String(snapshot.artifacts[0]!.id)

    const buildResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-manifests/v0`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contextArtifactIds: [artifactId] }),
    })
    expect(buildResponse.status).toBe(200)
    const built = await buildResponse.json() as { value: { id: string } }

    const getResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-manifests/v0/${encodeURIComponent(built.value.id)}`)
    expect(getResponse.status).toBe(200)
    const got = await getResponse.json() as { value: { id: string; projectId: string } }
    expect(got.value.id).toBe(built.value.id)
    expect(got.value.projectId).toBe(String(snapshot.project.id))
  })

  it('keeps Codex context proposals reviewable: create/accept/reject/stale', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-nine')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-nine',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const scopeId = String(snapshot.scopes[0]!.id)
    const viewA = String(snapshot.artifactViews[0]!.id)
    const viewB = String(snapshot.artifactViews[1]!.id)
    const putContext = (body: Record<string, unknown>) => fetch(`${baseUrl}/projects/${snapshot.project.id}/active-context`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeId, selectedViewIds: [viewA], pinnedContextIds: [], excludedContextIds: [], ...body }),
    })
    const first = await (await putContext({})).json() as { value: { version: number } }

    const createProposal = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseContextVersion: first.value.version, addViewIds: [viewB], removeViewIds: [], reason: '加入第二份参考' }),
    })
    expect(createProposal.status).toBe(201)
    const created = await createProposal.json() as { value: { proposalId: string; status: string } }
    expect(created.value.status).toBe('pending')

    const accept = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-proposals/${created.value.proposalId}/accept`, {
      method: 'POST',
    })
    expect(accept.status).toBe(200)
    const accepted = await accept.json() as { value: { proposal: { status: string }; activeContext: { version: number; pinnedContextIds: string[]; updatedBy: string } } }
    expect(accepted.value.proposal.status).toBe('accepted')
    expect(accepted.value.activeContext.version).toBe(first.value.version + 1)
    expect(accepted.value.activeContext.pinnedContextIds).toContain(viewB)
    expect(accepted.value.activeContext.updatedBy).toBe('codex')

    const reject = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-proposals/${created.value.proposalId}/reject`, {
      method: 'POST',
    })
    expect(reject.status).toBe(409)

    const second = await (await putContext({ expectedVersion: 2 })).json() as { value: { version: number } }
    const staleProposal = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseContextVersion: second.value.version, addViewIds: [viewA], removeViewIds: [], reason: '过期测试' }),
    })
    const staleProposalBody = await staleProposal.json() as { value: { proposalId: string } }
    const acceptedAgain = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-proposals/${staleProposalBody.value.proposalId}/accept`, { method: 'POST' })
    expect(acceptedAgain.status).toBe(200)
    const staleAccept = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseContextVersion: 1, addViewIds: [viewB], removeViewIds: [], reason: '旧版本' }),
    })
    expect(staleAccept.status).toBe(409)
  })

  it('lets Core decide Codex dispatch: existing session / spawn new / wait', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-ten')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-ten',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`

    const created = await fetch(`${baseUrl}/projects/${snapshot.project.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Codex 分析一次。',
        outputIntent: 'analyze',
        requestedProvider: 'codex',
      }),
    })
    const createdBody = await created.json() as { value: { review: { run: { id: string } } } }
    const runId = createdBody.value.review.run.id
    await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/dispatch`, { method: 'POST', body: '{}' })

    const withSession = await fetch(`${baseUrl}/runtime/codex-dispatch-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: String(snapshot.project.id), sessions: [{ sessionId: 'proj-session' }] }),
    })
    const withSessionBody = await withSession.json() as { value: { runId: string; decision: string; sessionId: string }[] }
    expect(withSessionBody.value[0]).toMatchObject({ runId, decision: 'dispatch_existing', sessionId: 'proj-session' })

    const withoutSession = await fetch(`${baseUrl}/runtime/codex-dispatch-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: String(snapshot.project.id), sessions: [] }),
    })
    const withoutSessionBody = await withoutSession.json() as { value: { runId: string; decision: string; projectRoot: string }[] }
    expect(withoutSessionBody.value[0]).toMatchObject({ runId, decision: 'spawn_new', projectRoot })

    const busyOnly = await fetch(`${baseUrl}/runtime/codex-dispatch-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: String(snapshot.project.id), sessions: [{ sessionId: 'gui-session', guiActive: true }] }),
    })
    const busyOnlyBody = await busyOnly.json() as { value: { runId: string; decision: string }[] }
    // 空闲 GUI 会话也可以接活：guiActive 不拦路，只有思考中才等待
    expect(busyOnlyBody.value[0]).toMatchObject({ runId, decision: 'dispatch_existing' })

    const thinking = await fetch(`${baseUrl}/runtime/codex-dispatch-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: String(snapshot.project.id), sessions: [{ sessionId: 'thinking-session', busy: true }] }),
    })
    const thinkingBody = await thinking.json() as { value: { runId: string; decision: string }[] }
    expect(thinkingBody.value[0]).toMatchObject({ runId, decision: 'wait' })

    const idleGui = await fetch(`${baseUrl}/runtime/codex-dispatch-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: String(snapshot.project.id), sessions: [{ sessionId: 'idle-gui-session', guiActive: true, busy: false }] }),
    })
    const idleGuiBody = await idleGui.json() as { value: { runId: string; decision: string; sessionId: string }[] }
    // 用户语义：没有在思考的空闲 GUI 会话也可以接活
    expect(idleGuiBody.value[0]).toMatchObject({ runId, decision: 'dispatch_existing', sessionId: 'idle-gui-session' })

    // 已被认领（Bridge 状态）且租约未过期 → 不再派
    bridge.task = {
      ...bridge.task!,
      status: 'claimed',
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    }
    const claimedPlan = await fetch(`${baseUrl}/runtime/codex-dispatch-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: String(snapshot.project.id), sessions: [] }),
    })
    const claimedPlanBody = await claimedPlan.json() as { value: unknown[] }
    expect(claimedPlanBody.value).toHaveLength(0)

    // 租约过期 → 按 Bridge 状态机重新可派（防任务卡死）
    bridge.task = {
      ...bridge.task!,
      status: 'claimed',
      leaseExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    }
    const expiredPlan = await fetch(`${baseUrl}/runtime/codex-dispatch-plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: String(snapshot.project.id), sessions: [] }),
    })
    const expiredPlanBody = await expiredPlan.json() as { value: { runId: string; decision: string }[] }
    expect(expiredPlanBody.value[0]).toMatchObject({ runId, decision: 'spawn_new' })
  })

  it('streams active-context updates over SSE after a version bump', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-sse')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-sse',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const controller = new AbortController()
    const framesPromise = (async () => {
      const response = await fetch(`${baseUrl}/projects/${snapshot.project.id}/active-context/events`, {
        signal: controller.signal,
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return buffer
        buffer += decoder.decode(value, { stream: true })
        if (buffer.includes('event: update')) return buffer
      }
    })()

    await new Promise((resolve) => setTimeout(resolve, 150))
    const versionBody = await fetch(`${baseUrl}/projects/${snapshot.project.id}/active-context`) as { json(): Promise<{ value: { version: number } }> }
    const currentVersion = (await versionBody.json()).value.version
    const proposalResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/context-proposals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseContextVersion: currentVersion,
        addViewIds: [snapshot.artifactViews[0].id],
        removeViewIds: [],
        reason: 'sse-test',
      }),
    })
    expect(proposalResponse.status).toBe(201)
    const updateResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/active-context`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scopeId: snapshot.scopes[0].id,
        selectedViewIds: [],
        pinnedContextIds: [],
        excludedContextIds: [],
      }),
    })
    expect(updateResponse.status).toBe(200)

    const frames = await Promise.race([
      framesPromise,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('SSE update frame timed out')), 3_000)),
    ])
    controller.abort()
    expect(frames).toContain('event: snapshot')
    expect(frames).toContain('event: update')
    expect(frames).toContain('event: proposals')
    expect(frames).toContain('event: runs')
    expect(frames).toContain('"proposalId"')
  })

  it('cancels a created (never dispatched) Run locally', async () => {
    const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-db-'))
    const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-http-project-'))
    roots.push(dbRoot, projectRoot)
    const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
    repositories.push(repository)
    const snapshot = createMvpSampleSnapshot(projectRoot, '2026-07-29T19:30:00.000Z')
    repository.save(snapshot)
    const bridge = new FakeBridge()
    const review = new RuntimeReviewService(repository, undefined, () => 'http-cancel-created')
    const application = new RuntimeApplicationService(
      repository,
      new ContextManifestService(repository),
      new RuntimeAdapterService(repository, bridge, 'mvp-fast-build'),
      new RuntimeResultIngestionService(repository, bridge),
      review,
      undefined,
      () => 'http-cancel-created',
    )
    const server = createLocalCoreServer({
      port: 0,
      metadataRepository: repository,
      runtimeReviewService: review,
      runtimeApplicationService: application,
    })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!

    const createdResponse = await fetch(`${baseUrl}/projects/${snapshot.project.id}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        instruction: 'Never dispatched.',
        outputIntent: 'revise',
        targetArtifactId: target.id,
      }),
    })
    expect(createdResponse.status).toBe(201)
    const createdBody = await createdResponse.json() as { value: { review: { run: { id: string } } } }
    const runId = createdBody.value.review.run.id

    const cancelResponse = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    expect(cancelResponse.status).toBe(200)
    const cancelBody = await cancelResponse.json() as { value: { review: { run: { status: string } } } }
    expect(cancelBody.value.review.run.status).toBe('cancelled')

    const eventsResponse = await fetch(`${baseUrl}/runs/${encodeURIComponent(runId)}/events`)
    const eventsBody = await eventsResponse.json() as { value: { type: string }[] }
    expect(eventsBody.value.map((event) => event.type)).toContain('run.cancelled')
  })
})
