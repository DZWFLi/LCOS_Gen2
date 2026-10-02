import type { LcosComposerTarget } from '../shell/lcosShellStore';

/** UI address for the current task. Materials never change receiver, intent or message identity. */
export function composerInputKey(target: LcosComposerTarget | null): string | undefined {
  return target === null ? undefined : JSON.stringify([target.nodeId, target.intent ?? 'delegate',
    target.workspaceId ?? null, target.receiverConversationId ?? null,
    ...(target.targetNodeIds || target.targetReferences?.length ? [target.targetNodeIds ?? [target.nodeId], target.targetReferences?.map((ref) =>
      [ref.entityType, ref.entityId, ref.revisionId ?? null, ref.artifactViewId ?? null, ref.mode ?? null])] : [])]);
}

export interface ComposerCaret {
  readonly projectId: string;
  readonly targetKey: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export function restoredComposerCaret(saved: ComposerCaret | null, projectId: string,
  targetKey: string, text: string): { start: number; end: number } {
  if (!saved || saved.projectId !== projectId || saved.targetKey !== targetKey || saved.text !== text)
    return { start: text.length, end: text.length };
  return { start: Math.max(0, Math.min(text.length, saved.start)), end: Math.max(0, Math.min(text.length, saved.end)) };
}
