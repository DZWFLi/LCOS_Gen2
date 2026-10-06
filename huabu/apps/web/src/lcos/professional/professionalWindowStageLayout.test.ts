import { describe, expect, it } from 'vitest';

import {
  deriveProfessionalStageRegionPlacementsV1,
  maximumProfessionalDockWidth,
  needsCompactProfessionalStageV1,
  professionalDockWidth,
  PROFESSIONAL_STAGE_MIN_HEIGHT,
  PROFESSIONAL_STAGE_MIN_WIDTH,
} from './professionalWindowStageLayout';

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x
    && a.y < b.y + b.height && a.y + a.height > b.y;
}

describe('deriveProfessionalStageRegionPlacementsV1', () => {
  it('places two floating regions independently at 1440 without a fake cascade', () => {
    const placements = deriveProfessionalStageRegionPlacementsV1({
      viewport: { x: 0, y: 0, width: 1440, height: 900 },
      regions: [
        { regionId: 'reader-a', layout: 'floating', preferredWidth: 1120 },
        { regionId: 'reader-b', layout: 'floating', preferredWidth: 1120 },
      ],
    });

    expect(placements).toHaveLength(2);
    const [a, b] = placements;
    if (!a || !b) throw new Error('two placements required');
    expect(a.rect.width).toBeGreaterThanOrEqual(PROFESSIONAL_STAGE_MIN_WIDTH);
    expect(b.rect.width).toBeGreaterThanOrEqual(PROFESSIONAL_STAGE_MIN_WIDTH);
    expect(a.rect.height).toBeGreaterThanOrEqual(PROFESSIONAL_STAGE_MIN_HEIGHT);
    expect(overlaps(a.rect, b.rect)).toBe(false);
    expect(Math.min(a.rect.x, b.rect.x)).toBeGreaterThanOrEqual(296);
  });

  it('limits a right dock at the measured Main project-cluster edge', () => {
    const viewport = { x: 0, y: 0, width: 1280, height: 800 };
    expect(maximumProfessionalDockWidth(viewport)).toBe(984);
    expect(professionalDockWidth(viewport, 1800)).toBe(984);
    expect(professionalDockWidth(viewport, 420)).toBe(420);

    const [dock] = deriveProfessionalStageRegionPlacementsV1({
      viewport,
      regions: [{ regionId: 'dock', layout: 'docked-right', preferredWidth: 1800 }],
    });
    expect(dock?.rect).toEqual({ x: 296, y: 0, width: 984, height: 800 });
  });

  it('reserves a right dock before placing floating regions', () => {
    const placements = deriveProfessionalStageRegionPlacementsV1({
      viewport: { x: 0, y: 0, width: 1440, height: 900 },
      regions: [
        { regionId: 'dock', layout: 'docked-right', preferredWidth: 520 },
        { regionId: 'float', layout: 'floating', preferredWidth: 640 },
      ],
    });
    const dock = placements.find((placement) => placement.regionId === 'dock');
    const floating = placements.find((placement) => placement.regionId === 'float');
    if (!dock || !floating) throw new Error('dock and float required');
    expect(dock.rect.x + dock.rect.width).toBe(1440);
    expect(floating.rect.x + floating.rect.width).toBeLessThanOrEqual(dock.rect.x - 16);
    expect(overlaps(dock.rect, floating.rect)).toBe(false);
  });
});

it('uses existing-window tab presentation when the viewport cannot contain the minimum regions', () => {
  const regions = Array.from({ length: 6 }, (_, index) => ({ regionId: `${index}`, layout: 'floating' as const, preferredWidth: 640 }));
  const singleDock = [{ regionId: 'assembly', layout: 'docked-right' as const, preferredWidth: 420 }];
  const singleReader = [{ regionId: 'reader', layout: 'floating' as const, preferredWidth: 1120 }];
  expect(needsCompactProfessionalStageV1({ x: 0, y: 0, width: 1440, height: 900 }, regions.slice(0, 2))).toBe(false);
  expect(needsCompactProfessionalStageV1({ x: 0, y: 0, width: 600, height: 700 }, regions.slice(0, 2))).toBe(true);
  expect(needsCompactProfessionalStageV1({ x: 0, y: 0, width: 1440, height: 500 }, regions)).toBe(true);
  expect(needsCompactProfessionalStageV1({ x: 0, y: 0, width: 600, height: 751 }, singleDock)).toBe(true);
  expect(needsCompactProfessionalStageV1({ x: 0, y: 0, width: 656, height: 751 }, singleDock)).toBe(false);
  expect(needsCompactProfessionalStageV1({ x: 0, y: 0, width: 600, height: 751 }, singleReader)).toBe(false);
});
