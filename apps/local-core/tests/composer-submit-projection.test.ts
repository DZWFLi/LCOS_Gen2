import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { BridgeResultEnvelopeV0, BridgeRuntimePort, BridgeTaskEnvelopeV0, BridgeTaskIdentity } from '../src/runtime-adapter.js'
import type { CommandDraftV1, ContinuationSubmitRequestV1 } from '@local-creative-os/contracts'
import { composerSubmitProjectionV1 } from '../src/composer-submit-projection.js'
import { ContextManifestService } from '../src/context-manifest-service.js'
import { ConversationContinuationService } from '../src/conversation-continuation-service.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { ReceiverRuntimeService } from '../src/receiver-runtime-service.js'
import { RuntimeAdapterService } from '../src/runtime-adapter.js'
import { RuntimeApplicationService } from '../src/runtime-application-service.js'
import { RuntimeResultIngestionService } from '../src/runtime-result-ingestion.js'
import { RuntimeReviewService } from '../src/runtime-review-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []
const now = '2026-09-12T00:00:00.000Z'

class FakeBridge implements BridgeRuntimePort {
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    return { taskId: `task-${envelope.lcosRunId}`, lcosRunId: envelope.lcosRunId, status: 'assigned', requestFingerprint: envelope.requestFingerprint, contractVersion: envelope.contractVersion }
  }
  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> { return undefined }
  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> { return undefined }
  async answerInput(): Promise<void> { /* noop */ }
  async cancelTask(): Promise<void> { /* noop */ }
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcos-composer-proj-'))
  cleanup.push(root)
  const graph = createMvpSampleSnapshot(join(root, 'project'), now)
  const metadata = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(metadata)
  metadata.save(graph)
  const events = new ProjectEventHub()
  const projectId = String(graph.project.id)
  const receivers = new ReceiverRuntimeService(metadata, events)
  const conversation = receivers.connectConversation({
    projectId, conversationRef: 'composer-target', executorId: 'e', provider: 'codex', label: 'Composer 目标',
  })
  const continuation = new ConversationContinuationService(metadata, events)
  const runtimeApplication = new RuntimeApplicationService(
    metadata,
    new ContextManifestService(metadata),
    new RuntimeAdapterService(metadata, new FakeBridge(), 'mvp-fast-build', () => now),
    new RuntimeResultIngestionService(metadata, new FakeBridge(), () => now),
    new RuntimeReviewService(metadata, () => now, () => 'retry-one'),
    () => now,
    () => 'run-composer',
  )
  const draft: CommandDraftV1 = {
    schemaVersion: 1, projectId, workspaceId: null, composerAnchor: 'main-composer',
    surfaceKind: 'main', surfaceId: null, prompt: '分析当前资料。',
    contextViewIds: [], selectionViewIds: [], receiverId: null, provider: 'codex',
    createAsNewNode: false, intent: 'revise', resultPolicy: 'reply_only', updatedAt: now,
  }
  return { root, metadata, projectId, conversationId: conversation.id, continuation, runtimeApplication, draft, graph }
}

function submitOp(projectId: string, conversationId: string, operationId: string): ContinuationSubmitRequestV1 {
  return {
    schemaVersion: 1, operationId, projectId, connectedConversationId: conversationId,
    mode: 'continue_existing', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex',
  }
}

afterEach(async () => {
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('composerSubmitProjectionV1（T6 §3.2）', () => {
  it('无 draft → undefined（404）', async () => {
    const { metadata, projectId } = await setup()
    expect(composerSubmitProjectionV1(metadata, undefined, projectId, null, 'ghost-anchor')).toBeUndefined()
  })

  it('receiverId 未设 → ownerRef null，只允许 choose_receiver/refresh', async () => {
    const { metadata, projectId, draft } = await setup()
    metadata.saveCommandDraft(draft)
    const value = composerSubmitProjectionV1(metadata, undefined, projectId, null, draft.composerAnchor)
    expect(value?.receiverId).toBeNull()
    expect(value?.ownerRef).toBeNull()
    expect(value?.submissionKind).toBe('run')
    expect(value?.acknowledgement).toBe('unconfirmed')
    expect(value?.allowedActions).toEqual(['choose_receiver', 'refresh'])
  })

  it('已选 receiver 且无 receipt → run kind + unconfirmed，允许首次提交', async () => {
    const { metadata, projectId, conversationId, draft } = await setup()
    metadata.saveCommandDraft({ ...draft, receiverId: conversationId })
    const value = composerSubmitProjectionV1(metadata, undefined, projectId, null, draft.composerAnchor)
    expect(value?.submissionKind).toBe('run')
    expect(value?.ownerRef).toEqual({ kind: 'connected_conversation', id: conversationId })
    expect(value?.acknowledgement).toBe('unconfirmed')
    expect(value?.allowedActions).toEqual(['submit_run', 'refresh'])
  })

  it('receiverRef Run 已创建 → acknowledged（receipt 存在）', async () => {
    const { metadata, projectId, conversationId, runtimeApplication, draft, graph } = await setup()
    metadata.saveCommandDraft({ ...draft, receiverId: conversationId })
    const target = graph.artifacts.find((artifact) => artifact.kind === 'markdown')!
    await runtimeApplication.create(projectId, {
      instruction: draft.prompt, outputIntent: 'revise', targetArtifactId: String(target.id),
      workspaceId: String(graph.workspaces[0]!.id),
      receiverRef: { connectedConversationId: conversationId },
    })
    const value = composerSubmitProjectionV1(metadata, undefined, projectId, null, draft.composerAnchor)
    expect(value?.submissionKind).toBe('run')
    expect(value?.acknowledgement).toBe('acknowledged')
    expect(value?.allowedActions).toEqual(['submit_run', 'refresh'])
  })

  it('存在可恢复 continuation op → continuation kind + open_recovery + acknowledged', async () => {
    const { metadata, projectId, conversationId, continuation, draft } = await setup()
    metadata.saveCommandDraft({ ...draft, receiverId: conversationId })
    continuation.submit(submitOp(projectId, conversationId, 'op-composer'))
    const value = composerSubmitProjectionV1(metadata, continuation, projectId, null, draft.composerAnchor)
    expect(value?.submissionKind).toBe('continuation')
    expect(value?.acknowledgement).toBe('acknowledged')
    expect(value?.allowedActions).toEqual(['submit_continuation', 'open_recovery', 'refresh'])
  })

  it('op 已 resolved → 回到 run kind（无 open_recovery）', async () => {
    const { metadata, projectId, conversationId, continuation, draft } = await setup()
    metadata.saveCommandDraft({ ...draft, receiverId: conversationId })
    const service = continuation as ConversationContinuationService
    service.submit(submitOp(projectId, conversationId, 'op-done'))
    service.advanceStep(projectId, 'op-done', { step: 'external_create', outcome: 'confirmed', externalEvidence: { schemaVersion: 1, provider: 'codex', externalSessionId: 'sess-done', correlationId: 'corr-done', createdAt: now } })
    service.advanceStep(projectId, 'op-done', { step: 'core_bind', outcome: 'confirmed' })
    service.advanceStep(projectId, 'op-done', { step: 'attach', outcome: 'confirmed' })
    service.advanceStep(projectId, 'op-done', { step: 'projection', outcome: 'confirmed' })
    const value = composerSubmitProjectionV1(metadata, continuation, projectId, null, draft.composerAnchor)
    expect(value?.submissionKind).toBe('run')
    expect(value?.allowedActions).toEqual(['submit_run', 'refresh'])
  })
})
