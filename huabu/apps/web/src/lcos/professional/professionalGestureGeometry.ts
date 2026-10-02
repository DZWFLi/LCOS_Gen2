import type { ProfessionalRectV1 } from '@local-creative-os/web-gen2';
import type { LcosWindowRegion } from '../shell/windowRegionTopology';

export const PROFESSIONAL_SPLITTER_SIZE = 5;
export const PROFESSIONAL_PANE_MIN_WIDTH = 360;
export const PROFESSIONAL_PANE_MIN_HEIGHT = 280;

export function isFiniteProfessionalRect(rect: ProfessionalRectV1): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0 && rect.height > 0;
}

export function sameProfessionalRect(a: ProfessionalRectV1 | undefined, b: ProfessionalRectV1 | undefined): boolean {
  return a === b || (a !== undefined && b !== undefined
    && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

/** Activation is deliberately excluded: focusing a pane cannot invalidate its drag.
 * Membership/geometry changes do invalidate it, so a late pointerup cannot overwrite
 * a different project, moved window, closed tab, or a concurrently re-grouped region.
 */
export function sameProfessionalRegionLayout(a: LcosWindowRegion, b: LcosWindowRegion | undefined): boolean {
  return b !== undefined && a.id === b.id && a.layout === b.layout
    && a.dockWidth === b.dockWidth && a.splitDirection === b.splitDirection
    && a.splitRatio === b.splitRatio && sameProfessionalRect(a.rect, b.rect)
    && a.groups.length === b.groups.length && a.groups.every((group, index) => {
      const other = b.groups[index];
      return other !== undefined && group.id === other.id && group.windowIds.length === other.windowIds.length
        && group.windowIds.every((id, position) => id === other.windowIds[position]);
    });
}

export function professionalSplitLimits(span: number, direction: 'horizontal' | 'vertical'): { min: number; max: number } {
  const minimum = direction === 'vertical' ? PROFESSIONAL_PANE_MIN_WIDTH : PROFESSIONAL_PANE_MIN_HEIGHT;
  const available = Number.isFinite(span) ? Math.max(0, span - PROFESSIONAL_SPLITTER_SIZE) : 0;
  const min = available < 2 * minimum ? 0.5 : Math.max(0.2, minimum / available);
  return { min, max: 1 - min };
}

export function clampProfessionalSplitRatio(ratio: number, span: number, direction: 'horizontal' | 'vertical'): number {
  const { min, max } = professionalSplitLimits(span, direction);
  return Math.min(max, Math.max(min, Number.isFinite(ratio) ? ratio : 0.5));
}

export function professionalSplitRatioAtPoint(rect: ProfessionalRectV1, direction: 'horizontal' | 'vertical', point: { x: number; y: number }): number {
  const span = direction === 'vertical' ? rect.width : rect.height;
  const distance = direction === 'vertical' ? point.x - rect.x : point.y - rect.y;
  return clampProfessionalSplitRatio((distance - PROFESSIONAL_SPLITTER_SIZE / 2) / Math.max(1, span - PROFESSIONAL_SPLITTER_SIZE), span, direction);
}
