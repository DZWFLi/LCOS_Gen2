import {
  clampProfessionalRectV1,
  type ProfessionalRectV1,
  type ProfessionalRegionLayoutV1,
  type ProfessionalRegionPlacementV1,
} from '@local-creative-os/web-gen2';
import { isFiniteProfessionalRect } from './professionalGestureGeometry';

/** Figma 5388:27475 Reader and 5346:1416 Assembly; geometry is presentation only. */
export const PROFESSIONAL_STAGE_MIN_WIDTH = 360;
export const PROFESSIONAL_STAGE_MIN_HEIGHT = 280;
const CANVAS_PICK_RESERVE = 160;
const REGION_GAP = 16;

export interface ProfessionalStageRegionInputV1 {
  readonly regionId: string;
  readonly layout: ProfessionalRegionLayoutV1;
  readonly preferredWidth: number;
  readonly bodyKey?: string;
  readonly rect?: ProfessionalRectV1;
  readonly dockWidth?: number;
}

/** The same bounds are used by initial placement, restore, dragging and resizing.
 * Reduce margins on short/narrow viewports rather than pushing controls offscreen.
 */
export function professionalFloatingBoundsV1(viewport: ProfessionalRectV1): ProfessionalRectV1 {
  const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
  const height = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;
  const horizontal = Math.min(width < 600 ? 12 : 24, width / 8);
  const verticalBudget = Math.max(0, height - Math.min(PROFESSIONAL_STAGE_MIN_HEIGHT, height));
  const top = Math.min(width < 600 ? 76 : 88, verticalBudget * 0.63);
  const bottom = Math.min(width < 600 ? 24 : 52, Math.max(0, verticalBudget - top));
  return { x: viewport.x + horizontal, y: viewport.y + top, width: width - horizontal * 2, height: height - top - bottom };
}

export function maximumProfessionalDockWidth(viewport: ProfessionalRectV1): number {
  const width = Math.max(0, Number.isFinite(viewport.width) ? viewport.width : 0);
  return Math.min(width, Math.max(Math.min(PROFESSIONAL_STAGE_MIN_WIDTH, width), width - CANVAS_PICK_RESERVE));
}

export function professionalDockWidth(viewport: ProfessionalRectV1, requested: number): number {
  const max = maximumProfessionalDockWidth(viewport);
  return Math.min(max, Math.max(Math.min(PROFESSIONAL_STAGE_MIN_WIDTH, max), Number.isFinite(requested) ? requested : 520));
}

function initialSingleRect(viewport: ProfessionalRectV1, bounds: ProfessionalRectV1, region: ProfessionalStageRegionInputV1): ProfessionalRectV1 {
  const width = Math.min(bounds.width, Math.max(Math.min(PROFESSIONAL_STAGE_MIN_WIDTH, bounds.width), region.preferredWidth));
  const height = Math.min(bounds.height, region.bodyKey === 'reader' ? 672 : region.bodyKey === 'assembly' ? 648 : region.bodyKey === 'portal-preview' ? (width < 452 ? 536 : 496) : bounds.height);
  const rightInset = region.bodyKey === 'reader' && viewport.width >= 1280 ? 144
    : region.bodyKey === 'assembly' && viewport.width >= 1280 ? 96 : viewport.x + viewport.width - bounds.x - bounds.width;
  const topInset = region.bodyKey === 'reader' && viewport.width >= 1280 ? 116
    : region.bodyKey === 'assembly' && viewport.width >= 1280 ? 120 : bounds.y - viewport.y;
  return clampProfessionalRectV1({ x: viewport.x + viewport.width - rightInset - width, y: viewport.y + topInset, width, height }, bounds, PROFESSIONAL_STAGE_MIN_WIDTH, PROFESSIONAL_STAGE_MIN_HEIGHT);
}

/** No new geometry owner: deterministic layout consumed by Stage and visibility. */
export function deriveProfessionalStageRegionPlacementsV1(input: {
  readonly viewport: ProfessionalRectV1;
  readonly regions: readonly ProfessionalStageRegionInputV1[];
}): readonly ProfessionalRegionPlacementV1[] {
  const { viewport } = input;
  if (!isFiniteProfessionalRect(viewport) || input.regions.length === 0) return [];
  const bounds = professionalFloatingBoundsV1(viewport);
  const minWidth = Math.min(PROFESSIONAL_STAGE_MIN_WIDTH, bounds.width);
  const minHeight = Math.min(PROFESSIONAL_STAGE_MIN_HEIGHT, bounds.height);
  const docked = input.regions.filter((region) => region.layout === 'docked-right');
  const floating = input.regions.filter((region) => region.layout === 'floating');
  const defaultDockWidth = Math.max(PROFESSIONAL_STAGE_MIN_WIDTH, ...docked.map((region) => region.preferredWidth));
  const dockWidths = docked.map((region) => professionalDockWidth(viewport, region.dockWidth ?? defaultDockWidth));
  const occupiedDockWidth = dockWidths.length === 0 ? 0 : Math.max(...dockWidths);
  const placements: ProfessionalRegionPlacementV1[] = docked.map((region, index) => {
    const width = dockWidths[index] ?? 0;
    // Compact presentation is selected upstream when rows cannot reach the floor.
    // Even a corrupt/overcrowded saved layout must produce finite visible rectangles.
    const y = viewport.y + viewport.height * index / docked.length;
    const bottom = viewport.y + viewport.height * (index + 1) / docked.length;
    return { regionId: region.regionId, layout: region.layout, rect: { x: viewport.x + viewport.width - width, y, width, height: bottom - y } };
  });
  if (floating.length === 0) return placements;
  if (floating.length === 1 && docked.length === 0) {
    const region = floating[0]!;
    const rect = region.rect && isFiniteProfessionalRect(region.rect)
      ? clampProfessionalRectV1(region.rect, bounds, minWidth, minHeight)
      : initialSingleRect(viewport, bounds, region);
    return [{ regionId: region.regionId, layout: region.layout, rect }];
  }

  const right = viewport.x + viewport.width - (occupiedDockWidth > 0 ? occupiedDockWidth + REGION_GAP : viewport.x + viewport.width - bounds.x - bounds.width);
  const left = Math.min(right - minWidth, Math.max(bounds.x, viewport.x + CANVAS_PICK_RESERVE));
  const availableWidth = Math.max(minWidth, right - left);
  const columns = Math.min(floating.length, Math.max(1, Math.floor((availableWidth + REGION_GAP) / (minWidth + REGION_GAP))));
  const rows = Math.ceil(floating.length / columns);
  const cellWidth = Math.max(1, (availableWidth - REGION_GAP * (columns - 1)) / columns);
  const cellHeight = Math.max(1, (bounds.height - REGION_GAP * (rows - 1)) / rows);
  floating.forEach((region, index) => {
    const width = Math.min(cellWidth, Math.max(minWidth, region.preferredWidth));
    const derived = { x: left + (index % columns) * (cellWidth + REGION_GAP) + cellWidth - width,
      y: bounds.y + Math.floor(index / columns) * (cellHeight + REGION_GAP), width, height: cellHeight };
    placements.push({ regionId: region.regionId, layout: region.layout, rect: clampProfessionalRectV1(
      region.rect && isFiniteProfessionalRect(region.rect) ? region.rect : derived, bounds, minWidth, minHeight,
    ) });
  });
  return placements;
}

/** Narrow mode changes presentation, never stored topology or user geometry. */
export function needsCompactProfessionalStageV1(viewport: ProfessionalRectV1, regions: readonly ProfessionalStageRegionInputV1[]): boolean {
  if (regions.length < 2) return false;
  if (viewport.width < 900) return true;
  const docked = regions.filter((region) => region.layout === 'docked-right');
  if (docked.length * PROFESSIONAL_STAGE_MIN_HEIGHT > viewport.height) return true;
  const floatingCount = regions.length - docked.length;
  if (floatingCount === 0) return false;
  const dockWidth = docked.length === 0 ? 0 : Math.max(...docked.map((region) => professionalDockWidth(viewport, region.dockWidth ?? region.preferredWidth))) + REGION_GAP;
  const width = viewport.width - CANVAS_PICK_RESERVE - 24 - dockWidth;
  const height = professionalFloatingBoundsV1(viewport).height;
  if (width < PROFESSIONAL_STAGE_MIN_WIDTH || height < PROFESSIONAL_STAGE_MIN_HEIGHT) return true;
  const columns = Math.max(1, Math.floor((width + REGION_GAP) / (PROFESSIONAL_STAGE_MIN_WIDTH + REGION_GAP)));
  const rows = Math.max(1, Math.floor((height + REGION_GAP) / (PROFESSIONAL_STAGE_MIN_HEIGHT + REGION_GAP)));
  return floatingCount > columns * rows;
}
