import type { CoreCollaborationClient } from '@local-creative-os/web-gen2';
import type { ContinuationActionV1, ContinuationRecoveryProjectionV1 } from '@local-creative-os/contracts';

/** Re-read before a cross-system recovery mutation. Never create a replacement operation. */
export async function recoverConversationOperation(
  collaboration: Pick<CoreCollaborationClient, 'readDiagnostics' | 'recover'>,
  projectId: string, operation: ContinuationRecoveryProjectionV1, action: ContinuationActionV1,
  signal?: AbortSignal, ownerConversationId?: string,
) {
  const owner = ownerConversationId ?? operation.connectedConversationId;
  if (!owner) throw new Error('恢复操作没有可确认的会话归属，请先刷新身份');
  const diagnostics = await collaboration.readDiagnostics(projectId, owner, signal);
  if (signal?.aborted) throw new Error('已停止查看，未发起恢复');
  const fresh = diagnostics?.conversationId === owner
    ? diagnostics.operations.find((item) => item.projectId === projectId && item.operationId === operation.operationId
      && item.connectedConversationId === operation.connectedConversationId) : undefined;
  if (!fresh?.allowedActions.some((item) => item.action === action)) {
    throw new Error('该操作的可用动作已变化，请刷新会话后再处理');
  }
  const result = await collaboration.recover(projectId, {
    continuationOperationId: fresh.operationId, action, expectedRevision: fresh.revision,
  }, signal);
  if (!result.ok) throw new Error(result.error.userMessage);
  if (result.receipt.command !== 'recover' || result.receipt.continuationOperationId !== fresh.operationId) {
    throw new Error('恢复回执不匹配，请核对原操作，不要创建替代会话');
  }
  return fresh;
}

export async function cancelConversationRun(
  collaboration: Pick<CoreCollaborationClient, 'readSession' | 'cancel'>,
  projectId: string, conversationId: string, runId: string, signal?: AbortSignal,
) {
  const fresh = await collaboration.readSession(projectId, conversationId, signal);
  if (signal?.aborted) throw new Error('已停止查看，未发起取消');
  if (fresh?.projectId !== projectId || fresh.conversationId !== conversationId
    || fresh.activity.activeRunId !== runId || fresh.capabilities.canCancel !== true) {
    throw new Error('当前任务已变化或暂不能取消，请刷新后核对');
  }
  const result = await collaboration.cancel(projectId, { runId }, signal);
  if (!result.ok) throw new Error(result.error.userMessage);
  if (result.receipt.command !== 'cancel' || result.receipt.runId !== runId) throw new Error('取消回执未确认，请核对任务状态');
  return result.receipt;
}
