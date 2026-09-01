import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { BridgeResultEnvelopeV0, BridgeRuntimePort, BridgeTaskEnvelopeV0, BridgeTaskIdentity } from '../src/runtime-adapter.js'
import { ActiveContextStore } from '../src/active-context-store.js'
import { AttentionRuntimeService } from '../src/attention-runtime-service.js'
import { ContextManifestService } from '../src/context-manifest-service.js'
import { ContinuityRuntimeService } from '../src/continuity-runtime-service.js'
import type { IntelligenceProviderService } from '../src/intelligence-provider-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { RuntimeAdapterService } from '../src/runtime-adapter.js'
import { RuntimeApplicationService } from '../src/runtime-application-service.js'
import { RuntimeResultIngestionService } from '../src/runtime-result-ingestion.js'
import { RuntimeReviewService } from '../src/runtime-review-service.js'
import { RuntimeRegistryService } from '../src/runtime-registry-service.js'
import { SpatialRetrievalService } from '../src/spatial-retrieval-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const now = '2026-08-16T10:00:00.000Z'

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class FakeBridge implements BridgeRuntimePort {
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    return { taskId: `task-${envelope.lcosRunId}`, lcosRunId: envelope.lcosRunId, status: 'assigned', requestFingerprint: envelope.requestFingerprint, contractVersion: envelope.contractVersion }
  }
  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> { return undefined }
  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> { return undefined }
  async answerInput(): Promise<void> {}
  async cancelTask(): Promise<void> {}
}

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-continuity-run-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-continuity-run-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, now)
  repository.save(snapshot)

  const bridge = new FakeBridge()
  const active = new ActiveContextStore(repository)
  const spatial = new SpatialRetrievalService(repository)
  const intelligence = { inferIntent: async () => undefined } as unknown as IntelligenceProviderService
  const attention = new AttentionRuntimeService(repository, active, undefined, spatial, intelligence)
  const registry = new RuntimeRegistryService(repository)
  const events = new ProjectEventHub()
  const continuity = new ContinuityRuntimeService(repository, registry, attention, events)
  const review = new RuntimeReviewService(repository, () => now, () => 'one')
  let sequence = 0
  const service = new RuntimeApplicationService(
    repository,
    new ContextManifestService(repository),
    new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now),
    new RuntimeResultIngestionService(repository, bridge, () => now),
    review,
    () => now,
    () => { sequence += 1; return `id-${sequence}` },
  )
  service.attachContinuity(continuity)
  return { continuity, repository, service, snapshot }
}

describe('Continuity ↔ Run linkage (Session 1)', () => {
  it('binds the session on first run, records sessionId on run.queued, and merges the Attach Bundle into the frozen manifest', async () => {
    const { repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    repository.upsertSessionContextRef({ sessionId: 'session-s1', projectId: String(snapshot.project.id), selectedViewIds: ['view-script'], retrievalEntityRefs: ['artifact-script'], sourceRefs: [], status: 'idle' })

    const result = await service.create(snapshot.project.id, {
      instruction: '基于会话上下文修改脚本',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
      workspaceId: String(snapshot.workspaces[0]!.id),
      sessionId: 'session-s1',
    })

    expect(repository.getSessionContextRef('session-s1')?.projectId).toBe(String(snapshot.project.id))
    const queued = repository.getRunEvents(result.review.run.id).find((event) => event.type === 'run.queued')
    expect(queued?.payload).toMatchObject({ sessionId: 'session-s1' })
    const manifest = repository.getContextManifest(result.review.run.contextManifestId)
    const canonical = JSON.parse(manifest!.canonicalJson) as { orderedItems: readonly { identity: string; role: string }[] }
    expect(canonical.orderedItems.some((item) => item.role === 'context' && item.identity.startsWith('continuity:'))).toBe(true)
  })

  it('creates one SessionSummary + Handoff for a completed run and is idempotent', async () => {
    const { repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    repository.upsertSessionContextRef({ sessionId: 'session-s2', projectId: String(snapshot.project.id), selectedViewIds: [], retrievalEntityRefs: [], sourceRefs: [], status: 'working' })
    const result = await service.create(snapshot.project.id, {
      instruction: '修改脚本并返回结果',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
      sessionId: 'session-s2',
    })
    repository.updateRunStatus(result.review.run.id, 'completed', now)

    await service.intakeContinuityReturn(result.review.run.id)
    const summaries = repository.listSessionSummaries(snapshot.project.id)
    expect(summaries).toHaveLength(1)
    expect(summaries[0]!.runIds.some((id) => String(id) === String(result.review.run.id))).toBe(true)
    expect(repository.getHandoff(summaries[0]!.handoffRef)?.sessionSummaryId).toBe(summaries[0]!.id)

    await service.intakeContinuityReturn(result.review.run.id)
    expect(repository.listSessionSummaries(snapshot.project.id)).toHaveLength(1)
  })

  it('never creates a pseudo-success handoff for non-completed runs or runs without a session', async () => {
    const { repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const running = await service.create(snapshot.project.id, {
      instruction: '这条还没完成',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
      sessionId: 'session-s3',
    })
    const noSession = await service.create(snapshot.project.id, {
      instruction: '这条没有会话',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
    })
    repository.updateRunStatus(noSession.review.run.id, 'completed', now)

    await service.intakeContinuityReturn(running.review.run.id)
    await service.intakeContinuityReturn(noSession.review.run.id)
    expect(repository.listSessionSummaries(snapshot.project.id)).toHaveLength(0)
  })
})
