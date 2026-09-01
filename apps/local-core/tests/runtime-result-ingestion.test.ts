import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { PersistedContextManifestV0 } from '@local-creative-os/contracts'
import type { Run, RuntimeDispatch } from '@local-creative-os/domain'

import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  BridgeTaskEnvelopeV0,
  BridgeTaskIdentity,
} from '../src/runtime-adapter.js'
import { RuntimeAdapterError, RuntimeAdapterService } from '../src/runtime-adapter.js'
import type { IngestedRuntimeResult } from '../src/runtime-result-ingestion.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { RuntimeResultIngestionService } from '../src/runtime-result-ingestion.js'

const temporaryRoots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const now = '2026-07-29T13:00:00.000Z'

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of temporaryRoots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class ResultBridge implements BridgeRuntimePort {
  envelope: BridgeTaskEnvelopeV0 | undefined
  result: BridgeResultEnvelopeV0 | undefined

  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    this.envelope = envelope
    return {
      taskId: 'task-result-one',
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

function reviseResult(result: IngestedRuntimeResult) {
  if (result.kind !== 'revise') throw new Error('expected revise result')
  return result
}

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-result-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-result-project-'))
  temporaryRoots.push(dbRoot, projectRoot)
  const databasePath = join(dbRoot, 'metadata.sqlite')
  const repository = new SqliteMetadataRepository(databasePath)
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
    targetArtifactId: snapshot.artifacts[1]!.id,
    targetRevisionId: snapshot.artifactRevisions[1]!.id,
    canonicalJson,
    manifestHash,
    createdAt: now,
  }
  repository.createContextManifest(manifest)
  const run: Run = {
    id: 'run-result-one' as Run['id'],
    projectId: snapshot.project.id,
    workspaceId: snapshot.workspaces[0]!.id,
    targetArtifactId: snapshot.artifacts[1]!.id,
    targetRevisionId: snapshot.artifactRevisions[1]!.id,
    contextManifestId: manifest.id,
    provider: 'workbuddy',
    status: 'created',
    instruction: 'Revise the Markdown script.',
    createdAt: now,
    updatedAt: now,
  }
  const dispatch: RuntimeDispatch = {
    id: 'dispatch-result-one' as RuntimeDispatch['id'],
    runId: run.id,
    provider: 'workbuddy',
    idempotencyKey: String(run.id),
    status: 'planned',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRunWithDispatch(run, dispatch)
  return { databasePath, projectRoot, repository, run, snapshot }
}

async function dispatchedFixture() {
  const fixture = setup()
  const bridge = new ResultBridge()
  await new RuntimeAdapterService(
    fixture.repository,
    bridge,
    'mvp-fast-build',
    () => now,
  ).dispatch(fixture.run.id)
  const outputPath = bridge.envelope!.expectedOutputs[0]!.absolutePath
  writeFileSync(outputPath, '# Revised Script\n\nPortaSplit\n')
  bridge.result = {
    contractVersion: 'bridge-result-v0',
    taskId: 'task-result-one',
    lcosRunId: String(fixture.run.id),
    providerStatus: 'review',
    shortSummary: 'Draft created.',
    changedFiles: [{ path: outputPath, action: 'created' }],
  }
  return { ...fixture, bridge, outputPath }
}

describe('RuntimeResultIngestionService', () => {
  it('creates one pending ArtifactReturn and Draft without changing Current', async () => {
    const { repository, run, snapshot, bridge } = await dispatchedFixture()
    const currentBefore = repository.getArtifact(String(run.targetArtifactId))?.currentRevisionId
    const service = new RuntimeResultIngestionService(repository, bridge, () => now)

    const first = await service.ingest(bridge.result!)
    const replay = await service.ingest(bridge.result!)

    expect(reviseResult(first).artifactReturn.status).toBe('pending_review')
    expect(reviseResult(first).draftRevision.status).toBe('draft')
    expect(reviseResult(first).draftRevision.parentRevisionId).toBe(run.targetRevisionId)
    expect(reviseResult(first).draftRevision.runId).toBe(run.id)
    expect(reviseResult(first).baseStale).toBe(false)
    expect(reviseResult(replay).replayed).toBe(true)
    expect(reviseResult(replay).artifactReturn.id).toBe(reviseResult(first).artifactReturn.id)
    expect(repository.getArtifact(String(run.targetArtifactId))?.currentRevisionId).toBe(currentBefore)
    expect(repository.getArtifactRevisions(String(run.targetArtifactId))).toHaveLength(
      snapshot.artifactRevisions.filter((revision) => revision.artifactId === run.targetArtifactId).length + 1,
    )
  })

  it('ingests the same Bridge result through the D2 provider path', async () => {
    const { repository, run, bridge } = await dispatchedFixture()
    const ingested = await new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingestFromBridge(run.id)
    if (ingested === undefined || ingested.kind !== 'revise') throw new Error('expected revise result')
    expect(ingested.artifactReturn.status).toBe('pending_review')
    expect(ingested.replayed).toBe(false)
  })

  it('keeps richer worker evidence when legacy Bridge summaries differ', async () => {
    const { projectRoot, repository, run, bridge } = await dispatchedFixture()
    const evidencePath = join(
      projectRoot,
      '.creative-os',
      'runtime',
      String(run.id),
      'result',
      'result-envelope-v0.json',
    )
    writeFileSync(evidencePath, JSON.stringify({
      ...bridge.result,
      shortSummary: 'Worker-authored summary.',
      resultSummary: 'Worker-authored detailed evidence.',
    }))

    const ingested = await new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingestFromBridge(run.id)

    if (ingested === undefined || ingested.kind !== 'revise') throw new Error('expected revise result')
    expect(ingested.artifactReturn.status).toBe('pending_review')
  })

  it('recomputes baseStale when Current changed while the Run was executing', async () => {
    const { repository, run, snapshot, bridge } = await dispatchedFixture()
    const artifact = repository.getArtifact(String(run.targetArtifactId))!
    repository.updateFileObservation(repository.getFileRecord(String(snapshot.artifactRevisions[1]!.fileRecordId))!, {
      ...artifact,
      currentRevisionId: undefined,
      updatedAt: now,
    })

    const ingested = await new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result!)
    expect(reviseResult(ingested).baseStale).toBe(true)
    expect(reviseResult(ingested).artifactReturn.baseRevisionId).toBe(run.targetRevisionId)
    expect(repository.getArtifact(String(run.targetArtifactId))?.currentRevisionId).toBeUndefined()
  })

  it('rejects a path that is not the immutable expected output', async () => {
    const { projectRoot, repository, bridge } = await dispatchedFixture()
    const outside = join(projectRoot, 'outside.md')
    writeFileSync(outside, '# outside')
    bridge.result = {
      ...bridge.result!,
      changedFiles: [{ path: outside, action: 'created' }],
    }
    await expect(
      new RuntimeResultIngestionService(repository, bridge, () => now).ingest(bridge.result),
    ).rejects.toMatchObject({ detail: { code: 'RESULT_PATH_REJECTED' } })
  })

  it('rejects a staging junction that escapes the Project root', async () => {
    const { repository, bridge, outputPath } = await dispatchedFixture()
    const staging = dirname(outputPath)
    const outside = mkdtempSync(join(tmpdir(), 'lcos-result-junction-'))
    temporaryRoots.push(outside)
    rmSync(staging, { recursive: true, force: true })
    mkdirSync(outside, { recursive: true })
    symlinkSync(outside, staging, 'junction')
    writeFileSync(outputPath, '# escaped through junction')

    await expect(
      new RuntimeResultIngestionService(repository, bridge, () => now).ingest(bridge.result!),
    ).rejects.toMatchObject({ detail: { code: 'RESULT_PATH_REJECTED' } })
  })

  it('persists a real waiting_input request without creating a Draft', async () => {
    const { repository, run, bridge } = await dispatchedFixture()
    bridge.result = {
      contractVersion: 'bridge-result-v1',
      taskId: 'task-result-one',
      lcosRunId: String(run.id),
      providerStatus: 'waiting_input',
      summary: '需要确认保留哪个方向。',
      changedFiles: [],
      inputRequest: {
        requestId: 'input-result-one',
        question: '保留 A 版还是 B 版？',
        options: ['A', 'B'],
        allowFreeText: true,
        contextVersion: 3,
      },
    }

    const ingested = await new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result)

    expect(ingested.kind).toBe('waiting_input')
    expect(repository.getRun(run.id)?.status).toBe('waiting_input')
    expect(repository.getPendingRunInputRequest(run.id)).toMatchObject({
      requestId: 'input-result-one',
      question: '保留 A 版还是 B 版？',
      status: 'pending',
      createdAt: now,
    })
    expect(repository.getArtifactRevisions(String(run.targetArtifactId)).some(
      (revision) => revision.runId === run.id,
    )).toBe(false)
  })

  it('archives but quarantines a late result after Run cancellation', async () => {
    const { repository, run, bridge } = await dispatchedFixture()
    repository.updateRunStatus(run.id, 'cancelled', now)
    await expect(
      new RuntimeResultIngestionService(repository, bridge, () => now).ingest(bridge.result!),
    ).rejects.toMatchObject({ detail: { code: 'LATE_RESULT_AFTER_CANCEL' } })
    expect(repository.getArtifactRevisions(String(run.targetArtifactId)).some(
      (revision) => revision.runId === run.id,
    )).toBe(false)
  })

  it('reports an absent provider result without creating Project Truth', async () => {
    const { repository, run, bridge } = await dispatchedFixture()
    bridge.result = undefined
    const result = await new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingestFromBridge(run.id)
    expect(result).toBeUndefined()
  })

  it('uses structured errors for invalid result identity', async () => {
    const { repository, bridge } = await dispatchedFixture()
    await expect(
      new RuntimeResultIngestionService(repository, bridge, () => now).ingest({
        ...bridge.result!,
        taskId: 'task-other',
      }),
    ).rejects.toBeInstanceOf(RuntimeAdapterError)
  })
})
