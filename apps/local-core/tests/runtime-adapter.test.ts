import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import {
  createTaskRequestFingerprint,
  RuntimeAdapterError,
  RuntimeAdapterService,
} from '../src/runtime-adapter.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const now = '2026-07-29T12:00:00.000Z'

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class FakeBridge implements BridgeRuntimePort {
  createCalls = 0
  lookupCalls = 0
  envelope: BridgeTaskEnvelopeV0 | undefined
  task: BridgeTaskIdentity | undefined
  createError: Error | undefined

  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    this.createCalls += 1
    this.envelope = envelope
    if (this.createError !== undefined) throw this.createError
    return this.task ?? {
      taskId: 'task-one',
      lcosRunId: envelope.lcosRunId,
      status: 'queued',
      requestFingerprint: envelope.requestFingerprint,
      contractVersion: envelope.contractVersion,
    }
  }

  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> {
    this.lookupCalls += 1
    return this.task
  }

  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> {
    return undefined
  }

  async getCapabilities() {
    return {
      primaryContractVersion: 'bridge-task-v1',
      providers: [
        { provider: 'workbuddy', executionMode: 'pull', outputIntents: ['create', 'revise', 'analyze'], contractVersions: ['bridge-task-v1'] },
        { provider: 'codex', executionMode: 'pull', outputIntents: ['create', 'revise', 'analyze'], contractVersions: ['bridge-task-v1'] },
      ],
    }
  }
}

function setup(target: number | 'none' = 1) {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-adapter-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-adapter-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, now)
  repository.save(snapshot)
  const canonicalJson = JSON.stringify({
    schemaVersion: 0,
    project: { id: snapshot.project.id, name: snapshot.project.name },
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
    id: 'run-adapter-one' as Run['id'],
    projectId: snapshot.project.id,
    workspaceId: snapshot.workspaces[0]!.id,
    ...(target === 'none'
      ? {}
      : {
          targetArtifactId: snapshot.artifacts[target]!.id,
          targetRevisionId: snapshot.artifactRevisions[target]!.id,
        }),
    contextManifestId: manifest.id,
    provider: 'workbuddy',
    requestedProvider: 'workbuddy',
    outputIntent: 'revise',
    returnGroupId: 'return-group-adapter-one',
    status: 'created',
    instruction: 'Revise the Markdown script.',
    createdAt: now,
    updatedAt: now,
  }
  const dispatch: RuntimeDispatch = {
    id: 'dispatch-adapter-one' as RuntimeDispatch['id'],
    runId: run.id,
    provider: 'workbuddy',
    idempotencyKey: String(run.id),
    status: 'planned',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRunWithDispatch(run, dispatch)
  return { projectRoot, repository, run }
}

describe('RuntimeAdapterService', () => {
  it('matches the frozen Bridge canonical fingerprint fixture', () => {
    expect(createTaskRequestFingerprint({
      contractVersion: 'bridge-task-v0',
      lcosRunId: 'run-mvp-fixture-001',
      idempotencyKey: 'run-mvp-fixture-001',
      provider: 'workbuddy',
      taskType: 'markdown_script_revision',
      runtimeInputPackPath: 'C:\\LCOS_MVP_SAMPLE\\runtime\\runtime-input-pack.json',
      expectedOutputs: [{
        absolutePath: 'C:\\LCOS_MVP_SAMPLE\\staging\\script-draft-run-mvp-fixture-001.md',
        mode: 'create_new_file',
      }],
      timeoutSeconds: 600,
      reportMode: 'short',
    })).toBe('8b0f08d1c8661429f2e7966f0e2d266cf384cf0c073937f6ee1b2dbe5b504815')
  })

  it('materializes one immutable pack and binds an idempotent Bridge Task', async () => {
    const { repository, run } = setup()
    const bridge = new FakeBridge()
    const service = new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now)

    const first = await service.dispatch(run.id)
    const second = await service.dispatch(run.id)

    expect(first.externalTaskId).toBe('task-one')
    expect(second).toEqual(first)
    expect(bridge.createCalls).toBe(1)
    expect(repository.getRuntimeDispatch(run.id)?.status).toBe('bound')
    expect(repository.getRuntimeDispatch(run.id)?.attemptCount).toBe(1)
    expect(repository.getRun(run.id)?.status).toBe('queued')
    expect(bridge.envelope).toMatchObject({
      contractVersion: 'bridge-task-v1',
      outputIntent: 'revise',
      taskType: 'markdown_script_revision',
      outputPolicy: { allowZeroFiles: false, allowAdditionalFiles: false, maxFiles: 1 },
      expectedOutputs: [expect.objectContaining({
        action: 'modified',
        role: 'primary',
        mediaType: 'text/markdown',
      })],
    })
    const packPath = bridge.envelope!.runtimeInputPackPath
    expect(JSON.parse(readFileSync(packPath, 'utf8'))).toMatchObject({
      contractVersion: 'runtime-input-pack-v0',
      lcosRunId: String(run.id),
      contextManifest: { lockedElements: ['PortaSplit'] },
      compiledContextPrompt: {
        serializerVersion: 'context-prompt-v1',
        stablePrefixHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        dynamicTail: expect.stringContaining('Revise the Markdown script.'),
      },
      contextCacheTelemetry: {
        serializerVersion: 'context-prompt-v1',
        stablePrefixHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        provider: 'workbuddy',
      },
    })

  })

  it('fails unsupported revise targets BEFORE any Bridge create call', async () => {
    const { repository, run } = setup(2)
    const bridge = new FakeBridge()
    const service = new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now)

    await expect(service.dispatch(run.id)).rejects.toMatchObject({
      detail: { code: 'UNSUPPORTED_OUTPUT_FORMAT', retryable: false },
    })
    expect(bridge.createCalls).toBe(0)
    expect(repository.getRuntimeBinding(run.id)).toBeUndefined()
    expect(repository.getRuntimeDispatch(run.id)?.status).toBe('planned')
  })

  it('fails revise without a target before dispatch', async () => {
    const { repository, run } = setup('none')
    const bridge = new FakeBridge()
    const service = new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now)

    await expect(service.dispatch(run.id)).rejects.toMatchObject({
      detail: { code: 'CONTRACT_UNSUPPORTED', retryable: false },
    })
    expect(bridge.createCalls).toBe(0)
    expect(repository.getRuntimeBinding(run.id)).toBeUndefined()
    expect(repository.getRuntimeDispatch(run.id)?.status).toBe('planned')
  })

  it('marks an uncertain create as recovery_required and recovers by lookup without another create', async () => {
    const { repository, run } = setup()
    const bridge = new FakeBridge()
    bridge.createError = new Error('connection reset')
    const service = new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now)

    await expect(service.dispatch(run.id)).rejects.toMatchObject({
      detail: { code: 'BRIDGE_UNAVAILABLE', retryable: true },
    })
    expect(repository.getRuntimeDispatch(run.id)?.status).toBe('recovery_required')

    bridge.createError = undefined
    bridge.task = {
      taskId: 'task-recovered',
      lcosRunId: String(run.id),
      status: 'assigned',
      requestFingerprint: bridge.envelope!.requestFingerprint,
      contractVersion: 'bridge-task-v0',
    }
    const binding = await service.recover(run.id)
    expect(binding.externalTaskId).toBe('task-recovered')
    expect(bridge.lookupCalls).toBe(1)
    expect(bridge.createCalls).toBe(1)
    expect(repository.getRuntimeDispatch(run.id)?.status).toBe('bound')
  })

  it('refuses to overwrite a changed RuntimeInputPack during recovery', async () => {
    const { repository, run } = setup()
    const bridge = new FakeBridge()
    bridge.createError = new Error('connection reset')
    const service = new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now)

    await expect(service.dispatch(run.id)).rejects.toBeInstanceOf(RuntimeAdapterError)
    writeFileSync(bridge.envelope!.runtimeInputPackPath, '{"tampered":true}\n')
    bridge.createError = undefined

    await expect(service.recover(run.id)).rejects.toMatchObject({
      detail: { code: 'BRIDGE_UNAVAILABLE' },
    })
    expect(bridge.createCalls).toBe(1)
    expect(repository.getRuntimeDispatch(run.id)?.status).toBe('recovery_required')
  })

  it('keeps provider review out of canonical Run status during explicit sync', async () => {
    const { repository, run } = setup()
    const bridge = new FakeBridge()
    const service = new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now)
    await service.dispatch(run.id)
    repository.updateRunStatus(run.id, 'running', now)
    bridge.task = {
      taskId: 'task-one',
      lcosRunId: String(run.id),
      status: 'review',
      requestFingerprint: bridge.envelope!.requestFingerprint,
      contractVersion: 'bridge-task-v0',
    }

    const binding = await service.sync(run.id)
    expect(binding.providerStatus).toBe('review')
    expect(repository.getRun(run.id)?.status).toBe('running')
  })

  it('returns a canonical TASK_NOT_FOUND error when sync has no binding', async () => {
    const { repository, run } = setup()
    const service = new RuntimeAdapterService(repository, new FakeBridge(), 'mvp-fast-build', () => now)
    await expect(service.sync(run.id)).rejects.toBeInstanceOf(RuntimeAdapterError)
  })
  it('only advertises Runtime Host managed providers as automatic', async () => {
    const { repository } = setup()
    const bridge = new FakeBridge()
    const service = new RuntimeAdapterService(
      repository,
      bridge,
      'mvp-fast-build',
      () => now,
      undefined,
      new Set(['codex']),
    )

    const statuses = await service.providersStatus()
    expect(statuses.find((item) => item.provider === 'codex')).toMatchObject({ availability: 'ready', executionMode: 'automatic' })
    expect(statuses.find((item) => item.provider === 'workbuddy')).toMatchObject({ availability: 'manual', executionMode: 'manual' })
    expect(statuses.find((item) => item.provider === 'auto')).toMatchObject({ availability: 'ready', executionMode: 'automatic' })
  })

})
