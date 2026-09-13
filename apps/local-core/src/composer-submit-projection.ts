import type { ComposerSubmitProjectionV1 } from '@local-creative-os/contracts'
import type { ConversationContinuationService } from './conversation-continuation-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * T6（§3.2）：Composer submit projection —— 只读组合 CommandDraft + exact receiver +
 * canonical receipt（Run 或 continuation op）。
 *
 * 规则（可测试锚点）：
 * - 无 draft → undefined（404）。
 * - receiverId 未设 → ownerRef null，allowedActions 只允许 choose_receiver/refresh。
 * - 存在可恢复 continuation op（status ∉ {projected,cancelled,resolved}）→
 *   submissionKind='continuation'，并开放 open_recovery。
 * - 否则 submissionKind='run'。
 * - 存在 canonical receipt（continuation op 或 receiverRef Run）→ acknowledged；
 *   否则 unconfirmed（由消费 body 在会话内禁止重复提交，不阻塞首次提交）。
 */
export function composerSubmitProjectionV1(
  metadata: SqliteMetadataRepository,
  continuation: ConversationContinuationService | undefined,
  projectId: string,
  workspaceId: string | null,
  composerAnchor: string,
): ComposerSubmitProjectionV1 | undefined {
  const draft = metadata.getCommandDraft(projectId, workspaceId, composerAnchor)
  if (draft === undefined) return undefined
  const receiverId = draft.receiverId
  const ownerRef = receiverId === null
    ? null
    : metadata.getConnectedConversation(projectId, receiverId) !== undefined
      ? { kind: 'connected_conversation' as const, id: receiverId }
      : draft.surfaceId !== null
        ? { kind: 'workspace' as const, id: draft.surfaceId }
        : { kind: 'project' as const, id: projectId }

  const liveOps = receiverId === null
    ? []
    : (continuation?.list(projectId) ?? []).filter((op) =>
        op.connectedConversationId === receiverId
        && op.status !== 'projected' && op.status !== 'cancelled' && op.status !== 'resolved')
  const submissionKind = liveOps.length > 0 ? 'continuation' : 'run'
  const receiptExists = liveOps.length > 0
    ? true
    : receiverId !== null
      ? metadata.listRunsByReceiverConversation(projectId, receiverId, 1).length > 0
      : false

  let allowedActions: ComposerSubmitProjectionV1['allowedActions']
  if (receiverId === null) {
    allowedActions = ['choose_receiver', 'refresh']
  } else if (submissionKind === 'continuation') {
    allowedActions = ['submit_continuation', 'open_recovery', 'refresh']
  } else {
    allowedActions = ['submit_run', 'refresh']
  }

  return {
    schemaVersion: 1,
    projectId,
    composerAnchor,
    draftRevision: draft.updatedAt,
    receiverId,
    submissionKind,
    ownerRef,
    acknowledgement: receiptExists ? 'acknowledged' : 'unconfirmed',
    allowedActions,
  }
}
