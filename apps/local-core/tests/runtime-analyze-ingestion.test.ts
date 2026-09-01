import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const temporaryRoots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const now = '2026-08-03T06:00:00.000Z'

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of temporaryRoots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class AnalyzeBridge implements BridgeRuntimePort {
  envelope: BridgeTaskEnvelopeV0 | undefined
  result: BridgeResultEnvelopeV0 | undefined

  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    this.envelope = envelope
    return {
      taskId: 'task-analyze-one',
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
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-analyze-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-analyze-project-'))
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
    id: 'run-analyze-one' as Run['id'],
    projectId: snapshot.project.id,
    workspaceId: snapshot.workspaces[0]!.id,
    contextManifestId: manifest.id,
    provider: 'workbuddy',
    outputIntent: 'analyze',
    status: 'created',
    instruction: 'Analyze the PDF for pacing problems.',
    createdAt: now,
    updatedAt: now,
  }
  const dispatch: RuntimeDispatch = {
    id: 'dispatch-analyze-one' as RuntimeDispatch['id'],
    runId: run.id,
    provider: 'workbuddy',
    idempotencyKey: String(run.id),
    status: 'planned',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRunWithDispatch(run, dispatch)
  return { databasePath: join(dbRoot, 'metadata.sqlite'), projectRoot, repository, run, snapshot }
}

describe('Analyze output intent (Slice B)', () => {
  it('adapter builds a zero-file output contract for analyze runs', async () => {
    const fixture = setup()
    const bridge = new AnalyzeBridge()
    await new RuntimeAdapterService(fixture.repository, bridge, 'mvp-fast-build', () => now)
      .dispatch(fixture.run.id)
    expect(bridge.envelope?.expectedOutputs).toHaveLength(0)
    expect(bridge.envelope?.outputPolicy).toMatchObject({ allowZeroFiles: true, maxFiles: 5 })
    expect(bridge.envelope?.outputIntent).toBe('analyze')
  })

  it('completes an analyze run with zero changed files and no Draft', async () => {
    const { repository, run } = setup()
    const bridge = new AnalyzeBridge()
    await new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now)
      .dispatch(run.id)
    bridge.result = {
      contractVersion: 'bridge-result-v0',
      taskId: 'task-analyze-one',
      lcosRunId: String(run.id),
      providerStatus: 'review',
      shortSummary: 'Pacing issue found in scene 3.',
      changedFiles: [],
    }

    const ingested = await new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result)
    expect(ingested.kind).toBe('analyze')
    if (ingested.kind !== 'analyze') throw new Error('expected analyze result')
    expect(ingested.summary).toContain('Pacing issue')
    expect(repository.getRun(run.id)?.status).toBe('completed')
  })

  it('rejects analyze results that claim changed files', async () => {
    const { repository, run, projectRoot } = setup()
    const bridge = new AnalyzeBridge()
    await new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now)
      .dispatch(run.id)
    bridge.result = {
      contractVersion: 'bridge-result-v0',
      taskId: 'task-analyze-one',
      lcosRunId: String(run.id),
      providerStatus: 'review',
      changedFiles: [{ path: join(projectRoot, 'draft.md'), action: 'created' }],
    }
    await expect(new RuntimeResultIngestionService(repository, bridge, () => now)
      .ingest(bridge.result)).rejects.toThrow(/zero changed files/)
  })
})
