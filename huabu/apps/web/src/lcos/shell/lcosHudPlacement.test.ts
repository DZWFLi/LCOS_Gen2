import { describe, expect, it } from 'vitest';

import { lcosHudEdgeOffsets, lcosHudSafeCenterY } from './lcosHudPlacement';

describe('lcosHudEdgeOffsets', () => {
  it('keeps the historical 24px resting anchors without an active window environment', () => {
    expect(lcosHudEdgeOffsets(null, { width: 1200, height: 800 })).toEqual({
      top: 24,
      right: 24,
      bottom: 24,
      left: 24,
    });
  });

  it('moves only edges constrained by the shared safeRect', () => {
    const environment = {
      safeRect: { x: 0, y: 0, width: 884, height: 760 },
      occupiedRects: [{ x: 900, y: 40, width: 300, height: 720 }],
      activeRegionId: 'region-dock',
    };
    expect(lcosHudEdgeOffsets(environment, { width: 1200, height: 800 })).toEqual({
      top: 24,
      right: 340,
      bottom: 64,
      left: 24,
    });
    expect(lcosHudSafeCenterY(environment, 800)).toBe(380);
  });
});
