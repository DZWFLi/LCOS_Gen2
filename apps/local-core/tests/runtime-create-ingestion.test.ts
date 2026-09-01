import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { PersistedContextManifestV0 } from '@local-creative-os/contracts'
import type { Run, RuntimeDispatch } from '@local-creative-os/domain'

import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  BridgeTaskEnvelopeV0,
  BridgeTaskIdentity,
} from '../src/runtime-adapter.js'
import { RuntimeAdapterService } from '../src/runtime-adapter.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { RuntimeResultIngestionService } from '../src/runtime-result-ingestion.js'
import { RuntimeReviewService } from '../src/runtime-review-service.js'

const temporaryRoots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const now = '2026-08-03T07:00:00.000Z'

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of temporaryRoots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class CreateBridge implements BridgeRuntimePort {
  envelope: BridgeTaskEnvelopeV0 | undefined
  result: BridgeResultEnvelopeV0 | undefined

  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    this.envelope = envelope
    return {
      taskId: 'task-create-one',
      lcosRunId: envelope.lcosRunId,
      status: 'running',
      requestFingerprint: envelope.requestFingerprint,
      contractVersion: envelope.contractVersion,
    }
  }

  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> {
    return undefined
  }

  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> {
    return this.result
  }
}

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-create-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-create-project-'))
  temporaryRoots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, now)
  repository.save(snapshot)
  const canonicalJson = JSON.stringify({
    schemaVersion: 0,
    project: { id: snapshot.project.id },
    lockedElements: ['PortaSplit'],
  })
  const manifestHash = createHash('sha256').update(canonicalJson).digest('hex')
  const manifest: PersistedContextManifestV0 = {
    id: `manifest-${manifestHash}` as PersistedContextManifestV0['id'],
    projectId: snapshot.project.id,
    schemaVersion: 0,
    canonicalJson,
    manifestHash,
    createdAt: now,
  }
  repository.createContextManifest(manifest)
  const run: Run = {
    id: 'run-create-one' as Run['id'],
    projectId: snapshot.project.id,
    workspaceId: snapshot.workspaces[0]!.id,
    contextManifestId: manifest.id,
    provider: 'workbuddy',
    outputIntent: 'create',
    status: 'created',
    instruction: 'Create a shot list and a storyboard JSON for the new spot.',
    createdAt: now,
    updatedAt: now,
  }
  const dispatch: RuntimeDispatch = {
    id: 'dispatch-create-one' as RuntimeDispatch['id'],
    runId: run.id,
    provider: 'workbuddy',
    idempotencyKey: String(run.id),
    status: 'planned',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRunWithDispatch(run, dispatch)
  return { projectRoot, repository, run, snapshot }
}

async function dispatchedFixture() {
  const fixture = setup()
  const bridge = new CreateBridge()
  await new RuntimeAdapterService(fixture.repository, bridge, 'mvp-fast-build', () => now)
    .dispatch(fixture.run.id)
  const runtimeRoot = resolve(fixture.projectRoot, '.creative-os', 'runtime', String(fixture.run.id))
  const stagingRoot = resolve(runtimeRoot, 'staging')
  mkdirSync(stagingRoot, { recursive: true })
  return { ...fixture, bridge, runtimeRoot, stagingRoot }
}

function createdResult(files: readonly string[]): BridgeResultEnvelopeV0 {
  return {
    contractVersion: 'bridge-result-v1',
    taskId: 'task-create-one',
    lcosRunId: 'run-create-one',
    providerStatus: 'review',
    shortSummary: 'Created two new planning artifacts.',
    changedFiles: files.map((path) => ({ path, action: 'created' as const })),
  }
}

describe('Create output intent (Slice B-2)', () => {
  it('adapter builds an open output contract for create runs', async () => {
    const { bridge } = await dispatchedFixture()
    expect(bridge.envelope?.outputIntent).toBe('create')
    expect(bridge.envelope?.expectedOutputs).toHaveLength(0)
    expect(bridge.envelope?.outputPolicy).toMatchObject({
      allowZeroFiles: false,
      allowAdditionalFiles: true,
      maxFiles: 5,
    })
  })

  it('ingests multiple created files as a pending return group', async () => {
    const { repository, run, stagingRoot, bridge } = await dispatchedFixture()
    const firstPath = join(stagingRoot, 'shot-list.md')
    const secondPath = join(stagingRoot, 'storyboard.json')
    writeFileSync(firstPath, '# Shot list\n')
    writeFileSync(secondPath, '{"scenes":[]}\n')
    bridge.result = createdResult([firstPath, secondPath])

    const ingested = await new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result)
    expect(ingested.kind).toBe('create')
    if (ingested.kind !== 'create') throw new Error('expected create result')
    expect(ingested.artifactReturns).toHaveLength(2)
    expect(repository.getArtifactReturns(run.id)).toHaveLength(2)
    expect(repository.getArtifactReturns(run.id).every((item) => item.status === 'pending_review')).toBe(true)
    expect(repository.getRun(run.id)?.status).toBe('running')
    for (const artifactReturn of ingested.artifactReturns) {
      expect(repository.getArtifact(artifactReturn.targetArtifactId)).toMatchObject({
        projectId: run.projectId,
        availability: 'available',
      })
      const draft = repository.getArtifactRevision(String(artifactReturn.draftRevisionId))
      expect(draft?.status).toBe('draft')
      expect(draft?.source).toBe('run')
      expect(draft?.runId).toBe(run.id)
    }
  })

  it('review projection lists every created return while pending', async () => {
    const { repository, run, stagingRoot, bridge } = await dispatchedFixture()
    const firstPath = join(stagingRoot, 'shot-list.md')
    const secondPath = join(stagingRoot, 'storyboard.json')
    writeFileSync(firstPath, '# Shot list\n')
    writeFileSync(secondPath, '{"scenes":[]}\n')
    bridge.result = createdResult([firstPath, secondPath])
    await new RuntimeResultIngestionService(repository, bridge, () => now).ingest(bridge.result)

    const review = new RuntimeReviewService(repository, () => now).getRunReview(run.id)
    expect(review.presentationPhase).toBe('review')
    expect(review.returns).toHaveLength(2)
    expect(review.draftRevisions).toHaveLength(2)
    expect(review.capabilities.accept.enabled).toBe(true)
  })

  it('accept promotes the created draft and completes the run', async () => {
    const { repository, run, stagingRoot, bridge } = await dispatchedFixture()
    const firstPath = join(stagingRoot, 'shot-list.md')
    writeFileSync(firstPath, '# Shot list\n')
    bridge.result = createdResult([firstPath])
    const ingested = await new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result)
    if (ingested.kind !== 'create') throw new Error('expected create result')
    const artifactReturn = ingested.artifactReturns[0]!
    const graphVersionBefore = repository.getProject(String(run.projectId))?.graphVersion

    const accepted = repository.acceptArtifactReturn(
      artifactReturn.id,
      artifactReturn.baseRevisionId,
      now,
    )
    expect(accepted.previousRevision).toBeUndefined()
    expect(accepted.currentRevision.status).toBe('current')
    expect(accepted.artifactReturn.status).toBe('adopted')
    expect(accepted.run.status).toBe('completed')
    expect(repository.getArtifact(artifactReturn.targetArtifactId)?.currentRevisionId)
      .toBe(artifactReturn.draftRevisionId)
    expect(repository.getProject(String(run.projectId))?.graphVersion).toBe(graphVersionBefore! + 1)
  })

  it('rejects create results that claim modified files', async () => {
    const { repository, stagingRoot, bridge } = await dispatchedFixture()
    const path = join(stagingRoot, 'shot-list.md')
    writeFileSync(path, '# Shot list\n')
    bridge.result = {
      contractVersion: 'bridge-result-v1',
      taskId: 'task-create-one',
      lcosRunId: 'run-create-one',
      providerStatus: 'review',
      changedFiles: [{ path, action: 'modified' }],
    }
    await expect(new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result)).rejects.toThrow(/created files only/)
  })

  it('rejects create results with zero files', async () => {
    const { repository, bridge } = await dispatchedFixture()
    bridge.result = createdResult([])
    await expect(new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result)).rejects.toThrow(/between 1 and 5/)
  })

  it('rejects create results with more than five files', async () => {
    const { repository, stagingRoot, bridge } = await dispatchedFixture()
    const files = Array.from({ length: 6 }, (_, index) => join(stagingRoot, `file-${index}.md`))
    bridge.result = createdResult(files)
    await expect(new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result)).rejects.toThrow(/between 1 and 5/)
  })

  it('replays the same result without duplicating records', async () => {
    const { repository, run, stagingRoot, bridge } = await dispatchedFixture()
    const firstPath = join(stagingRoot, 'shot-list.md')
    const secondPath = join(stagingRoot, 'storyboard.json')
    writeFileSync(firstPath, '# Shot list\n')
    writeFileSync(secondPath, '{"scenes":[]}\n')
    bridge.result = createdResult([firstPath, secondPath])
    const service = new RuntimeResultIngestionService(repository, bridge, () => now)

    const first = await service.ingest(bridge.result)
    const second = await service.ingest(bridge.result)
    if (first.kind !== 'create' || second.kind !== 'create') throw new Error('expected create results')
    expect(second.artifactReturns.map((item) => item.id))
      .toEqual(first.artifactReturns.map((item) => item.id))
    expect(repository.getArtifactReturns(run.id)).toHaveLength(2)
  })
})
