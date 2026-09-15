import { describe, expect, it } from 'vitest';

import {
  FIGMA_AUDIO_ACTIVE_BAR_COUNT,
  FIGMA_AUDIO_BAR_HEIGHTS,
  FIGMA_AUDIO_USED_WIDTH,
  FIGMA_SOURCE_GEOMETRY,
} from './sourceFigmaGeometry';

describe('Main source exact Figma geometry', () => {
  it('keeps the five exact source anchors', () => {
    expect(FIGMA_SOURCE_GEOMETRY.image).toMatchObject({ width: 410, height: 273, marker: 11 });
    expect(FIGMA_SOURCE_GEOMETRY.imageThumbnail).toMatchObject({ width: 205, height: 127, marker: 9 });
    expect(FIGMA_SOURCE_GEOMETRY.text).toMatchObject({ width: 385, height: 142, marker: 11 });
    expect(FIGMA_SOURCE_GEOMETRY.document).toMatchObject({ width: 206, height: 154 });
    expect(FIGMA_SOURCE_GEOMETRY.audio).toMatchObject({ width: 171, height: 96, barWidth: 2, barGap: 0.671875 });
  });

  it('fits all 64 audio bars inside 171px and preserves the 45/19 tone split', () => {
    expect(FIGMA_AUDIO_BAR_HEIGHTS).toHaveLength(64);
    expect(FIGMA_AUDIO_ACTIVE_BAR_COUNT).toBe(45);
    expect(FIGMA_AUDIO_USED_WIDTH).toBeCloseTo(170.328125, 6);
    expect(FIGMA_AUDIO_USED_WIDTH).toBeLessThanOrEqual(171);
  });
});
