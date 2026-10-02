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
import { snapshotDraftReference, prepareDraftReferences, draftReferenceUnavailableReason } from './composer/referenceSnapshot';

import {
  createReferenceControllerState,
  orderedReferences,
  removeReference,
  sameDraftReference,
  toggleReference,
  type CoreEntityRefLike,
  type ReferenceControllerState,
} from './referenceBridge';

import type { ProjectedNodeDescriptor } from '@local-creative-os/web-gen2';

/**
 * 节点 → Core 实体引用（R2 起附带呈现描述）。
 * descriptor 是**呈现事实**（kind/可用性/revision → 次级行 + 物种），由 host 在
 * reconcile 后从 Core 快照派生；点取时把所见 revision 捕获到草稿地址，后续 descriptor 更新不改已选版本，
 * 也不落库、不复制真值。
 */
export interface LcosNodeEntityRef extends CoreEntityRefLike {
  readonly descriptor?: ProjectedNodeDescriptor;
  /** Ephemeral display label for references selected outside a projected node. */
  readonly displayLabel?: string;
}

export interface LcosReferenceState {
  projectId: string | null;
  /** Ephemeral pick gesture; refs still belong only to draft. */
  referencePickOwner: string | null;
  setReferencePickOwner(owner: string | null): void;
  /** Restore only this project's explicit draft; node bindings are re-read. */
  setProject(projectId: string): void;
  /** Read lifecycle for this presentation cache, not another binding/domain owner. */
  bindingCanvasId: string | null;
  bindingReadStatus: 'idle' | 'loading' | 'ready' | 'error';
  /** The first canonical identity list has resolved for bindingCanvasId (including an empty list). */
  bindingIdentitiesReady: boolean;
  bindingRefreshVersion: number;
  beginNodeBindingRead(projectId: string, canvasId: string): void;
  applyNodeBindings(projectId: string, canvasId: string,
    bindings: readonly { spatialId: string; entityType: string; entityId: string; descriptor?: ProjectedNodeDescriptor }[],
    status: 'loading' | 'ready'): void;
  failNodeBindingRead(projectId: string, canvasId: string): void;
  requestNodeBindingRefresh(): void;
  /** nodeId → Core entity ref, populated at projection time. */
  nodeEntityRefs: ReadonlyMap<string, LcosNodeEntityRef>;
  /** Ordered explicit references of the active composer draft. */
  draft: ReferenceControllerState<LcosNodeEntityRef>;

  registerNodeEntity(nodeId: string, ref: LcosNodeEntityRef): void;
  /** Clear the whole binding-derived node->ref cache (re-sync after reconcile). */
  resetNodeEntities(): void;
  forgetNode(nodeId: string): void;
  /** Toggle one node's entity in the ordered draft references. */
  toggleNodeReference(nodeId: string, intent?: string): boolean;
  /** Toggle the exact material captured when the user pressed, not a later revision. */
  toggleEntityReference(ref: LcosNodeEntityRef, intent?: string): boolean;
  /**（Wave 5）直接把实体加入草稿（Assembly/卡面条目；Selection≠Reference）。 */
  addEntityToDraft(ref: LcosNodeEntityRef, intent?: string): boolean;
  addEntitiesToDraft(refs: readonly LcosNodeEntityRef[], intent?: string): { readonly added: number; readonly reason?: string };
  /** Remove only this explicit reference; keep the entity, node and selection. */
  removeEntityFromDraft(ref: CoreEntityRefLike): void;
  /** Ordered read for the Reference Strip. */
  orderedNodeReferences(): readonly CoreEntityRefLike[];
  /** Is this node's entity currently referenced? (badge rendering) */
  isNodeReferenced(nodeId: string): boolean;
  reset(): void;
}

const projectDrafts = new Map<string, ReferenceControllerState<LcosNodeEntityRef>>();

export const useLcosReferenceStore = create<LcosReferenceState>((set, get) => ({
  projectId: null,
  referencePickOwner: null,
  setReferencePickOwner: (referencePickOwner) => set({ referencePickOwner }),
  bindingCanvasId: null, bindingReadStatus: 'idle', bindingIdentitiesReady: false, bindingRefreshVersion: 0,
  setProject: (projectId) => set((state) => {
    if (state.projectId === projectId) return state;
    if (state.projectId !== null) projectDrafts.set(state.projectId, state.draft);
    return {
      projectId,
      referencePickOwner: null,
      bindingCanvasId: null, bindingReadStatus: 'idle', bindingIdentitiesReady: false, bindingRefreshVersion: 0,
      nodeEntityRefs: new Map(),
      draft: projectDrafts.get(projectId) ?? createReferenceControllerState<LcosNodeEntityRef>('canvas-draft'),
    };
  }),
  nodeEntityRefs: new Map(),
  draft: createReferenceControllerState<LcosNodeEntityRef>('canvas-draft'),

  resetNodeEntities: () =>
    set({ nodeEntityRefs: new Map(), bindingCanvasId: null, bindingReadStatus: 'idle', bindingIdentitiesReady: false }),

  beginNodeBindingRead: (projectId, canvasId) => set((state) => state.projectId !== projectId ? state : ({
    bindingCanvasId: canvasId, bindingReadStatus: 'loading',
    bindingIdentitiesReady: state.bindingCanvasId === canvasId && state.bindingIdentitiesReady,
    nodeEntityRefs: state.bindingCanvasId === canvasId ? state.nodeEntityRefs : new Map(),
  })),
  applyNodeBindings: (projectId, canvasId, bindings, status) => set((state) => {
    if (state.projectId !== projectId || state.bindingCanvasId !== canvasId) return state;
    const next = new Map<string, LcosNodeEntityRef>();
    for (const binding of bindings) {
      const prior = state.nodeEntityRefs.get(binding.spatialId);
      // An early identity read may preserve an already visible descriptor for the same identity.
      // The authoritative final list replaces the set, removing deleted/reprojected identities.
      const descriptor = binding.descriptor ?? (status === 'loading'
        && prior?.entityType === binding.entityType && prior.entityId === binding.entityId ? prior.descriptor : undefined);
      next.set(binding.spatialId, { entityType: binding.entityType, entityId: binding.entityId,
        ...(descriptor === undefined ? {} : { descriptor }) });
    }
    return { nodeEntityRefs: next, bindingReadStatus: status, bindingIdentitiesReady: true };
  }),
  failNodeBindingRead: (projectId, canvasId) => set((state) =>
    state.projectId === projectId && state.bindingCanvasId === canvasId ? { bindingReadStatus: 'error' } : state),
  requestNodeBindingRefresh: () => set((state) => ({ bindingRefreshVersion: state.bindingRefreshVersion + 1 })),

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

  toggleNodeReference: (nodeId, intent) => {
    const ref = get().nodeEntityRefs.get(nodeId);
    return ref ? get().toggleEntityReference(snapshotDraftReference(ref), intent) : false;
  },

  toggleEntityReference: (ref, intent) => {
    const included = get().draft.orderedEntityRefs.some((item) => sameDraftReference(item, ref));
    if (!included && draftReferenceUnavailableReason(ref, intent)) return false;
    set((state) => ({ draft: toggleReference(state.draft, ref) }));
    return true;
  },

  addEntityToDraft: (ref, intent) => get().addEntitiesToDraft([ref], intent).reason === undefined,

  addEntitiesToDraft: (refs, intent) => {
    const prepared = prepareDraftReferences(refs, intent);
    if (!prepared.ok) return { added: 0, reason: prepared.reason };
    let added = 0;
    set((state) => {
      let draft = state.draft;
      for (const ref of prepared.references) {
        if (!draft.orderedEntityRefs.some((item) => sameDraftReference(item, ref))) {
          draft = toggleReference(draft, ref); added++;
        }
      }
      return draft === state.draft ? state : { draft };
    });
    return { added };
  },

  removeEntityFromDraft: (ref) => {
    set((state) => ({ draft: removeReference(state.draft, ref) }));
  },

  orderedNodeReferences: () => orderedReferences(get().draft),

  isNodeReferenced: (nodeId) => {
    const ref = get().nodeEntityRefs.get(nodeId);
    if (!ref) return false;
    return get().draft.orderedEntityRefs.some((x) => sameDraftReference(x, snapshotDraftReference(ref)));
  },

  reset: () => {
    projectDrafts.clear();
    set({
      projectId: null,
      referencePickOwner: null,
      bindingCanvasId: null, bindingReadStatus: 'idle', bindingIdentitiesReady: false, bindingRefreshVersion: 0,
      nodeEntityRefs: new Map(),
      draft: createReferenceControllerState<LcosNodeEntityRef>('canvas-draft'),
    });
  },
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
  const draft = removeReference(state.draft, snapshotDraftReference(ref));
  useLcosReferenceStore.setState({ draft });
  state.forgetNode(nodeId);
}
