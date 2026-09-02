// Adaptive node presentation protocol (Phase A02) — the shared input every
// LCOS renderer consumes to decide how much information to show.
//
// This module is pure and framework-agnostic: it only defines the input
// shape and the density resolver. The DATA is supplied by the Huabu
// NodeWrapper via the lcos-seam presentation context (screen size derives
// from world size × zoom; DPR affects crispness/hit calibration only and
// must never flip density on its own).
//
// Thresholds below are initial presets, NOT product-domain semantics —
// Phase B's responsive matrix recalibrates them against real species.

/** Information level a renderer should present. */
export type PresentationDensity = 'mark' | 'summary' | 'working' | 'reading';

/** What the user is currently doing with (or to) the node. */
export type InteractionPhase =
  | 'rest'
  | 'hover'
  | 'selected'
  | 'editing'
  | 'dragging'
  | 'resizing';

/**
 * Explicit presentation mode for text-family species (same Markdown
 * artifact, three faces). Absent = species default.
 */
export type ExplicitPresentationMode = 'text' | 'outline' | 'mindmap';

/** The one adaptive input every LCOS node renderer shares. */
export interface NodePresentationInput {
  /** Node size in canvas/world units. */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** Current canvas zoom (screen px per world px). */
  readonly zoom: number;
  /** Device pixel ratio — crispness/hit calibration only, never density. */
  readonly dpr: number;
  /** worldWidth × zoom — what the user actually sees. */
  readonly screenWidth: number;
  /** worldHeight × zoom. */
  readonly screenHeight: number;
  readonly phase: InteractionPhase;
  readonly explicitMode?: ExplicitPresentationMode;
}

/** Initial screen-pixel thresholds (Phase B recalibrates per species). */
export const SCREEN_DENSITY_THRESHOLDS = {
  /** Below this min(screen) the node can only be a mark. */
  markMinScreen: 44,
  /** Below this screen width a mark is still the honest level. */
  markMinScreenWidth: 84,
  summaryMaxScreenWidth: 180,
  summaryMaxScreenHeight: 84,
  workingMaxScreenWidth: 480,
  workingMaxScreenHeight: 260,
} as const;

/**
 * Resolve the information level from screen size + interaction phase.
 *
 * Rules (frozen by the Phase A task card):
 * - `editing` always reads `working` — editing must never collapse into a
 *   mark just because the user zoomed out mid-edit.
 * - Density is a function of SCREEN pixels (world × zoom), never world
 *   units alone; DPR is not consulted.
 */
export function resolvePresentationDensity(
  input: NodePresentationInput,
): PresentationDensity {
  if (input.phase === 'editing') return 'working';

  const minScreen = Math.min(input.screenWidth, input.screenHeight);
  if (minScreen < SCREEN_DENSITY_THRESHOLDS.markMinScreen) return 'mark';
  if (input.screenWidth < SCREEN_DENSITY_THRESHOLDS.markMinScreenWidth)
    return 'mark';
  if (
    input.screenWidth < SCREEN_DENSITY_THRESHOLDS.summaryMaxScreenWidth ||
    input.screenHeight < SCREEN_DENSITY_THRESHOLDS.summaryMaxScreenHeight
  )
    return 'summary';
  if (
    input.screenWidth < SCREEN_DENSITY_THRESHOLDS.workingMaxScreenWidth ||
    input.screenHeight < SCREEN_DENSITY_THRESHOLDS.workingMaxScreenHeight
  )
    return 'working';
  return 'reading';
}

/** Derive the screen-space projection of a world-size node. */
export function projectScreenSize(
  worldWidth: number,
  worldHeight: number,
  zoom: number,
): { screenWidth: number; screenHeight: number } {
  return {
    screenWidth: worldWidth * zoom,
    screenHeight: worldHeight * zoom,
  };
}
