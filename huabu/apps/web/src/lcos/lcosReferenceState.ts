// LCOS reference state (Phase A03/A04 wiring) — the bridge between canvas
// spatial ids and the Gen2 reference controller.
//
// The label-idempotent spike projection (useLcosCanvasProps) creates Huabu
// nodes from Core artifacts; this store records the nodeId→entityRef mapping
// at projection time so the reference-pick recognizer can toggle the ordered
// draft references (interaction/referenceController.ts in web-gen2) when the
// user Ctrl/Cmd-clicks a projected node.
//
// The ordered reference list itself is presentation state for the current
// composer draft (Selection ≠ Reference ≠ Relation — the frozen A04 rule):
// it is NEVER derived from Huabu selection and never mutates Core truth.

import { create } from 'zustand';

import {
  createReferenceControllerState,
  orderedReferences,
  removeReference,
  sameEntityRef,
  toggleReference,
  type CoreEntityRefLike,
  type ReferenceControllerState,
} from './referenceBridge';

export interface LcosReferenceState {
  /** nodeId → Core entity ref, populated at projection time. */
  nodeEntityRefs: ReadonlyMap<string, CoreEntityRefLike>;
  /** Ordered explicit references of the active composer draft. */
  draft: ReferenceControllerState<CoreEntityRefLike>;

  registerNodeEntity(nodeId: string, ref: CoreEntityRefLike): void;
  /** Clear the whole binding-derived node->ref cache (re-sync after reconcile). */
  resetNodeEntities(): void;
  forgetNode(nodeId: string): void;
  /** Toggle one node's entity in the ordered draft references. */
  toggleNodeReference(nodeId: string): boolean;
  /** Ordered read for the Reference Strip. */
  orderedNodeReferences(): readonly CoreEntityRefLike[];
  /** Is this node's entity currently referenced? (badge rendering) */
  isNodeReferenced(nodeId: string): boolean;
  reset(): void;
}

export const useLcosReferenceStore = create<LcosReferenceState>((set, get) => ({
  nodeEntityRefs: new Map(),
  draft: createReferenceControllerState<CoreEntityRefLike>('canvas-draft'),

  resetNodeEntities: () =>
    set({ nodeEntityRefs: new Map() }),

  registerNodeEntity: (nodeId, ref) => {
    set((state) => {
      const next = new Map(state.nodeEntityRefs);
      next.set(nodeId, ref);
      return { nodeEntityRefs: next };
    });
  },

  forgetNode: (nodeId) => {
    set((state) => {
      const next = new Map(state.nodeEntityRefs);
      next.delete(nodeId);
      return { nodeEntityRefs: next };
    });
  },

  toggleNodeReference: (nodeId) => {
    const ref = get().nodeEntityRefs.get(nodeId);
    if (!ref) return false;
    set((state) => ({ draft: toggleReference(state.draft, ref) }));
    return true;
  },

  orderedNodeReferences: () => orderedReferences(get().draft),

  isNodeReferenced: (nodeId) => {
    const ref = get().nodeEntityRefs.get(nodeId);
    if (!ref) return false;
    return get().draft.orderedEntityRefs.some((x) => sameEntityRef(x, ref));
  },

  reset: () =>
    set({
      nodeEntityRefs: new Map(),
      draft: createReferenceControllerState<CoreEntityRefLike>('canvas-draft'),
    }),
}));

/**
 * Remove one entity from the draft when its canvas projection is deleted —
 * the pending draft must drop it, but the Core entity itself is untouched
 * (projection.remove ≠ entity.delete, the A15 rule).
 */
export function dropDraftReferenceOnNodeDelete(nodeId: string): void {
  const state = useLcosReferenceStore.getState();
  const ref = state.nodeEntityRefs.get(nodeId);
  if (!ref) return;
  const draft = removeReference(state.draft, ref);
  useLcosReferenceStore.setState({ draft });
  state.forgetNode(nodeId);
}
