import { describe, expect, it } from 'vitest';

import {
  deriveProfessionalStageRegionPlacementsV1,
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
    expect(Math.min(a.rect.x, b.rect.x)).toBeGreaterThanOrEqual(160);
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
