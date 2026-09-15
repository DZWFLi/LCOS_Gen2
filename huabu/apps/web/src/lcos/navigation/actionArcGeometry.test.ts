import { describe, expect, it } from 'vitest';

import {
  ACTION_ARC_HIT_SIZE,
  ACTION_ARC_VISUAL_SIZE,
  EXTENDED_ACTION_ARC_FOUR,
  FIGMA_ACTION_ARC_THREE,
  resolveActionArcGeometry,
} from './actionArcGeometry';

describe('Action Arc geometry', () => {
  it('keeps Figma 5388:311 three-orb geometry exact', () => {
    expect(FIGMA_ACTION_ARC_THREE).toEqual([
      { x: 0, y: 0 },
      { x: 46, y: 6 },
      { x: 52, y: 52 },
    ]);
    expect(resolveActionArcGeometry(3)).toMatchObject({
      mode: 'figma-three',
      width: 82,
      height: 82,
    });
    expect(ACTION_ARC_VISUAL_SIZE).toBe(30);
    expect(ACTION_ARC_HIT_SIZE).toBe(44);
  });

  it('separately validates the four-orb production adaptation', () => {
    expect(EXTENDED_ACTION_ARC_FOUR).toHaveLength(4);
    expect(resolveActionArcGeometry(4)).toMatchObject({
      mode: 'extended-four',
      width: 102,
      height: 100,
    });
  });
});
