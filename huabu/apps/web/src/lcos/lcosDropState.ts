// LCOS Semantic Drop presentation state (Phase A06) — the bridge between the
// A06 pointer recognizer and the canvas-level drop preview overlay.
//
// The pure fabric lives in web-gen2 (`interaction/semanticDropMachine.ts`);
// this store mirrors the lcosReferenceState pattern: it owns the current
// machine state plus the live screen-space canvas bounds, and exposes actions
// that delegate to the pure reducers. Nothing here mutates Core/canvas truth
// — it is presentation state for in-flight spatial placement only.
//
// A drop always BEGINS with a payload: the store's `begin(payload)` is the
// acquisition entry that drag sources call (native file drop, object drag,
// assembly pick). The recognizer then drives `advance()` from pointer
// position; the overlay renders what WILL happen once a dwell resolves into a
// preview. Phase A has no container/slot model yet, so the concrete surface
// placement commit lands with Phase C.

import {
  advanceDropIntent,
  beginDrop,
  completeDropDwell,
  confirmDrop,
  failDrop,
  idleDrop,
  type DropBounds,
  type DropDestination,
  type DropPayload,
  type SemanticDropState,
  type SurfacePoint,
} from '@local-creative-os/web-gen2';
import { create } from 'zustand';

import { DropTargetRegistry } from './drop/dropTargetRegistry';

import type { DropResolution, DropTargetRegistration } from './drop/dropTypes';


export interface LcosDropState {
  /** Pure Semantic Drop machine state (fabric lives in web-gen2). */
  state: SemanticDropState;
  /** Screen-space canvas bounds the dwell anchors are judged against. */
  bounds: DropBounds | null;
  /** The resolver result rendered by the current preview; retained for commit. */
  resolution: DropResolution | null;

  /** Register/unregister ephemeral screen-space targets for the active host. */
  registerTarget(target: DropTargetRegistration): () => void;
  unregisterTarget(targetId: string): void;
  targetAt(point: SurfacePoint): DropTargetRegistration | undefined;
  targets(): readonly DropTargetRegistration[];

  /** Acquire a payload and begin a spatial drop. Data sources call this. */
  begin(payload: DropPayload): void;
  /** Cache the live canvas surface bounds (from the wrapper bounding rect). */
  setBounds(bounds: DropBounds): void;
  /** Drive the machine from a screen-space pointer position. */
  /** A preview only exists when the host supplies a registered target. */
  advance(
    pointPx: SurfacePoint,
    overDestination: boolean,
    now: number,
    destination?: DropDestination,
    resolution?: DropResolution,
    placementPoint?: SurfacePoint,
  ): void;
  /** Confirm a preview with the exact resolver snapshot used to render it. */
  commitAt(transactionId: string): void;
  /** Surface a recoverable/permanent failure. */
  fail(reason: string, recoverable: boolean): void;
  /** Abort an uncommitted drop (pointer released / gesture cancelled). */
  cancel(): void;
  reset(): void;
}

// The registry is deliberately an ephemeral module singleton. It stores only
// live DOM geometry and semantic target descriptors; Core/Huabu remain the
// owners of every durable mutation. A single active project canvas is the
// current host contract, so a second persistence store is unnecessary here.
const liveTargetRegistry = new DropTargetRegistry();

export function getLcosDropTargetRegistry(): DropTargetRegistry {
  return liveTargetRegistry;
}

export const useLcosDropStore = create<LcosDropState>((set, get) => ({
  state: idleDrop(),
  bounds: null,
  resolution: null,

  registerTarget: (target) => liveTargetRegistry.register(target),
  unregisterTarget: (targetId) => liveTargetRegistry.unregister(targetId),
  targetAt: (point) => liveTargetRegistry.hitTest(point),
  targets: () => liveTargetRegistry.snapshot(),

  begin: (payload) => set({ state: beginDrop(payload), resolution: null }),

  setBounds: (bounds) => set({ bounds }),

  advance: (pointPx, overDestination, now, destination, resolution, placementPoint) => {
    const { state, bounds } = get();
    if (state.status === 'idle' || state.status === 'committing' || state.status === 'failed') {
      return;
    }
    // No surface known yet => nothing spatial to judge against; stay put.
    if (!bounds) return;

    // A live host target disappearing is different from a pure machine caller
    // omitting destination metadata: the real gesture must lose its old
    // preview immediately so release cannot commit an unmounted target.
    let next = state.status === 'preview' && destination === undefined
      ? { status: 'tracking' as const, payload: state.payload }
      : advanceDropIntent(
          state,
          pointPx,
          bounds,
          now,
          overDestination,
          destination,
        );
    // A dwell that has elapsed resolves into a concrete preview (spatial
    // intent expressed purely by the edge anchor + surface). completeDropDwell
    // itself gates on the dwell window, so this is idempotent.
    if (next.status === 'dwell' && destination !== undefined) {
      next = completeDropDwell(next, destination, now);
    }
    const resolved = next.status === 'preview' && resolution?.status === 'ready'
      ? {
          ...resolution,
          intent: resolution.intent.kind === 'assembly-apply' && placementPoint !== undefined
            ? { ...resolution.intent, placementPoint }
            : resolution.intent,
        }
      : next.status === 'preview' ? (resolution ?? null) : null;
    set({ state: next, resolution: resolved });
  },

  commitAt: (transactionId) => {
    const { state, resolution } = get();
    if (state.status !== 'preview') return;
    if (resolution?.status !== 'ready') return;
    const next = confirmDrop(state, transactionId, {
      kind: resolution.intent.kind,
      targetId: resolution.intent.targetId,
    });
    if (next.status === 'committing') set({ state: next });
  },

  fail: (reason, recoverable) => {
    const { state } = get();
    set({ state: failDrop(state, reason, recoverable) });
  },

  cancel: () => set({ state: idleDrop(), resolution: null }),

  reset: () => {
    liveTargetRegistry.clear();
    set({ state: idleDrop(), bounds: null, resolution: null });
  },
}));
