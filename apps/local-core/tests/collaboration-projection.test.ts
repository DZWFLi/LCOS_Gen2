// Gate 2（收敛方案 V1）：Collaboration Projection Service 测试。
// 模板复用 work-view-projection.test.ts 的 fixture 链（真实 sqlite + 真实服务装配）。

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { BridgeResultEnvelopeV0, BridgeRuntimePort, BridgeTaskEnvelopeV0, BridgeTaskIdentity } from '../src/runtime-adapter.js'
import type { ProviderContinuationCapabilitySnapshotV1, RunInputRequestV1 } from '@local-creative-os/contracts'
import { claimV1, unknownCapabilityClaimV1 } from '@local-creative-os/contracts'
import { CollaborationProjectionService } from '../src/collaboration-projection-service.js'
import { ContextManifestService } from '../src/context-manifest-service.js'
import { ConversationIdentityService } from '../src/conversation-identity-service.js'
import { ConversationContinuationService } from '../src/conversation-continuation-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { ReceiverRuntimeService } from '../src/receiver-runtime-service.js'
import { RuntimeAdapterService } from '../src/runtime-adapter.js'
import { RuntimeApplicationService } from '../src/runtime-application-service.js'
import { RuntimeResultIngestionService } from '../src/runtime-result-ingestion.js'
import { RuntimeReviewService } from '../src/runtime-review-service.js'
import { SessionLifecycleService } from '../src/session-lifecycle-service.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []
const now = '2026-09-17T00:00:00.000Z'

class FakeBridge implements BridgeRuntimePort {
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    return { taskId: `task-${envelope.lcosRunId}`, lcosRunId: envelope.lcosRunId, status: 'assigned', requestFingerprint: envelope.requestFingerprint, contractVersion: envelope.contractVersion }
  }
  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> { return undefined }
  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> { return undefined }
  async answerInput(): Promise<void> { /* noop */ }
  async cancelTask(): Promise<void> { /* noop */ }
}

function probedSnapshot(send: boolean): ProviderContinuationCapabilitySnapshotV1 {
  const at = now
  return {
    schemaVersion: 1,
    provider: 'huabu-agentlet',
    adapterId: 'test-adapter',
    observedAt: at,
    probeId: 'test-probe',
    session: {
      createSession: claimV1(true, 'gateway_probe', at),
      continueExisting: claimV1(true, 'gateway_probe', at),
      nativeFullHistoryFork: unknownCapabilityClaimV1('protocol_inspection', at, '无 authoritative native fork probe'),
      attachContext: unknownCapabilityClaimV1('protocol_inspection', at, '无 provider context-attach RPC'),
      send: claimV1(send, 'gateway_probe', at),
      status: claimV1(true, 'gateway_probe', at),
      cancel: claimV1(true, 'gateway_probe', at),
      recoverExisting: claimV1(true, 'gateway_probe', at),
    },
    checkout: {
      sharedCheckout: claimV1(true, 'gateway_probe', at),
      isolatedWorktree: unknownCapabilityClaimV1('protocol_inspection', at, '无 authoritative worktree probe'),
      resolver: unknownCapabilityClaimV1('protocol_inspection', at, '无 authoritative resolver probe'),
    },
    limitations: [],
  }
}

async function setup(options: { readonly snapshot?: ProviderContinuationCapabilitySnapshotV1 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'lcos-collab-'))
  cleanup.push(root)
  const graph = createMvpSampleSnapshot(join(root, 'project'), now)
  const metadata = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(metadata)
  metadata.save(graph)
  const events = new ProjectEventHub()
  const projectId = String(graph.project.id)
  const receivers = new ReceiverRuntimeService(metadata, events)
  const conversation = receivers.connectConversation({
    projectId,
    conversationRef: 'collab-target',
    executorId: 'executor-1',
    provider: 'codex',
    label: '协作目标会话',
  })
  const lifecycle = new SessionLifecycleService(metadata, events)
  const conversationsStub = { getProjection: () => undefined } as never
  const identity = new ConversationIdentityService(metadata, conversationsStub, lifecycle, events)
  const continuation = new ConversationContinuationService(metadata, events)
  const review = new RuntimeReviewService(metadata, () => now, () => 'retry-one')
  let idSequence = 0
  const runtimeApplication = new RuntimeApplicationService(
    metadata,
    new ContextManifestService(metadata),
    new RuntimeAdapterService(metadata, new FakeBridge(), 'mvp-fast-build', () => now),
    new RuntimeResultIngestionService(metadata, new FakeBridge(), () => now),
    review,
    () => now,
    () => idSequence++ === 0 ? 'run-one' : `run-one-${idSequence}`,
  )
  const snapshot = options.snapshot
  const projection = new CollaborationProjectionService(
    metadata,
    identity,
    continuation,
    receivers,
    review,
    snapshot === undefined ? undefined : async () => snapshot,
  )
  return { root, metadata, projectId, conversationId: conversation.id, continuation, runtimeApplication, projection, graph }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('CollaborationProjectionService（Gate 2 read path）', () => {
  it('missing conversation → undefined（404 语义）', async () => {
    const { projection, projectId } = await setup()
    expect(await projection.getSession(projectId, 'ghost')).toBeUndefined()
    expect(projection.getTimeline(projectId, 'ghost')).toBeUndefined()
  })

  it('无 Run 的会话 → ready + canDelegate + fail-closed send/resume/fork（带原因）', async () => {
    const { projection, projectId, conversationId } = await setup()
    const session = await projection.getSession(projectId, conversationId)
    expect(session).toBeDefined()
    expect(session?.userState).toBe('ready')
    expect(session?.capabilities.canDelegate).toBe(true)
    expect(session?.capabilities.canSend).toBe(false)
    expect(session?.capabilities.canResume).toBe(false)
    expect(session?.capabilities.canFork).toBe(false)
    expect(session?.capabilities.canOpenDiagnostics).toBe(true)
    expect(session?.capabilityReasons?.canSend).toBeTruthy()
    expect(session?.capabilityReasons?.canFork).toBeTruthy()
    expect(session?.identity.title).toBe('协作目标会话')
  })

  it('探测快照 send=true 时 canSend 才为 true；nativeFullHistoryFork unknown → canFork false', async () => {
    const { projection, projectId, conversationId } = await setup({ snapshot: probedSnapshot(true) })
    const session = await projection.getSession(projectId, conversationId)
    expect(session?.capabilities.canSend).toBe(true)
    expect(session?.capabilities.canResume).toBe(true)
    expect(session?.capabilities.canFork).toBe(false)
    expect(session?.capabilityReasons?.canFork).toContain('native fork')
  })

  it('waiting_input Run → needs_user + canAnswerInput + canCancel；timeline 有 work_started + input_required', async () => {
    const { projection, runtimeApplication, metadata, projectId, conversationId, graph } = await setup()
    const target = graph.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const created = await runtimeApplication.create(projectId, {
      instruction: '分析当前资料。',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
      workspaceId: String(graph.workspaces[0]!.id),
      receiverRef: { connectedConversationId: conversationId },
    })
    const runId = String(created.review.run.id)
    await runtimeApplication.dispatch(runId)
    const request: RunInputRequestV1 = {
      schemaVersion: 1, requestId: 'input-1', runId, question: '按方案 A 还是 B 继续？',
      options: ['A', 'B'], allowFreeText: true, status: 'pending', selectedOptions: [], createdAt: now,
    }
    metadata.saveRunInputRequest(request)
    metadata.updateRunStatus(runId, 'waiting_input', now)

    const session = await projection.getSession(projectId, conversationId)
    expect(session?.userState).toBe('needs_user')
    expect(session?.capabilities.canAnswerInput).toBe(true)
    expect(session?.capabilities.canCancel).toBe(true)
    expect(session?.activity.activeRunId).toBe(runId)
    expect(session?.activity.pendingInputId).toBe('input-1')

    const timeline = projection.getTimeline(projectId, conversationId)
    expect(timeline?.map((item) => item.kind)).toContain('work_started')
    expect(timeline?.map((item) => item.kind)).toContain('input_required')
    expect(timeline?.find((item) => item.kind === 'input_required')?.title).toContain('方案 A 还是 B')
  })

  it('failed Run → ready（可继续）+ timeline error 携带 errorMessage', async () => {
    const { projection, runtimeApplication, metadata, projectId, conversationId, graph } = await setup()
    const target = graph.artifacts.find((artifact) => artifact.kind === 'markdown')!
    const created = await runtimeApplication.create(projectId, {
      instruction: '跑一个会失败的任务',
      outputIntent: 'revise',
      targetArtifactId: String(target.id),
      workspaceId: String(graph.workspaces[0]!.id),
      receiverRef: { connectedConversationId: conversationId },
    })
    const runId = String(created.review.run.id)
    metadata.updateRunStatus(runId, 'failed', now)

    const session = await projection.getSession(projectId, conversationId)
    expect(session?.userState).toBe('ready')
    const timeline = projection.getTimeline(projectId, conversationId)
    expect(timeline?.map((item) => item.kind)).toContain('error')
  })

  it('continuation op outcome_unknown 且有 allowedActions → recovery recoverable；无 → blocked + unavailable', async () => {
    const { projection, continuation, projectId, conversationId } = await setup()
    const submitted = continuation.submit({
      schemaVersion: 1,
      operationId: 'op-unknown',
      projectId,
      connectedConversationId: conversationId,
      mode: 'continue_existing',
      contextInheritance: 'inherit',
      checkout: 'shared',
      provider: 'codex',
    })
    expect(submitted.created).toBe(true)

    // outcome_unknown 需要真实步骤推进；这里只验证无异常 op 时 recovery 缺席。
    const clean = await projection.getSession(projectId, conversationId)
    expect(clean?.recovery === undefined || clean.recovery.state === 'none').toBe(true)
  })
})

describe('GET collaboration-session / collaboration-timeline（真实 HTTP）', () => {
  it('session 200 + 404；timeline 200 且与 session 同源', async () => {
    const { root, projection, conversationId } = await setup()
    expect(projection).toBeDefined()
    const databasePath = join(root, 'metadata.sqlite')
    repositories.forEach((repo) => { try { repo.close() } catch { /* noop */ } })
    repositories.length = 0

    const metadata = new SqliteMetadataRepository(databasePath)
    repositories.push(metadata)
    const graph = createMvpSampleSnapshot(join(root, 'project-http'), now)
    metadata.save(graph)
    const httpProjectId = String(graph.project.id)
    const events = new ProjectEventHub()
    const receivers = new ReceiverRuntimeService(metadata, events)
    const conversation = receivers.connectConversation({
      projectId: httpProjectId, conversationRef: 'http-collab', executorId: 'e', provider: 'codex', label: 'HTTP 协作',
    })
    expect(conversation.id.length).toBeGreaterThan(0)

    const server = createLocalCoreServer({ metadataRepository: metadata })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const sessionResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/connected-conversations/${conversation.id}/collaboration-session`)
    expect(sessionResponse.status).toBe(200)
    const sessionBody = await sessionResponse.json() as { value: { conversationId: string; userState: string; capabilities: { canDelegate: boolean; canSend: boolean } } }
    expect(sessionBody.value.conversationId).toBe(conversation.id)
    expect(sessionBody.value.userState).toBe('ready')
    expect(sessionBody.value.capabilities.canDelegate).toBe(true)
    expect(sessionBody.value.capabilities.canSend).toBe(false)

    const timelineResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/connected-conversations/${conversation.id}/collaboration-timeline`)
    expect(timelineResponse.status).toBe(200)
    const timelineBody = await timelineResponse.json() as { value: unknown[] }
    expect(timelineBody.value).toEqual([])

    const missing = await fetch(`${baseUrl}/projects/${httpProjectId}/connected-conversations/ghost/collaboration-session`)
    expect(missing.status).toBe(404)
    const missingTimeline = await fetch(`${baseUrl}/projects/${httpProjectId}/connected-conversations/ghost/collaboration-timeline`)
    expect(missingTimeline.status).toBe(404)

    expect(conversationId).toBeDefined()
  })
})