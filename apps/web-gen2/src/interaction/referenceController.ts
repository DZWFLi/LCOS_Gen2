// Reference controller (Phase A04) — the explicit, ORDERED reference list of
// the current Composer/Run draft. Lifted from Gen1 `commandDraft.ts`'s
// Selection ≠ Reference discipline:
//
//   Selection  = Huabu's transient canvas state (owned by the canvas).
//   Reference  = this draft's ordered explicit references (owned here).
//   Relation   = Core canonical truth (owned by Core).
//
// None of the three may ever be silently derived from another. Reference
// order is part of the input semantics — serialization must preserve it
// (no Set-based round-trips).
//
// The controller is generic over the entity-ref shape: it only ever compares
// `entityType` + `entityId`. The canonical CoreEntityRef (domain's closed
// RelationEntityType union) is the default; host apps whose refs carry a
// wider entityType (e.g. the Huabu bridge's structural string view) pass
// their own minimal shape.

import type { CoreEntityRef } from '../spatial/relationProjection.js';

/** Minimal entity identity the controller compares. */
export interface EntityRefLike {
  readonly entityType: string;
  readonly entityId: string;
}

/** Identity comparison for entity refs (type + id, nothing else). */
export function sameEntityRef<T extends EntityRefLike>(a: T, b: T): boolean {
  return a.entityType === b.entityType && a.entityId === b.entityId;
}

/** State of one composer's reference list. */
export interface ReferenceControllerState<T extends EntityRefLike = CoreEntityRef> {
  readonly composerId: string;
  readonly orderedEntityRefs: readonly T[];
}

export function createReferenceControllerState<T extends EntityRefLike = CoreEntityRef>(
  composerId: string,
): ReferenceControllerState<T> {
  return { composerId, orderedEntityRefs: [] };
}

/**
 * Toggle one entity in the ordered reference list: remove if present
 * (preserving the order of the rest), append at the END if absent.
 * Idempotent per entity (no duplicates), order-preserving, pure.
 */
export function toggleReference<T extends EntityRefLike>(
  state: ReferenceControllerState<T>,
  ref: T,
): ReferenceControllerState<T> {
  const at = state.orderedEntityRefs.findIndex((x) => sameEntityRef(x, ref));
  if (at >= 0) {
    return {
      ...state,
      orderedEntityRefs: state.orderedEntityRefs.filter((_, i) => i !== at),
    };
  }
  return { ...state, orderedEntityRefs: [...state.orderedEntityRefs, ref] };
}

/**
 * Remove an entity from the draft references (e.g. the node was deleted
 * from the canvas — the pending draft must drop it, but Core entity deletion
 * is a separate, explicit action).
 */
export function removeReference<T extends EntityRefLike>(
  state: ReferenceControllerState<T>,
  ref: T,
): ReferenceControllerState<T> {
  return {
    ...state,
    orderedEntityRefs: state.orderedEntityRefs.filter(
      (x) => !sameEntityRef(x, ref),
    ),
  };
}

/** Ordered read for serialization — always a fresh array, order preserved. */
export function orderedReferences<T extends EntityRefLike>(
  state: ReferenceControllerState<T>,
): readonly T[] {
  return [...state.orderedEntityRefs];
}

/**
 * Opening a Composer must NOT copy the current selection into references
 * (A04 test: "opening Composer does not copy selection"). This helper makes
 * the empty start explicit at the call site.
 */
export function openComposerReferences<T extends EntityRefLike = CoreEntityRef>(
  composerId: string,
): ReferenceControllerState<T> {
  return createReferenceControllerState<T>(composerId);
}
