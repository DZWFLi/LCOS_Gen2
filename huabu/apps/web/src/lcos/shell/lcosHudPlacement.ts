import type { ProfessionalWindowEnvironmentV1 } from '@local-creative-os/web-gen2';

export interface LcosViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface LcosHudEdgeOffsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

const DEFAULT_EDGE_GAP = 24;

/**
 * Translate the single Stage environment into shared HUD edge offsets.
 * Floating obstructions stay precise in the environment and do not cause a
 * global shift; edge-constrained safeRect values move only the affected edge.
 */
export function lcosHudEdgeOffsets(
  environment: ProfessionalWindowEnvironmentV1 | null,
  viewport: LcosViewportSize,
  gap = DEFAULT_EDGE_GAP,
): LcosHudEdgeOffsets {
  if (environment === null) {
    return { top: gap, right: gap, bottom: gap, left: gap };
  }
  const safe = environment.safeRect;
  return {
    top: Math.max(gap, safe.y + gap),
    right: Math.max(gap, viewport.width - (safe.x + safe.width) + gap),
    bottom: Math.max(gap, viewport.height - (safe.y + safe.height) + gap),
    left: Math.max(gap, safe.x + gap),
  };
}

export function lcosHudSafeCenterY(
  environment: ProfessionalWindowEnvironmentV1 | null,
  viewportHeight: number,
): number {
  if (environment === null) return viewportHeight / 2;
  const safe = environment.safeRect;
  return safe.y + safe.height / 2;
}
