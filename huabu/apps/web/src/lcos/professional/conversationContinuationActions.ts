import type { CoreEntityRefLike } from '../referenceBridge';
import type { ComposerReferenceViewItem } from '../ui/nearfield/composerViewTypes';
import type { CollaborationProductErrorV1 } from '@local-creative-os/contracts';
import type { OrderedRunReferenceV2 } from '@local-creative-os/contracts';

export type ConversationContinuationAction =
  | 'continue_existing'
  | 'selected_context'
  | 'blank_new'
  | 'native_full_fork';

export interface ConversationContinuationIntent {
  readonly action: ConversationContinuationAction;
  readonly targetKey: string;
  readonly operationId: string;
  readonly orderedReferences?: readonly OrderedRunReferenceV2[];
}

/** Keep one caller-owned operation identity until the action is confirmed. */
export function retainContinuationIntent(
  current: ConversationContinuationIntent | undefined,
  action: ConversationContinuationAction,
  targetKey: string,
  allocate: () => string,
  orderedReferences?: readonly OrderedRunReferenceV2[],
): ConversationContinuationIntent {
  if (current?.action === action && current.targetKey === targetKey) return current;
  return {
    action,
    targetKey,
    operationId: allocate(),
    ...(orderedReferences === undefined ? {} : { orderedReferences: orderedReferences.map((item) => ({ ...item, ref: { ...item.ref } })) }),
  };
}

/** A successful receipt closes the intent; errors keep it for uncertain retry. */
export function settleContinuationIntent(
  current: ConversationContinuationIntent | undefined,
  action: ConversationContinuationAction,
  operationId: string,
  accepted: boolean,
): ConversationContinuationIntent | undefined {
  if (!accepted || current?.action !== action || current.operationId !== operationId) return current;
  return undefined;
}

export function createContinuationOperationId(action: ConversationContinuationAction): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `conversation-${action}-${suffix}`;
}

type OrderedReferenceResult = {
  readonly orderedReferences: readonly OrderedRunReferenceV2[];
  readonly unsupportedEntityTypes: readonly string[];
};

/** Convert the canonical ordered draft to the frozen continuation reference shape. */
export function buildSelectedContextReferences(
  refs: readonly CoreEntityRefLike[],
): OrderedReferenceResult {
  const orderedReferences: OrderedRunReferenceV2[] = [];
  const unsupportedEntityTypes: string[] = [];
  refs.forEach((ref, order) => {
    const mapped = toRunReference(ref);
    if (mapped === undefined) {
      if (!unsupportedEntityTypes.includes(ref.entityType)) unsupportedEntityTypes.push(ref.entityType);
      return;
    }
    orderedReferences.push({ ref: mapped, order, ...(ref.mode ? { mode: ref.mode } : {}) });
  });
  return { orderedReferences, unsupportedEntityTypes };
}

export function toRunReference(ref: CoreEntityRefLike): OrderedRunReferenceV2['ref'] | undefined {
  switch (ref.entityType) {
    case 'artifact': {
      if (ref.revisionId) return { type: 'artifact', artifactId: ref.entityId, revisionId: ref.revisionId };
      const viewId = (ref as CoreEntityRefLike & { artifactViewId?: string; descriptor?: { artifactViewId?: string } }).artifactViewId
        ?? (ref as CoreEntityRefLike & { descriptor?: { artifactViewId?: string } }).descriptor?.artifactViewId;
      return viewId ? { type: 'view', viewId } : { type: 'artifact', artifactId: ref.entityId };
    }
    case 'artifactView':
    case 'view': return ref.artifactId && ref.revisionId
      ? { type: 'artifact', artifactId: ref.artifactId, revisionId: ref.revisionId }
      : { type: 'view', viewId: ref.entityId };
    case 'scope': return { type: 'scope', scopeId: ref.entityId };
    case 'workspace': return { type: 'workspace', workspaceId: ref.entityId };
    case 'conversation': return { type: 'conversation', conversationSessionId: ref.entityId };
    case 'component': return { type: 'component', componentId: ref.entityId, ...(ref.presentationId ? { presentationId: ref.presentationId } : {}) };
    default: return undefined;
  }
}

/** Acknowledgement/immutable preview for one UI request. Lives in the existing Shell, not Core truth. */
export interface ContinuationUiRequest {
  readonly intent: ConversationContinuationIntent;
  readonly items: readonly ComposerReferenceViewItem[];
  readonly status: 'sending' | 'accepted' | 'error';
  readonly error?: CollaborationProductErrorV1;
}
