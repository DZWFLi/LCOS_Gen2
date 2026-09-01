import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { RunInputRequestV1 } from '@local-creative-os/contracts'
import type { Artifact } from '@local-creative-os/domain'
import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  BridgeTaskEnvelopeV0,
  BridgeTaskIdentity,
} from '../src/runtime-adapter.js'
import { ContextManifestService } from '../src/context-manifest-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { RuntimeAdapterError, RuntimeAdapterService } from '../src/runtime-adapter.js'
import { RuntimeApplicationService } from '../src/runtime-application-service.js'
import { RuntimeResultIngestionService } from '../src/runtime-result-ingestion.js'
import { RuntimeReviewService } from '../src/runtime-review-service.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const now = '2026-07-29T19:00:00.000Z'

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class FakeBridge implements BridgeRuntimePort {
  createError: Error | undefined
  cancelledTaskIds: string[] = []
  answeredInputs: Array<{ taskId: string; requestId: string; text?: string; selectedOptions?: readonly string[] }> = []
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    if (this.createError !== undefined) throw this.createError
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
  async answerInput(taskId: string, response: { readonly requestId: string; readonly text?: string; readonly selectedOptions?: readonly string[] }): Promise<void> {
    this.answeredInputs.push({ taskId, ...response })
  }
  async cancelTask(taskId: string): Promise<void> { this.cancelledTaskIds.push(taskId) }
}

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-app-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-runtime-app-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, now)
  repository.save(snapshot)
  const bridge = new FakeBridge()
  const review = new RuntimeReviewService(repository, () => now, () => 'retry-one')
  let idSequence = 0
  const service = new RuntimeApplicationService(
    repository,
    new ContextManifestService(repository),
    new RuntimeAdapterService(repository, bridge, 'mvp-fast-build', () => now),
    new RuntimeResultIngestionService(repository, bridge, () => now),
    review,
    () => now,
    () => idSequence++ === 0 ? 'one' : `one-${idSequence}`,
  )
  return { bridge, projectRoot, repository, service, snapshot }
}

describe('RuntimeApplicationService', () => {
  it('creates, dispatches and lists a canonical Run for restart recovery', async () => {
    const { repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const result = await service.create(snapshot.project.id, {
      instruction: 'Revise the script without overwriting the source.',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
      workspaceId: String(snapshot.workspaces[0]!.id),
    })
    expect(result.review).toMatchObject({ run: { status: 'created' }, dispatch: { status: 'planned' } })
    const dispatched = await service.dispatch(result.review.run.id)

    expect(dispatched.providerError).toBeUndefined()
    expect(dispatched.review).toMatchObject({
      run: { id: 'run-one', status: 'queued', targetArtifactId: target.id },
      dispatch: { status: 'bound', idempotencyKey: 'run-one' },
      binding: { externalTaskId: 'task-run-one', providerStatus: 'assigned' },
      presentationPhase: 'queued',
    })
    expect(repository.getProjectRuns(snapshot.project.id, 1)).toHaveLength(1)

    const databasePath = repository.databasePath
    repository.close()
    repositories.splice(repositories.indexOf(repository), 1)
    const restarted = new SqliteMetadataRepository(databasePath)
    repositories.push(restarted)
    expect(restarted.getProjectRuns(snapshot.project.id, 1)[0]).toMatchObject({
      id: 'run-one',
      contextManifestId: dispatched.review.run.contextManifestId,
    })
  })

  it('keeps the canonical Run and exposes recovery when Bridge dispatch is unavailable', async () => {
    const { bridge, repository, service, snapshot } = setup()
    bridge.createError = new RuntimeAdapterError({
      code: 'BRIDGE_UNAVAILABLE',
      message: 'Bridge is offline.',
      retryable: true,
      provider: 'workbuddy',
    })
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const result = await service.create(snapshot.project.id, {
      instruction: 'Revise the script.',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
    })
    const dispatched = await service.dispatch(result.review.run.id)

    expect(dispatched.providerError).toMatchObject({ code: 'BRIDGE_UNAVAILABLE', retryable: true })
    expect(dispatched.review.run.status).toBe('created')
    expect(dispatched.review.dispatch.status).toBe('recovery_required')
    expect(repository.getProjectRuns(snapshot.project.id, 10)).toHaveLength(1)
  })

  it('emits durable run events across create/dispatch/accept', async () => {
    const { repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const result = await service.create(snapshot.project.id, {
      instruction: 'Revise the script.',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
    })
    const runId = result.review.run.id
    const dispatched = await service.dispatch(runId)
    expect(dispatched.providerError).toBeUndefined()
    expect(dispatched.review.dispatch.status).toBe('bound')

    const events = repository.getRunEvents(runId)
    const types = events.map((event) => event.type)
    expect(types).toContain('run.queued')
    expect(types).not.toContain('run.started')
    expect(events.map((event) => event.sequence)).toEqual([1])
  })

  it('does not duplicate lifecycle events while polling an unchanged Run', async () => {
    const { repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const result = await service.create(snapshot.project.id, {
      instruction: 'Revise the script.',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
    })
    const runId = result.review.run.id
    await service.dispatch(runId)

    await service.sync(runId)
    await service.sync(runId)

    const started = repository.getRunEvents(runId).filter((event) => event.type === 'run.started')
    expect(started).toHaveLength(0)
  })

  it('answers waiting_input and requeues the same Run without creating a new Run', async () => {
    const { bridge, repository, service, snapshot } = setup()
    const result = await service.create(snapshot.project.id, {
      instruction: '分析当前资料。',
      outputIntent: 'analyze',
      requestedProvider: 'codex',
    })
    const runId = result.review.run.id
    await service.dispatch(runId)
    const request: RunInputRequestV1 = {
      schemaVersion: 1,
      requestId: 'input-app-one',
      runId: String(runId),
      question: '希望按方案 A 还是方案 B 继续？',
      options: ['A', 'B'],
      allowFreeText: true,
      status: 'pending',
      selectedOptions: [],
      createdAt: now,
    }
    repository.saveRunInputRequest(request)
    repository.updateRunStatus(runId, 'waiting_input', now)

    const answered = await service.answerInput(runId, {
      requestId: request.requestId,
      text: '按 A 继续，并保留 B 的结尾。',
      selectedOptions: ['A'],
    })

    expect(answered.providerError).toBeUndefined()
    expect(repository.getRun(runId)?.status).toBe('queued')
    expect(repository.getRunInputRequest(request.requestId)).toMatchObject({
      status: 'answered',
      answerText: '按 A 继续，并保留 B 的结尾。',
      selectedOptions: ['A'],
    })
    expect(bridge.answeredInputs).toEqual([{
      taskId: `task-${String(runId)}`,
      requestId: request.requestId,
      text: '按 A 继续，并保留 B 的结尾。',
      selectedOptions: ['A'],
    }])
    expect(repository.getProjectRuns(snapshot.project.id, 10)).toHaveLength(1)
    expect(repository.getRunEvents(runId).map((event) => event.type)).toEqual([
      'run.queued',
      'run.input_resolved',
      'run.queued',
    ])
  })

  it('cancels a bound Run through the Bridge and records run.cancelled', async () => {
    const { bridge, repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const result = await service.create(snapshot.project.id, {
      instruction: 'Revise the script.',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
    })
    const runId = result.review.run.id
    await service.dispatch(runId)

    const cancelled = await service.cancel(runId)
    expect(cancelled.review.run.status).toBe('cancelled')
    expect(bridge.cancelledTaskIds).toHaveLength(1)
    expect(repository.getRunEvents(runId).map((event) => event.type)).toContain('run.cancelled')
  })

  it('refuses to cancel a terminal Run', async () => {
    const { repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const result = await service.create(snapshot.project.id, {
      instruction: 'Revise the script.',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
    })
    const runId = result.review.run.id
    repository.updateRunStatus(runId, 'completed', now)
    const cancelled = await service.cancel(runId)
    expect(cancelled.providerError).toMatchObject({ code: 'RUN_ALREADY_TERMINAL', retryable: false })
    expect(repository.getRun(runId)?.status).toBe('completed')
  })

  it('rejects analyze/create runs that carry a modify target', async () => {
    const { service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    await expect(service.create(snapshot.project.id, {
      instruction: '分析脚本。',
      outputIntent: 'analyze',
      targetArtifactId: String(target.id),
    })).rejects.toThrow(/analyze 不允许指定修改目标/)
    await expect(service.create(snapshot.project.id, {
      instruction: '创建新文件。',
      outputIntent: 'create',
      targetArtifactId: String(target.id),
    })).rejects.toThrow(/create 不允许指定修改目标/)
  })

  it('persists the result policy on the canonical Run', async () => {
    const { repository, service, snapshot } = setup()
    const target = snapshot.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const result = await service.create(snapshot.project.id, {
      instruction: '修改脚本。',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
      resultPolicy: { type: 'draft_revision_per_target' },
    })
    expect(repository.getRun(result.review.run.id)?.resultPolicy).toEqual({ type: 'draft_revision_per_target' })
  })

  it('rejects revise targets that are external References (unmanaged artifacts)', async () => {
    const { repository, service, snapshot } = setup()
    const linkArtifact: Artifact = {
      id: 'artifact-link-ref' as Artifact['id'],
      projectId: snapshot.project.id,
      title: '外部链接.link.md',
      kind: 'markdown',
      managed: false,
      availability: 'available',
      createdAt: now,
      updatedAt: now,
    }
    repository.upsertArtifact(linkArtifact)
    await expect(service.create(snapshot.project.id, {
      instruction: '修改这个链接。',
      outputIntent: 'revise',
      targetArtifactId: String(linkArtifact.id),
    })).rejects.toThrow(/外部 Reference 不能作为修改目标/)
  })
})

it('serves the same stable Context prompt across different Runs while keeping each task in the dynamic tail', async () => {
  const { service, snapshot } = setup()
  const firstRun = await service.create(snapshot.project.id, {
    instruction: 'Analyze direction A.',
    outputIntent: 'analyze',
  })
  const secondRun = await service.create(snapshot.project.id, {
    instruction: 'Analyze direction B.',
    outputIntent: 'analyze',
  })

  const first = service.contextPrompt(firstRun.review.run.id)
  const second = service.contextPrompt(secondRun.review.run.id)
  expect(second.compiledContextPrompt.stablePrefixHash).toBe(first.compiledContextPrompt.stablePrefixHash)
  expect(second.compiledContextPrompt.dynamicTailHash).not.toBe(first.compiledContextPrompt.dynamicTailHash)
  expect(first.compiledContextPrompt.stablePrefix).not.toContain(String(firstRun.review.run.id))
  expect(second.compiledContextPrompt.dynamicTail).toContain('Analyze direction B.')
})
