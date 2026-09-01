import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PersistedContextManifestV0, RuntimeProviderStatus } from '@local-creative-os/contracts'
import type { ArtifactReturn, ArtifactRevision, FileRecord, ProjectId, Run, RuntimeDispatch } from '@local-creative-os/domain'
import { afterEach, describe, expect, it } from 'vitest'

import { ActiveContextStore } from '../src/active-context-store.js'
import { CaptureStagingService } from '../src/capture-staging-service.js'
import { CompanionProjectionService } from '../src/companion-projection-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { ReceiverRuntimeService } from '../src/receiver-runtime-service.js'
import type { RuntimeApplicationService } from '../src/runtime-application-service.js'

const now = new Date().toISOString()
const cleanups: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const path of cleanups.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
})

function baseRevision(snapshot: ReturnType<typeof createMvpSampleSnapshot>) {
  const target = snapshot.artifacts[0]!
  const base = snapshot.artifactRevisions.find((revision) => revision.id === target.currentRevisionId) ?? snapshot.artifactRevisions[0]!
  return { target, base }
}

function createRun(repository: SqliteMetadataRepository, snapshot: ReturnType<typeof createMvpSampleSnapshot>, id: string, status: Run['status']): Run {
  const { target, base } = baseRevision(snapshot)
  const manifestJson = JSON.stringify({ schemaVersion: 0, sequence: 0, runKey: id, target: { artifactId: String(target.id) }, references: [] })
  const manifestId = `manifest-cp-${id}` as PersistedContextManifestV0['id']
  repository.createContextManifest({
    id: manifestId,
    projectId: snapshot.project.id,
    schemaVersion: 0,
    targetArtifactId: target.id,
    targetRevisionId: base.id,
    canonicalJson: manifestJson,
    manifestHash: createHash('sha256').update(manifestJson).digest('hex'),
    createdAt: now,
  })
  const run: Run = {
    id: `run-cp-${id}` as Run['id'],
    projectId: snapshot.project.id,
    workspaceId: snapshot.workspaces[0]!.id,
    targetArtifactId: target.id,
    targetRevisionId: base.id,
    contextManifestId: manifestId,
    provider: 'codex',
    requestedProvider: 'codex',
    outputIntent: 'revise',
    returnGroupId: `return-group-cp-${id}`,
    status,
    instruction: `Companion instruction ${id}`,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRunWithDispatch(run, {
    id: `dispatch-cp-${id}` as RuntimeDispatch['id'],
    runId: run.id,
    provider: 'codex',
    idempotencyKey: String(run.id),
    status: 'bound',
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  })
  return run
}

function addPendingReturn(repository: SqliteMetadataRepository, snapshot: ReturnType<typeof createMvpSampleSnapshot>, run: Run, id: string): ArtifactReturn {
  const { target, base } = baseRevision(snapshot)
  const contentHash = createHash('sha256').update(`draft-${id}`).digest('hex')
  const fileRecord: FileRecord = {
    id: `file-cp-${id}` as FileRecord['id'],
    projectId: snapshot.project.id,
    observedPath: join(snapshot.project.rootPath, '.creative-os', 'runtime', id, 'draft.md'),
    observedHash: contentHash as FileRecord['observedHash'],
    size: 5,
    modifiedAt: now,
    mimeType: 'text/markdown',
    availability: 'current',
    observedAt: now,
  }
  const draft: ArtifactRevision = {
    id: `revision-cp-${id}` as ArtifactRevision['id'],
    artifactId: target.id,
    fileRecordId: fileRecord.id,
    parentRevisionId: base.id,
    contentHash: fileRecord.observedHash,
    source: 'run',
    runId: run.id,
    status: 'draft',
    createdAt: now,
  }
  const artifactReturn: ArtifactReturn = {
    id: `return-cp-${id}` as ArtifactReturn['id'],
    runId: run.id,
    targetArtifactId: target.id,
    baseRevisionId: base.id,
    returnedFileId: fileRecord.id,
    contentHash: fileRecord.observedHash,
    canonicalPath: fileRecord.observedPath,
    action: 'created',
    status: 'pending_review',
    draftRevisionId: draft.id,
    createdAt: now,
    updatedAt: now,
  }
  repository.createRuntimeDraft(fileRecord, draft, artifactReturn)
  return artifactReturn
}

type ProviderSource = readonly RuntimeProviderStatus[] | (() => Promise<readonly RuntimeProviderStatus[]>)

function runtimeApp(source: ProviderSource): RuntimeApplicationService {
  return {
    providers: typeof source === 'function' ? source : async () => source,
  } as unknown as RuntimeApplicationService
}

const READY_PROVIDERS: readonly RuntimeProviderStatus[] = [{ provider: 'codex', availability: 'ready' }]

async function setup(providerSource: ProviderSource = READY_PROVIDERS) {
  const directory = await mkdtemp(join(tmpdir(), 'lcos-companion-'))
  cleanups.push(directory)
  const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(join(directory, 'project'), now)
  repository.save(snapshot)
  const events = new ProjectEventHub()
  const receiverRuntime = new ReceiverRuntimeService(repository, events)
  const activeContext = new ActiveContextStore(repository)
  const captureStaging = new CaptureStagingService(repository, join(directory, 'blobs'))
  const service = new CompanionProjectionService(repository, receiverRuntime, activeContext, captureStaging, runtimeApp(providerSource))
  return { directory, repository, snapshot, events, receiverRuntime, activeContext, captureStaging, service }
}

describe('CompanionProjectionService (S4: unified Floating Companion read model)', () => {
  it('returns a schemaVersion 1 empty projection for an unknown project', async () => {
    const { service } = await setup()
    const value = await service.project('missing-project' as ProjectId)
    expect(value.schemaVersion).toBe(1)
    expect(value.projectId).toBe('missing-project')
    expect(value.project).toBeNull()
    expect(value.receiver.binding).toBeNull()
    expect(value.receiver.conversations).toEqual([])
    expect(value.receiver.pendingHandoff).toBeNull()
    expect(value.activeContext).toBeNull()
    expect(value.recentCapture).toEqual([])
    expect(value.pendingReturns).toEqual([])
    expect(value.executionItems).toEqual([])
    expect(value.availableActions).toEqual([])
    expect(value.runtimeStatus.bridgeOnline).toBe(true)
  })

  it('aggregates project / receiver / context / returns / execution faces into one projection', async () => {
    const { repository, snapshot, receiverRuntime, service } = await setup()
    const projectId = snapshot.project.id as ProjectId

    const runWaiting = createRun(repository, snapshot, 'waiting', 'waiting_input')
    addPendingReturn(repository, snapshot, runWaiting, 'waiting')
    const runFailed = createRun(repository, snapshot, 'failed', 'failed')

    const { target, base } = baseRevision(snapshot)
    repository.createArtifactReturn({
      id: `return-cp-rejected` as ArtifactReturn['id'],
      runId: runFailed.id,
      targetArtifactId: target.id,
      baseRevisionId: base.id,
      returnedFileId: `file-cp-waiting` as FileRecord['id'],
      contentHash: createHash('sha256').update('rejected').digest('hex') as FileRecord['observedHash'],
      canonicalPath: 'rejected-path',
      action: 'created',
      status: 'rejected',
      createdAt: now,
      updatedAt: now,
    })

    const conversation = receiverRuntime.createConversation({
      projectId: String(projectId),
      provider: 'workbuddy',
      executorId: 'exec-1',
      label: 'Companion Conversation',
    })
    receiverRuntime.setActiveReceiver(String(projectId), conversation.id)
    receiverRuntime.prepareHandoff({
      projectId: String(projectId),
      fromConversationId: null,
      toConversationId: conversation.id,
      surface: { kind: 'main', surfaceId: 'main' },
      selectionEntityIds: [],
    })

    const value = await service.project(projectId)
    expect(value.schemaVersion).toBe(1)
    expect(value.project?.id).toBe(String(projectId))
    expect(value.project?.activeConversationId).toBe(conversation.id)
    expect(value.receiver.binding?.activeReceiverId).toBe(conversation.id)
    expect(value.receiver.conversations.some((item) => item.id === conversation.id)).toBe(true)
    expect(value.receiver.pendingHandoff).not.toBeNull()
    expect(value.activeContext).not.toBeNull()
    expect(value.recentCapture).toEqual([])
    expect(value.pendingReturns).toHaveLength(1)
    expect(value.pendingReturns[0]!.runId).toBe(String(runWaiting.id))
    expect(value.pendingReturns[0]!.returnId).toBe('return-cp-waiting')
    expect(value.executionItems).toHaveLength(2)
    expect(value.availableActions).toEqual(['cancel', 'retry', 'answer_input'])
    expect(value.runtimeStatus.providers).toEqual([{ provider: 'codex', availability: 'ready' }])
    expect(value.runtimeStatus.bridgeOnline).toBe(true)
  })

  it('degrades to bridge offline when the provider status read fails', async () => {
    const { service } = await setup(() => Promise.reject(new Error('bridge down')))
    const value = await service.project('missing-project' as ProjectId)
    expect(value.runtimeStatus.providers).toEqual([])
    expect(value.runtimeStatus.bridgeOnline).toBe(false)
  })
})
