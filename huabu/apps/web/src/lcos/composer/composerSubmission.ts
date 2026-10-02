import type { CoreEntityRefLike } from '../referenceBridge';
import type { LcosComposerTarget } from '../shell/lcosShellStore';
import type { CollaborationSendInputV1 } from '@local-creative-os/contracts';
import type { CreateRunInputV1 } from '@local-creative-os/web-gen2';
import { prepareDraftReferences, draftReferenceUnavailableReason, runReferenceUnavailableReason } from './referenceSnapshot';
import { buildSelectedContextReferences } from '../professional/conversationContinuationActions';



export interface ComposerSubmissionInput {
  readonly projectId: string;
  readonly instruction: string;
  readonly workspaceId: string;
  readonly target: LcosComposerTarget;
  readonly refs: readonly CoreEntityRefLike[];
}

export interface ComposerContinuationSubmissionInput {
  readonly conversationId: string;
  readonly continuationOperationId: string;
  readonly messageId: string;
  readonly text: string;
  readonly refs: readonly CoreEntityRefLike[];
}

/** Build the exact Core Run payload; receiver identity is never inferred from labels or node ids. */
export function buildComposerRunInput(input: ComposerSubmissionInput): CreateRunInputV1 {
  const inputs = [...(input.target.targetReferences ?? []), ...input.refs];
  // Check every offered input before identity deduplication can hide a conflict.
  const blocked = inputs.map(runReferenceUnavailableReason).find(Boolean);
  if (blocked) throw new Error(blocked);
  const prepared = inputs.length ? prepareDraftReferences(inputs, 'delegate') : { ok: true as const, references: inputs };
  if (!prepared.ok) throw new Error(prepared.reason);
  const selected = buildSelectedContextReferences(prepared.references);
  if (selected.unsupportedEntityTypes.length > 0) throw new Error('本轮含暂不支持的引用，请先移除或转换为可读取的材料。');
  return {
    instruction: input.instruction,
    outputIntent: 'analyze',
    contextArtifactIds: [...new Set(prepared.references.filter((ref) => ref.entityType === 'artifact').map((ref) => ref.entityId))],
    orderedReferences: selected.orderedReferences,
    ...(input.target.receiverConversationId === undefined
      ? {}
      : { receiverRef: { connectedConversationId: input.target.receiverConversationId } }),
    workspaceId: input.workspaceId,
  };
}

export function canSubmitComposerTarget(
  target: LcosComposerTarget,
  instruction: string,
  workspaceId: string | undefined,
): boolean {
  return (
    instruction.trim().length > 0 &&
    workspaceId !== undefined &&
    target.receiverBlockedReason === undefined &&
    (target.targetReferences ?? []).every((ref) => !runReferenceUnavailableReason(ref))
  );
}

/**
 * Continue has a narrower identity contract than delegate and deliberately
 * does not require workspaceId. References are blocked until the continuation
 * attach protocol exists; dropping them would make the user's draft lie.
 */
export function canSubmitComposerContinuation(
  target: LcosComposerTarget,
  instruction: string,
  refs: readonly CoreEntityRefLike[],
): boolean {
  const selected = buildSelectedContextReferences(refs);
  return (
    target.intent === 'continue' &&
    instruction.trim().length > 0 &&
    target.receiverConversationId !== undefined &&
    target.continuationOperationId !== undefined &&
    target.messageId !== undefined &&
    refs.every((ref) => !draftReferenceUnavailableReason(ref, 'continue')) &&
    selected.unsupportedEntityTypes.length === 0 &&
    target.receiverBlockedReason === undefined
  );
}

export function buildComposerContinuationInput(
  input: ComposerContinuationSubmissionInput,
): CollaborationSendInputV1 {
  const prepared = input.refs.length ? prepareDraftReferences(input.refs, 'continue') : { ok: true as const, references: input.refs };
  if (!prepared.ok) throw new Error(prepared.reason);
  const selected = buildSelectedContextReferences(prepared.references);
  return {
    conversationId: input.conversationId,
    text: input.text.trim(),
    ...(selected.orderedReferences.length === 0 ? {} : { orderedReferences: selected.orderedReferences }),
    continuationOperationId: input.continuationOperationId,
    messageId: input.messageId,
  };
}
