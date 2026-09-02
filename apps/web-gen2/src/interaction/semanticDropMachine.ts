// Semantic Drop state machine (Phase A06) — lifted from Gen1 `features/drop/
// dropIntentMachine.ts` (pure logic only; old canvas/DOM/viewport coupling
// retired — Huabu is the geometry owner).
//
// F-ROOT-05: Drop is spatial placement, not a callback. F-ROOT-11: no sensor
// zone + pop-up menu. A DropPayload may only express: an existing object ref,
// an external file, text/URL, or an assembly item. A destination must never
// open a second taxonomy picker — if the target is ambiguous the preview says
// what WILL happen, and the user moves onto a specific container/slot to
// commit.

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
  | { readonly kind: 'assembly'; readonly itemId: string };

/**
 * The spatial intent the user has expressed by hovering a container/slot.
 * Phase A: expressed purely by edge anchor + surface; a richer container/slot
 * model lands with Phase C surfaces.
 */
export interface DropDestination {
  readonly kind: 'slot';
  readonly anchor: 'left' | 'bottom';
  readonly surface: string;
  /** World/space placement point, converted by the Huabu viewport transformer. */
  readonly place: SurfacePoint;
}

export type SemanticDropState =
  | { readonly status: 'idle' }
  | { readonly status: 'tracking'; readonly payload: DropPayload }
  | { readonly status: 'dwell'; readonly payload: DropPayload; readonly anchor: 'left' | 'bottom'; readonly originPx: SurfacePoint; readonly since: number }
  | { readonly status: 'preview'; readonly payload: DropPayload; readonly destination: DropDestination }
  | { readonly status: 'committing'; readonly transactionId: string }
  | { readonly status: 'failed'; readonly reason: string; readonly recoverable: boolean };

/**
 * Tokens re-scaled for Huabu (screen/desktop events differ from Gen1's).
 * `navigationWidthPx` = reserved edge band that maps to the left-dock.
 */
export const DROP_INTENT_TOKENS = {
  edgeScrollBand: 128,
  dwellBand: 56,
  dwellMs: 520,
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
): SemanticDropState {
  if (state.status === 'idle' || state.status === 'committing' || state.status === 'failed') return state;

  if (state.status === 'preview') {
    return overDestination || inDropPreviewCarryZone(pointPx, bounds, state.destination.anchor) ? state : { status: 'tracking', payload: state.payload };
  }

  if (state.status === 'tracking') {
    const anchor = anchoringAt(pointPx, bounds);
    if (!anchor) return state;
    return { status: 'dwell', payload: state.payload, anchor, originPx: pointPx, since: now };
  }

  // dwell
  const anchorNow = anchoringAt(pointPx, bounds);
  if (!anchorNow || anchorNow !== state.anchor) return { status: 'tracking', payload: state.payload };
  const drift = Math.hypot(pointPx.x - state.originPx.x, pointPx.y - state.originPx.y);
  return drift <= DROP_INTENT_TOKENS.dwellRadius ? state : { status: 'tracking', payload: state.payload };
}

/** Complete a dwell into a concrete preview (destination resolved for the anchor). */
export function completeDropDwell(state: SemanticDropState, destination: DropDestination, now: number): SemanticDropState {
  if (state.status !== 'dwell') return state;
  if (now - state.since < DROP_INTENT_TOKENS.dwellMs) return state;
  return { status: 'preview', payload: state.payload, destination };
}

export function dropDwellRemainingMs(state: SemanticDropState, now: number): number {
  if (state.status !== 'dwell') return 0;
  return Math.max(0, DROP_INTENT_TOKENS.dwellMs - (now - state.since));
}

export function confirmDrop(state: SemanticDropState, transactionId: string): SemanticDropState {
  return state.status === 'preview' ? { status: 'committing', transactionId } : state;
}

export function failDrop(state: SemanticDropState, reason: string, recoverable: boolean): SemanticDropState {
  return { status: 'failed', reason, recoverable };
}