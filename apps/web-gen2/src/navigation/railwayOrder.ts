import { railwayStableKeyV1 } from '@local-creative-os/contracts';
import type { ProjectViewRailRefV0 } from '@local-creative-os/contracts';

export type RailwayReorderPlacementV1 = 'before' | 'after';

export function railwayRefKeyV1(ref: ProjectViewRailRefV0): string {
  return `${ref.kind}:${ref.viewId}`;
}

/**
 * Move an exact raw Core ref while preserving every other ref byte-for-byte
 * and in its original order. Missing/duplicate keys fail closed as a no-op.
 */
export function reorderRailwayRefV1(
  orderedRefs: readonly ProjectViewRailRefV0[],
  movedKey: string,
  targetKey: string,
  placement: RailwayReorderPlacementV1,
): readonly ProjectViewRailRefV0[] {
  if (movedKey === targetKey) return orderedRefs;
  const movedIndex = orderedRefs.findIndex((ref) => railwayRefKeyV1(ref) === movedKey);
  const targetIndex = orderedRefs.findIndex((ref) => railwayRefKeyV1(ref) === targetKey);
  if (movedIndex < 0 || targetIndex < 0) return orderedRefs;
  const hasDuplicateMoved = orderedRefs.some(
    (ref, index) => railwayRefKeyV1(ref) === movedKey && index !== movedIndex,
  );
  const hasDuplicateTarget = orderedRefs.some(
    (ref, index) => railwayRefKeyV1(ref) === targetKey && index !== targetIndex,
  );
  if (hasDuplicateMoved || hasDuplicateTarget) return orderedRefs;
  const moved = orderedRefs[movedIndex];
  if (moved === undefined) return orderedRefs;
  const withoutMoved = orderedRefs.filter((_, index) => index !== movedIndex);
  const targetIndexAfterRemoval = withoutMoved.findIndex((ref) => railwayRefKeyV1(ref) === targetKey);
  if (targetIndexAfterRemoval < 0) return orderedRefs;
  const insertIndex = placement === 'before'
    ? targetIndexAfterRemoval
    : targetIndexAfterRemoval + 1;
  return [
    ...withoutMoved.slice(0, insertIndex),
    moved,
    ...withoutMoved.slice(insertIndex),
  ];
}

export function removeRailwayRefV1(
  orderedRefs: readonly ProjectViewRailRefV0[],
  removedKey: string,
): readonly ProjectViewRailRefV0[] {
  const index = orderedRefs.findIndex((ref) => railwayRefKeyV1(ref) === removedKey);
  return index < 0 ? orderedRefs : orderedRefs.filter((_, candidate) => candidate !== index);
}

/** Canonical V1 list manipulation. Hidden roots and unresolved records keep their order. */
export function moveRailwayDestination(
  refs: readonly import('@local-creative-os/contracts').RailwayStoredRefV1[],
  source: string, target: string, placement: 'before' | 'after',
): typeof refs {
  const from = refs.findIndex((ref) => railwayStableKeyV1(ref) === source);
  const to = refs.findIndex((ref) => railwayStableKeyV1(ref) === target);
  if (from < 0 || to < 0 || from === to) return refs;
  const next = refs.filter((_,index) => index !== from);
  const index = next.findIndex((ref) => railwayStableKeyV1(ref) === target);
  next.splice(index + (placement === 'after' ? 1 : 0), 0, refs[from]!);
  return next.every((ref,index) => ref === refs[index]) ? refs : next;
}
