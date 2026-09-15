import type { CoreEntityRefLike } from '../referenceBridge';
import type { LcosComposerTarget } from '../shell/lcosShellStore';
import type { CreateRunInputV1 } from '@local-creative-os/web-gen2';



export interface ComposerSubmissionInput {
  readonly projectId: string;
  readonly instruction: string;
  readonly workspaceId: string;
  readonly target: LcosComposerTarget;
  readonly refs: readonly CoreEntityRefLike[];
}

/** Build the exact Core Run payload; receiver identity is never inferred from labels or node ids. */
export function buildComposerRunInput(input: ComposerSubmissionInput): CreateRunInputV1 {
  return {
    instruction: input.instruction,
    outputIntent: 'analyze',
    contextArtifactIds: input.refs
      .filter((ref) => ref.entityType === 'artifact')
      .map((ref) => ref.entityId),
    orderedReferences: input.refs.map((ref) => ({
      entityType: ref.entityType,
      entityId: ref.entityId,
    })),
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
    target.receiverBlockedReason === undefined
  );
}
