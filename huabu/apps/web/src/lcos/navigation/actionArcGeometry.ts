export interface ActionArcPoint {
  readonly x: number;
  readonly y: number;
}

export type ActionArcMode = 'figma-three' | 'extended-four' | 'adaptive';

export const ACTION_ARC_VISUAL_SIZE = 30;
export const ACTION_ARC_HIT_SIZE = 44;
export const ACTION_ARC_HIT_INSET =
  (ACTION_ARC_HIT_SIZE - ACTION_ARC_VISUAL_SIZE) / 2;

/** Figma 5388:311 exact three-orb geometry: frame 82×82. */
export const FIGMA_ACTION_ARC_THREE: readonly ActionArcPoint[] = [
  { x: 0, y: 0 },
  { x: 46, y: 6 },
  { x: 52, y: 52 },
] as const;

/** Product adaptation: T3-A02 3 primary actions + More, preserving the same arc language. */
export const EXTENDED_ACTION_ARC_FOUR: readonly ActionArcPoint[] = [
  { x: 0, y: 0 },
  { x: 42, y: 4 },
  { x: 72, y: 30 },
  { x: 56, y: 70 },
] as const;

const ADAPTIVE_POINTS: Readonly<Record<1 | 2, readonly ActionArcPoint[]>> = {
  1: [{ x: 0, y: 0 }],
  2: [
    { x: 0, y: 0 },
    { x: 44, y: 14 },
  ],
};

export interface ActionArcGeometry {
  readonly mode: ActionArcMode;
  readonly points: readonly ActionArcPoint[];
  readonly width: number;
  readonly height: number;
}

export function resolveActionArcGeometry(itemCount: number): ActionArcGeometry {
  const count = Math.max(1, Math.min(4, Math.trunc(itemCount))) as 1 | 2 | 3 | 4;
  const points =
    count === 3
      ? FIGMA_ACTION_ARC_THREE
      : count === 4
        ? EXTENDED_ACTION_ARC_FOUR
        : ADAPTIVE_POINTS[count];
  const mode: ActionArcMode =
    count === 3 ? 'figma-three' : count === 4 ? 'extended-four' : 'adaptive';
  return {
    mode,
    points,
    width: Math.max(...points.map((point) => point.x)) + ACTION_ARC_VISUAL_SIZE,
    height: Math.max(...points.map((point) => point.y)) + ACTION_ARC_VISUAL_SIZE,
  };
}
