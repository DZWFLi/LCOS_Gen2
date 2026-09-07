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

import { create } from 'zustand';

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

/** Left edge band => the navigation dock surface. */
const DOCK_LEFT = 'surface:left-dock';
/** Bottom edge band => the bottom dock surface. */
const DOCK_BOTTOM = 'surface:bottom-dock';

function destinationFor(anchor: 'left' | 'bottom', at: SurfacePoint): DropDestination {
  return {
    kind: 'slot',
    anchor,
    surface: anchor === 'left' ? DOCK_LEFT : DOCK_BOTTOM,
    place: { x: at.x, y: at.y },
  };
}

export interface LcosDropState {
  /** Pure Semantic Drop machine state (fabric lives in web-gen2). */
  state: SemanticDropState;
  /** Screen-space canvas bounds the dwell anchors are judged against. */
  bounds: DropBounds | null;

  /** Acquire a payload and begin a spatial drop. Data sources call this. */
  begin(payload: DropPayload): void;
  /** Cache the live canvas surface bounds (from the wrapper bounding rect). */
  setBounds(bounds: DropBounds): void;
  /** Drive the machine from a screen-space pointer position. */
  advance(pointPx: SurfacePoint, overDestination: boolean, now: number): void;
  /** Confirm a preview; the concrete surface write is Phase C's job. */
  commitAt(transactionId: string): void;
  /** Surface a recoverable/permanent failure. */
  fail(reason: string, recoverable: boolean): void;
  /** Abort an uncommitted drop (pointer released / gesture cancelled). */
  cancel(): void;
  reset(): void;
}

export const useLcosDropStore = create<LcosDropState>((set, get) => ({
  state: idleDrop(),
  bounds: null,

  begin: (payload) => set({ state: beginDrop(payload) }),

  setBounds: (bounds) => set({ bounds }),

  advance: (pointPx, overDestination, now) => {
    const { state, bounds } = get();
    if (state.status === 'idle' || state.status === 'committing' || state.status === 'failed') {
      return;
    }
    // No surface known yet => nothing spatial to judge against; stay put.
    if (!bounds) return;

    let next = advanceDropIntent(state, pointPx, bounds, now, overDestination);
    // A dwell that has elapsed resolves into a concrete preview (spatial
    // intent expressed purely by the edge anchor + surface). completeDropDwell
    // itself gates on the dwell window, so this is idempotent.
    if (next.status === 'dwell') {
      next = completeDropDwell(next, destinationFor(next.anchor, next.originPx), now);
    }
    set({ state: next });
  },

  commitAt: (transactionId) => {
    const { state } = get();
    if (state.status !== 'preview') return;
    set({ state: confirmDrop(state, transactionId) });
  },

  fail: (reason, recoverable) => {
    const { state } = get();
    set({ state: failDrop(state, reason, recoverable) });
  },

  cancel: () => set({ state: idleDrop() }),

  reset: () => set({ state: idleDrop(), bounds: null }),
}));