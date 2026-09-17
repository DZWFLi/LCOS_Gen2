import type {
  ProfessionalRectV1,
  ProfessionalRegionLayoutV1,
  ProfessionalRegionPlacementV1,
} from '@local-creative-os/web-gen2';

/** Figma window 5388:27165 responsive floor. Stage owns these initial-placement rules. */
export const PROFESSIONAL_STAGE_MIN_WIDTH = 360;
export const PROFESSIONAL_STAGE_MIN_HEIGHT = 280;

const FLOATING_TOP = 88;
const FLOATING_RIGHT = 24;
const FLOATING_BOTTOM = 52;
const CANVAS_PICK_RESERVE = 160;
const REGION_GAP = 16;

export interface ProfessionalStageRegionInputV1 {
  readonly regionId: string;
  readonly layout: ProfessionalRegionLayoutV1;
  readonly preferredWidth: number;
}

function clampedPreferredWidth(preferredWidth: number, maxWidth: number, minWidth: number): number {
  return Math.min(maxWidth, Math.max(minWidth, preferredWidth));
}

/**
 * Deterministic initial placement for simultaneous Professional regions.
 * It is intentionally not persistence and not a drag/resize state store: Stage
 * owns the geometry and R2 interaction can later replace a region rect without
 * changing topology truth in lcosShellStore.
 */
export function deriveProfessionalStageRegionPlacementsV1(input: {
  readonly viewport: ProfessionalRectV1;
  readonly regions: readonly ProfessionalStageRegionInputV1[];
}): readonly ProfessionalRegionPlacementV1[] {
  const { viewport } = input;
  if (input.regions.length === 0 || viewport.width <= 0 || viewport.height <= 0) return [];

  const minWidth = Math.min(PROFESSIONAL_STAGE_MIN_WIDTH, viewport.width);
  const minHeight = Math.min(PROFESSIONAL_STAGE_MIN_HEIGHT, viewport.height);
  const leftReserve = Math.min(
    CANVAS_PICK_RESERVE,
    Math.max(0, viewport.width - minWidth - FLOATING_RIGHT),
  );
  const docked = input.regions.filter((region) => region.layout === 'docked-right');
  const floating = input.regions.filter((region) => region.layout === 'floating');

  const maxDockWidth = Math.max(minWidth, viewport.width - leftReserve);
  const dockWidth = docked.length === 0
    ? 0
    : Math.min(
        maxDockWidth,
        Math.max(minWidth, ...docked.map((region) => region.preferredWidth)),
      );
  const dockRows = Math.max(1, docked.length);
  const dockHeight = docked.length === 0 ? 0 : Math.max(minHeight, Math.floor(viewport.height / dockRows));
  const placements: ProfessionalRegionPlacementV1[] = docked.map((region, index) => ({
    regionId: region.regionId,
    layout: region.layout,
    rect: {
      x: viewport.x + viewport.width - dockWidth,
      y: viewport.y + index * dockHeight,
      width: dockWidth,
      height: Math.min(dockHeight, Math.max(0, viewport.height - index * dockHeight)),
    },
  }));

  if (floating.length === 0) return placements;

  const rightEdge = viewport.x + viewport.width - FLOATING_RIGHT
    - (dockWidth > 0 ? dockWidth + REGION_GAP : 0);
  const leftEdge = viewport.x + leftReserve;
  const availableWidth = Math.max(minWidth, rightEdge - leftEdge);
  const availableHeight = Math.max(
    minHeight,
    viewport.height - FLOATING_TOP - FLOATING_BOTTOM,
  );
  const maxColumns = Math.max(
    1,
    Math.floor((availableWidth + REGION_GAP) / (minWidth + REGION_GAP)),
  );
  const columns = Math.min(floating.length, maxColumns);
  const rows = Math.ceil(floating.length / columns);
  const cellWidth = Math.max(
    minWidth,
    Math.floor((availableWidth - REGION_GAP * (columns - 1)) / columns),
  );
  const cellHeight = Math.max(
    minHeight,
    Math.floor((availableHeight - REGION_GAP * (rows - 1)) / rows),
  );
  const gridWidth = cellWidth * columns + REGION_GAP * (columns - 1);
  const originX = Math.max(viewport.x, rightEdge - gridWidth);

  for (let index = 0; index < floating.length; index += 1) {
    const region = floating[index];
    if (region === undefined) continue;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const width = clampedPreferredWidth(region.preferredWidth, cellWidth, minWidth);
    placements.push({
      regionId: region.regionId,
      layout: region.layout,
      rect: {
        x: originX + column * (cellWidth + REGION_GAP) + (cellWidth - width),
        y: viewport.y + FLOATING_TOP + row * (cellHeight + REGION_GAP),
        width,
        height: cellHeight,
      },
    });
  }

  return placements;
}
