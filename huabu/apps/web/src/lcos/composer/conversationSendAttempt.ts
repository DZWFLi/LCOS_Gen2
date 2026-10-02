import type { CollaborationSendInputV1, CollaborationDiagnosticsV1 } from '@local-creative-os/contracts';

export interface ConversationSendAttempt {
  readonly projectId: string;
  readonly input: CollaborationSendInputV1;
  readonly phase: 'sending' | 'unconfirmed';
}
export const conversationSendKey = (projectId: string, conversationId: string): string => JSON.stringify([projectId, conversationId]);

export function captureConversationSend(projectId: string, input: CollaborationSendInputV1): ConversationSendAttempt {
  // The retry payload is a copy: editing the new draft cannot mutate an in-flight message.
  return { projectId, input: structuredClone(input), phase: 'sending' };
}
export function sameConversationSend(a: CollaborationSendInputV1, b: CollaborationSendInputV1): boolean {
  return a.conversationId === b.conversationId && a.continuationOperationId === b.continuationOperationId
    && a.messageId === b.messageId && a.text === b.text
    && JSON.stringify(a.orderedReferences ?? []) === JSON.stringify(b.orderedReferences ?? [])
    && JSON.stringify(a.targetRefs ?? []) === JSON.stringify(b.targetRefs ?? []);
}
export function isComposerSendShortcut(event: { readonly key: string; readonly ctrlKey: boolean; readonly metaKey: boolean;
  readonly isComposing?: boolean; readonly keyCode?: number; readonly repeat?: boolean }): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.isComposing !== true
    && event.keyCode !== 229 && event.repeat !== true;
}

/** An attach receipt is not a sent message. Only this exact Core journal can release an uncertain UI attempt. */
export function conversationSendWasRecorded(attempt: ConversationSendAttempt, diagnostics: CollaborationDiagnosticsV1 | undefined): boolean {
  if (diagnostics?.conversationId !== attempt.input.conversationId) return false;
  const operation = diagnostics.operations.find((op) => op.projectId === attempt.projectId
    && op.connectedConversationId === attempt.input.conversationId && op.operationId === attempt.input.continuationOperationId);
  const message = operation?.promptReceipts?.find((entry) => entry.messageId === attempt.input.messageId);
  const receipt = message?.sendReceipt;
  return receipt?.action === 'send' && receipt.outcome === 'sent' && receipt.operationId === attempt.input.continuationOperationId
    && (message?.explicitReferences === undefined || JSON.stringify(message.explicitReferences) === JSON.stringify(attempt.input.orderedReferences ?? []));
}

/** After a page reload there may be no local ticket. A genuine unresolved Core
 * send/attach receipt still prevents silently issuing a NEW message identity. */
export function hasUnconfirmedConversationMessage(projectId: string, conversationId: string, diagnostics: CollaborationDiagnosticsV1 | undefined): boolean {
  return diagnostics?.conversationId === conversationId && diagnostics.operations.some((op) =>
    op.projectId === projectId && op.connectedConversationId === conversationId && op.promptReceipts?.some((entry) =>
      entry.sendReceipt?.outcome !== 'sent' && (entry.receipt.error?.outcomeUnknown === true || entry.receipt.outcome === 'unresolved')));
}
