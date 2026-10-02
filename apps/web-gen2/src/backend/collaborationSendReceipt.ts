import { collaborationProductErrorV1 } from '@local-creative-os/contracts';
import type { CollaborationCommandResultV1, CollaborationSendInputV1, CollaborationReceiptV1, CollaborationProductErrorCodeV1 } from '@local-creative-os/contracts';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** Only the documented Core send receipt can acknowledge a message. HTTP success alone cannot. */
export function normalizeCollaborationSendReceipt(value: unknown, input: CollaborationSendInputV1): CollaborationCommandResultV1 {
  if (record(value) && value.ok === false && record(value.error) && typeof value.error.userMessage === 'string') {
    const codes: readonly string[] = ['unavailable', 'needs_recovery', 'permission_required', 'input_required', 'provider_offline', 'operation_unknown', 'operation_failed', 'cancelled'];
    const code = typeof value.error.code === 'string' && codes.includes(value.error.code) ? value.error.code as CollaborationProductErrorCodeV1 : 'operation_unknown';
    return { ok: false, error: collaborationProductErrorV1(code, value.error.userMessage,
      { retryable: value.error.retryable === true, ...(typeof value.error.diagnosticsRef === 'string' ? { diagnosticsRef: value.error.diagnosticsRef } : {}) }) };
  }
  const candidate = record(value) && (value.ok === true || value.ok === undefined) && record(value.receipt)
    ? value.receipt : value;
  if (record(candidate) && candidate.ok !== false && candidate.schemaVersion === 1 && candidate.command === 'send'
    && candidate.conversationId === input.conversationId
    && candidate.continuationOperationId === input.continuationOperationId
    && typeof candidate.acceptedAt === 'string' && Number.isFinite(Date.parse(candidate.acceptedAt))) {
    return { ok: true, receipt: { schemaVersion: 1, command: 'send', acceptedAt: candidate.acceptedAt,
      conversationId: input.conversationId, continuationOperationId: input.continuationOperationId } as CollaborationReceiptV1 };
  }
  return { ok: false, error: collaborationProductErrorV1('operation_unknown',
    '发送结果未能确认，草稿已保留。请核对会话记录或重试同一条原消息。', { retryable: true }) };
}
