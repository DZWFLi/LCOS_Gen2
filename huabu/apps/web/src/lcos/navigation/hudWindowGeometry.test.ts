import { rectsOverlapV1 } from '@local-creative-os/web-gen2';
import { expect, it } from 'vitest';

import { avoidHudWindows, cameraFitRect, cameraFitInsets, isActualHudRectAvailable } from './hudWindowGeometry';
const viewport = { x: 0, y: 0, width: 1024, height: 768 };
it('keeps preferred HUD positions when unobscured and moves their whole rectangle out of two windows', () => {
  const hud = { x: 420, y: 24, width: 184, height: 48 };
  expect(avoidHudWindows(hud, null, viewport)).toEqual(hud);
  const occupiedRects = [{ x: 350, y: 10, width: 300, height: 240 }, { x: 20, y: 10, width: 300, height: 300 }];
  const result = avoidHudWindows(hud, { safeRect: viewport, occupiedRects, activeRegionId: undefined }, viewport);
  expect(occupiedRects.some((rect) => rectsOverlapV1(result, rect))).toBe(false);
  expect(result.x).toBeGreaterThanOrEqual(8); expect(result.y).toBeGreaterThanOrEqual(8);
});
it('fits inside the real docked safe rect and avoids a floating window', () => {
  const environment = { safeRect: { ...viewport, width: 700 }, occupiedRects: [{ x: 490, y: 280, width: 200, height: 400 }], activeRegionId: undefined };
  const fit = cameraFitRect(viewport, environment);
  if (!fit) throw new Error('Expected an available fit rectangle');
  expect(fit.x + fit.width).toBeLessThanOrEqual(700);
  const obstruction = environment.occupiedRects[0];
  if (!obstruction) throw new Error('Expected a floating window obstacle');
  expect(rectsOverlapV1(fit, obstruction)).toBe(false);
  const inset = cameraFitInsets(viewport, environment);
  if (!inset) throw new Error('Expected fit insets');
  expect(inset.left + fit.width + inset.right).toBe(1024);
});
it('does not fabricate a fit destination when windows cover all available canvas space', () => {
  expect(cameraFitRect(viewport, { safeRect: viewport, occupiedRects: [viewport], activeRegionId: undefined })).toBeNull();
});

it('keeps the narrow search island clear of the project capsule without moving the canvas', () => {
  const narrow = { width: 390, height: 844 };
  const capsule = { x: 24, y: 24, width: 256, height: 44 };
  const result = avoidHudWindows({ x: 147, y: 24, width: 96, height: 48 }, null, narrow, [capsule]);
  expect(rectsOverlapV1(result, capsule)).toBe(false);
  expect(result.x).toBeGreaterThanOrEqual(8);
  expect(result.x + result.width).toBeLessThanOrEqual(382);
});
it('lets the expanded spatial navigator and secondary tools clear the permanent Surface Dock', () => {
  const narrow = { width: 360, height: 800 };
  const dock = { x: 91, y: 718, width: 178, height: 58 };
  const camera = avoidHudWindows({ x: 24, y: 524, width: 232, height: 252 }, null, narrow, [dock]);
  const tools = avoidHudWindows({ x: 232, y: 728, width: 104, height: 48 }, null, narrow, [dock, camera]);
  expect(rectsOverlapV1(camera, dock)).toBe(false);
  expect(rectsOverlapV1(tools, dock)).toBe(false);
  expect(rectsOverlapV1(tools, camera)).toBe(false);
});

it('uses the bounded rectangle fallback when Reader and Assembly exhaust the original point candidates', () => {
  const safeRect = { x: 0, y: 0, width: 600, height: 751 };
  const occupiedRects = [
    { x: 616, y: 0, width: 420, height: 751 },
    { x: 160, y: 88, width: 440, height: 611 },
  ];
  const projectCluster = { x: 24, y: 24, width: 256, height: 44 };
  const obstacles = [...occupiedRects, projectCluster];
  const preferred = { x: 149.45, y: 669, width: 301.075, height: 58 };
  const result = avoidHudWindows(preferred,
    { safeRect, occupiedRects, activeRegionId: 'reader-region' },
    { width: 1036, height: 751 },
    [projectCluster]);

  expect(result).not.toEqual(preferred);
  expect(obstacles.some((rect) => rectsOverlapV1(result, rect))).toBe(false);
  expect(result.x).toBeGreaterThanOrEqual(safeRect.x);
  expect(result.y).toBeGreaterThanOrEqual(safeRect.y);
  expect(result.x + result.width).toBeLessThanOrEqual(safeRect.x + safeRect.width);
  expect(result.y + result.height).toBeLessThanOrEqual(safeRect.y + safeRect.height);
});

it('keeps the full Dock when it fits and finds the Figma glyph footprint when only that size clears the narrow pane', () => {
  const safeRect = { x: 0, y: 0, width: 600, height: 751 };
  const occupiedRects = [
    { x: 616, y: 0, width: 420, height: 751 },
    { x: 160, y: 88, width: 440, height: 611 },
  ];
  const shellPeers = [
    { x: 24, y: 24, width: 256, height: 44 },
    { x: 288, y: 24, width: 52, height: 48 },
  ];
  const environment = { safeRect, occupiedRects, activeRegionId: 'reader-region' };
  const obstacles = [...occupiedRects, ...shellPeers];
  const full = avoidHudWindows({ x: 149.45, y: 669, width: 301.075, height: 58 }, environment, viewport, shellPeers);
  const compact = avoidHudWindows({ x: 211, y: 669, width: 178, height: 58 }, environment, viewport, shellPeers);

  expect(obstacles.some((rect) => rectsOverlapV1(full, rect))).toBe(true);
  expect(obstacles.some((rect) => rectsOverlapV1(compact, rect))).toBe(false);
  expect(compact).toEqual({ x: 344, y: 26, width: 178, height: 58 });
});

it('does not treat a safe-area-clamped prediction as a smaller rendered Dock', () => {
  const safeRect = { x: 0, y: 0, width: 260, height: 751 };
  const environment = { safeRect, occupiedRects: [], activeRegionId: undefined };
  const predictedFull = avoidHudWindows({ x: 0, y: 669, width: 301, height: 58 }, environment, { width: 1036, height: 751 });
  const predictedCompact = avoidHudWindows({ x: 41, y: 669, width: 178, height: 58 }, environment, { width: 1036, height: 751 });

  expect(predictedFull.width).toBe(244);
  expect(isActualHudRectAvailable(predictedFull, { width: 301, height: 58 }, safeRect, [])).toBe(false);
  expect(isActualHudRectAvailable(predictedCompact, { width: 178, height: 58 }, safeRect, [])).toBe(true);

  const tightSafeRect = { ...safeRect, width: 144 };
  const clampedCompact = avoidHudWindows({ x: 0, y: 669, width: 178, height: 58 },
    { ...environment, safeRect: tightSafeRect }, { width: 1036, height: 751 });
  expect(clampedCompact.width).toBe(128);
  expect(isActualHudRectAvailable(clampedCompact, { width: 178, height: 58 }, tightSafeRect, [])).toBe(false);
});
