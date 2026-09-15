import { GLYTH_SHAPE_KEYS } from '@local-creative-os/web-gen2';
import { describe, expect, it } from 'vitest';

import {
  GLYTH_IDLE_EYE_PATHS,
  GLYTH_SHAPE_FACES,
  GLYTH_SHAPE_PATHS,
  GLYTH_VIEW_BOX,
} from './glythGeometry';

describe('Glyth donor geometry', () => {
  it('contains exactly the eight shapes approved by the donor contract', () => {
    expect(Object.keys(GLYTH_SHAPE_PATHS)).toEqual([...GLYTH_SHAPE_KEYS]);
    expect(Object.keys(GLYTH_SHAPE_FACES)).toEqual([...GLYTH_SHAPE_KEYS]);
  });

  it('keeps vector paths + Figma-size-independent viewBox', () => {
    expect(GLYTH_VIEW_BOX).toBe('-15 -15 259 259');
    for (const shape of GLYTH_SHAPE_KEYS) {
      expect(GLYTH_SHAPE_PATHS[shape].startsWith('M')).toBe(true);
      expect(GLYTH_SHAPE_PATHS[shape].length).toBeGreaterThan(100);
    }
    expect(GLYTH_IDLE_EYE_PATHS).toHaveLength(2);
    expect(GLYTH_IDLE_EYE_PATHS.every((path) => path.startsWith('M') && path.endsWith('Z'))).toBe(true);
  });
});
