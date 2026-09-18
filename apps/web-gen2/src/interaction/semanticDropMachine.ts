// Semantic Drop state machine (Phase A06) — lifted from Gen1 `features/drop/
// dropIntentMachine.ts` (pure logic only; old canvas/DOM/viewport coupling
// retired — Huabu is the geometry owner).
//
// F-ROOT-05: Drop is spatial placement, not a callback. F-ROOT-11: no sensor
// zone + pop-up menu. A DropPayload may only express: an existing object ref,
// an external file, text/URL, or an assembly item. A destination must never
// open a second taxonomy picker — if the target is ambiguous the preview says
// what WILL happen, and the user moves onto a specific registered target to
// commit.
//
// dwellMs starts at 420ms per the A06 task card: the Huabu pointer router and
// desktop event rhythm differ, and touch/silky feel is judged after real drag
// sessions — the token is a single knob (was 520ms in Gen1).

import type { AssemblySourceRefV1 } from '@local-creative-os/contracts';

/** A point in the coordinate system the caller gives us (px by default). */
export type SurfacePoint = { readonly x: number; readonly y: number };

/** Bounds of the region whose edges host the dwell anchors (px, screen space). */
export interface DropBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/**
 * What is being dropped. Closed four-shape union — never a taxonomy generator.
 */
export type DropPayload =
  | { readonly kind: 'object'; readonly entityType: string; readonly entityId: string }
  | { readonly kind: 'file'; readonly name: string; readonly size?: number; readonly mime?: string }
  | { readonly kind: 'text' | 'url'; readonly value: string }
  /** Assembly rows carry the canonical source ref; itemId alone is not an identity. */
  | { readonly kind: 'assembly'; readonly itemId: string; readonly sourceRef: AssemblySourceRefV1 };

/**
 * The spatial intent the user has expressed by hovering a registered target.
 * `targetId` is stable for the gesture; the host owns its semantic descriptor
 * and the resolver owns the business operation. The pure machine deliberately
 * knows nothing about Canvas, Railway, Composer, DOM, or React.
 */
export interface DropDestination {
  readonly targetId: string;
  readonly previewPoint: SurfacePoint;
}

/** Small frozen reference retained through the commit lifecycle. */
export interface DropIntentSnapshot {
  readonly kind: string;
  readonly targetId: string;
}

export type SemanticDropState =
  | { readonly status: 'idle' }
  | { readonly status: 'tracking'; readonly payload: DropPayload }
  | { readonly status: 'dwell'; readonly payload: DropPayload; readonly anchor: 'left' | 'bottom'; readonly originPx: SurfacePoint; readonly since: number }
  | {
      readonly status: 'preview';
      readonly payload: DropPayload;
      readonly destination: DropDestination;
      /** Gesture hysteresis only; never a destination identity. */
      readonly carryAnchor: 'left' | 'bottom';
    }
  | {
      readonly status: 'committing';
      readonly payload: DropPayload;
      readonly destination: DropDestination;
      readonly carryAnchor: 'left' | 'bottom';
      readonly intent: DropIntentSnapshot;
      readonly transactionId: string;
    }
  | { readonly status: 'failed'; readonly reason: string; readonly recoverable: boolean };

/**
 * Tokens re-scaled for Huabu (screen/desktop events differ from Gen1's).
 * `edgeScrollBand` = the reserved edge band that maps to the left-dock.
 */
export const DROP_INTENT_TOKENS = {
  edgeScrollBand: 128,
  dwellBand: 56,
  dwellMs: 420,
  dwellRadius: 10,
  cancelDistance: 16,
} as const;

export const idleDrop = (): SemanticDropState => ({ status: 'idle' });

/** A drop gesture begins the moment a payload is acquired (drag/file/object). */
export function beginDrop(payload: DropPayload): SemanticDropState {
  return { status: 'tracking', payload };
}

export function anchoringAt(point: SurfacePoint, bounds: DropBounds): 'left' | 'bottom' | null {
  if (point.y >= bounds.bottom - DROP_INTENT_TOKENS.dwellBand && point.y < bounds.bottom) return 'bottom';
  if (point.x >= bounds.left && point.x <= bounds.left + DROP_INTENT_TOKENS.dwellBand) return 'left';
  return null;
}

/** Hysteresis: once previewed, the drop stays until it leaves this band. */
export function inDropPreviewCarryZone(point: SurfacePoint, bounds: DropBounds, anchor: 'left' | 'bottom'): boolean {
  const h = DROP_INTENT_TOKENS.cancelDistance;
  if (anchor === 'bottom') {
    return point.y >= bounds.bottom - DROP_INTENT_TOKENS.edgeScrollBand - h && point.y < bounds.bottom + h;
  }
  return point.x >= bounds.left - h && point.x <= bounds.left + DROP_INTENT_TOKENS.edgeScrollBand + h;
}

/**
 * Nominal edge anchor used purely as gesture hysteresis when the pointer rests
 * on a live registered destination outside any edge band. It is never a
 * destination identity — the destination is the registered target the host
 * resolved under the pointer.
 */
export function nominalAnchorAt(point: SurfacePoint, bounds: DropBounds): 'left' | 'bottom' {
  const toLeft = Math.abs(point.x - bounds.left);
  const toBottom = Math.abs(bounds.bottom - point.y);
  return toLeft <= toBottom ? 'left' : 'bottom';
}

/**
 * Pure reducer over pointer movement (screen-space px already transformed by
 * the caller's viewport transformer; placement only happens in world space at
 * commit time).
 */
export function advanceDropIntent(
  state: SemanticDropState,
  pointPx: SurfacePoint,
  bounds: DropBounds,
  now: number,
  overDestination = false,
  destination?: DropDestination,
): SemanticDropState {
  if (state.status === 'idle' || state.status === 'committing' || state.status === 'failed') return state;

  if (state.status === 'preview') {
    // A live target can change while the pointer remains inside the broad
    // carry zone. In that case invalidate the old preview; the host must
    // dwell/resolve the new target before any commit is possible.
    if (
      overDestination &&
      destination !== undefined &&
      destination.targetId !== state.destination.targetId
    ) {
      return { status: 'tracking', payload: state.payload };
    }
    return overDestination || inDropPreviewCarryZone(pointPx, bounds, state.carryAnchor)
      ? state
      : { status: 'tracking', payload: state.payload };
  }

  if (state.status === 'tracking') {
    const anchor = anchoringAt(pointPx, bounds);
    // A live registered destination is itself a dwell host: resting on the
    // target the user is pointing at expresses intent without any edge band
    // (F-ROOT-05: drop is spatial placement — dropping where you point must
    // use that target). The edge band remains the anchor for the bare-canvas
    // case, where no destination has resolved yet.
    if (anchor === null && !overDestination) return state;
    return {
      status: 'dwell',
      payload: state.payload,
      anchor: anchor ?? nominalAnchorAt(pointPx, bounds),
      originPx: pointPx,
      since: now,
    };
  }

  // dwell
  // Resting on a live destination keeps the dwell alive by stillness alone;
  // edge geometry is not the intent in that case (the host owns the real
  // target identity, and it has already been resolved under the pointer).
  if (overDestination) {
    const driftOnTarget = Math.hypot(pointPx.x - state.originPx.x, pointPx.y - state.originPx.y);
    return driftOnTarget <= DROP_INTENT_TOKENS.dwellRadius ? state : { status: 'tracking', payload: state.payload };
  }
  const anchorNow = anchoringAt(pointPx, bounds);
  if (!anchorNow || anchorNow !== state.anchor) return { status: 'tracking', payload: state.payload };
  const drift = Math.hypot(pointPx.x - state.originPx.x, pointPx.y - state.originPx.y);
  return drift <= DROP_INTENT_TOKENS.dwellRadius ? state : { status: 'tracking', payload: state.payload };
}

/** Complete a dwell into a concrete preview (destination resolved for the anchor). */
export function completeDropDwell(state: SemanticDropState, destination: DropDestination, now: number): SemanticDropState {
  if (state.status !== 'dwell') return state;
  if (now - state.since < DROP_INTENT_TOKENS.dwellMs) return state;
  return {
    status: 'preview',
    payload: state.payload,
    destination,
    carryAnchor: state.anchor,
  };
}

export function dropDwellRemainingMs(state: SemanticDropState, now: number): number {
  if (state.status !== 'dwell') return 0;
  return Math.max(0, DROP_INTENT_TOKENS.dwellMs - (now - state.since));
}

export function confirmDrop(
  state: SemanticDropState,
  transactionId: string,
  intent?: DropIntentSnapshot,
): SemanticDropState {
  if (state.status !== 'preview' || intent === undefined) return state;
  if (intent.targetId !== state.destination.targetId) return state;
  return {
    status: 'committing',
    payload: state.payload,
    destination: state.destination,
    carryAnchor: state.carryAnchor,
    intent,
    transactionId,
  };
}

/** Fail the drop. State-independent override — it always ends in `failed`. */
export function failDrop(_state: SemanticDropState, reason: string, recoverable: boolean): SemanticDropState {
  return { status: 'failed', reason, recoverable };
}
