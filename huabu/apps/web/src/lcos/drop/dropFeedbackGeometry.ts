import type { DropRect } from './dropTypes';
import type { SurfacePoint } from '@local-creative-os/web-gen2';

// Gen1@3e99769 features/drop/dropPhases.ts + spatial/semanticDrop.ts:
// approaching is a 48 CSS-pixel visual hint, not an enlarged commit target.
export const DROP_FEEDBACK_NEAR_PX = 48;

export function nearestDropFeedbackPoint(rect: DropRect, point: SurfacePoint): SurfacePoint | undefined {
  if (![rect.left, rect.top, rect.width, rect.height, point.x, point.y].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0) return undefined;
  return {
    x: Math.max(rect.left, Math.min(point.x, rect.left + rect.width)),
    y: Math.max(rect.top, Math.min(point.y, rect.top + rect.height)),
  };
}

export function isNearDropFeedback(rect: DropRect, point: SurfacePoint): boolean {
  const nearest = nearestDropFeedbackPoint(rect, point);
  return nearest !== undefined && Math.hypot(point.x - nearest.x, point.y - nearest.y) <= DROP_FEEDBACK_NEAR_PX;
}

/** Flip the caption before an edge, keeping the source proxy next to the pointer.
 * This positions feedback only; never modifies the hit rect or placement point. */
export function dropFeedbackPosition(
  point: SurfacePoint,
  viewport: { readonly width: number; readonly height: number },
  footprint: { readonly width: number; readonly height: number },
): { readonly left: number; readonly top: number; readonly side: 'left' | 'right' } {
  const margin = 8;
  const gap = 14;
  const width = Math.min(footprint.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(footprint.height, Math.max(0, viewport.height - margin * 2));
  const side = point.x + gap + width <= viewport.width - margin ? 'right' : 'left';
  const left = side === 'right' ? point.x + gap : point.x - width - gap;
  const top = point.y + gap + height <= viewport.height - margin ? point.y + gap : point.y - height - gap;
  return {
    left: Math.max(margin, Math.min(left, viewport.width - width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - height - margin)),
    side,
  };
}
