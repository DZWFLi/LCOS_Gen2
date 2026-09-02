// A02 — adaptive presentation density resolver (pure function tests).
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCREEN_DENSITY_THRESHOLDS,
  projectScreenSize,
  resolvePresentationDensity,
  type NodePresentationInput,
} from '../src/index.js';

function input(overrides: Partial<NodePresentationInput> = {}): NodePresentationInput {
  const worldWidth = overrides.worldWidth ?? 280;
  const worldHeight = overrides.worldHeight ?? 220;
  const zoom = overrides.zoom ?? 1;
  const { screenWidth, screenHeight } = projectScreenSize(worldWidth, worldHeight, zoom);
  return {
    worldWidth,
    worldHeight,
    zoom,
    dpr: 1,
    screenWidth,
    screenHeight,
    phase: 'rest',
    ...overrides,
  };
}

test('screen-size derivation is world × zoom at every zoom level', () => {
  for (const zoom of [0.25, 0.5, 1, 1.5, 2]) {
    const i = input({ worldWidth: 400, worldHeight: 300, zoom });
    assert.equal(i.screenWidth, 400 * zoom);
    assert.equal(i.screenHeight, 300 * zoom);
  }
});

test('reading: a large node at zoom 1+ reads fully', () => {
  assert.equal(resolvePresentationDensity(input({ worldWidth: 600, worldHeight: 400 })), 'reading');
});

test('working: mid-size nodes settle at working', () => {
  assert.equal(resolvePresentationDensity(input({ worldWidth: 300, worldHeight: 200 })), 'working');
});

test('summary: small nodes degrade to summary', () => {
  assert.equal(resolvePresentationDensity(input({ worldWidth: 170, worldHeight: 80 })), 'summary');
});

test('mark: tiny nodes degrade to mark', () => {
  // min(screen) below 44
  assert.equal(resolvePresentationDensity(input({ worldWidth: 80, worldHeight: 40 })), 'mark');
  // screen width below 84 even when height is fine
  assert.equal(resolvePresentationDensity(input({ worldWidth: 80, worldHeight: 300 })), 'mark');
});

test('zoom-out degrades the SAME node through the ladder', () => {
  // 400×300 world node: 600×450@1.5 → reading; 400×300@1 → working;
  // 100×75@0.25 → summary (75 < 84); 80×60@0.2 → mark (80 < 84).
  assert.equal(resolvePresentationDensity(input({ worldWidth: 400, worldHeight: 300, zoom: 1.5 })), 'reading');
  assert.equal(resolvePresentationDensity(input({ worldWidth: 400, worldHeight: 300, zoom: 1 })), 'working');
  assert.equal(resolvePresentationDensity(input({ worldWidth: 400, worldHeight: 300, zoom: 0.25 })), 'summary');
  assert.equal(resolvePresentationDensity(input({ worldWidth: 400, worldHeight: 300, zoom: 0.2 })), 'mark');
  // Zooming back in restores.
  assert.equal(resolvePresentationDensity(input({ worldWidth: 400, worldHeight: 300, zoom: 2 })), 'reading');
});

test('editing is stable: never collapses to mark/summary regardless of zoom', () => {
  for (const zoom of [0.25, 0.5, 1, 1.5, 2]) {
    const i = input({ worldWidth: 400, worldHeight: 300, zoom, phase: 'editing' });
    assert.equal(resolvePresentationDensity(i), 'working');
  }
});

test('dpr does not flip density on the same CSS pixel layout', () => {
  const dpr1 = input({ worldWidth: 200, worldHeight: 120, dpr: 1 });
  const dpr2 = input({ worldWidth: 200, worldHeight: 120, dpr: 2 });
  assert.equal(resolvePresentationDensity(dpr1), resolvePresentationDensity(dpr2));
});

test('thresholds are the frozen Phase A presets', () => {
  assert.equal(SCREEN_DENSITY_THRESHOLDS.markMinScreen, 44);
  assert.equal(SCREEN_DENSITY_THRESHOLDS.markMinScreenWidth, 84);
  assert.equal(SCREEN_DENSITY_THRESHOLDS.summaryMaxScreenWidth, 180);
  assert.equal(SCREEN_DENSITY_THRESHOLDS.summaryMaxScreenHeight, 84);
  assert.equal(SCREEN_DENSITY_THRESHOLDS.workingMaxScreenWidth, 480);
  assert.equal(SCREEN_DENSITY_THRESHOLDS.workingMaxScreenHeight, 260);
});
