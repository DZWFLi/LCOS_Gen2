// A07 — Overlay arbitration tests (pure function matrix).
// 枚举 primary modes × selected × composer × workview，快照 visibleOverlays；
// 并断言任何组合都不会同时出现 resize-handles + node-toolbar + action-arc 三套。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  visibleOverlays,
  compactRestingOverlays,
  overlayZ,
  overlayLayers,
  type OverlayInput,
  type OverlayKind,
} from '../src/interaction/overlayArbitration.js';

const base: OverlayInput = {
  dragging: false,
  resizing: false,
  selected: false,
  hovered: false,
  composerOpen: false,
  actionArcOpen: false,
  workViewOpen: false,
  dropPreview: false,
  referenceBadge: false,
};

test('idle resting state shows nothing (no node Christmas tree)', () => {
  assert.deepEqual(visibleOverlays(base), []);
});

test('dragging drops everything except drop-preview', () => {
  assert.deepEqual(
    visibleOverlays({ ...base, dragging: true, selected: true, composerOpen: true }),
    [],
  );
  assert.deepEqual(
    visibleOverlays({ ...base, dragging: true, dropPreview: true }),
    ['drop-preview'],
  );
});

test('resizing shows only resize-handles, never toolbar/arc', () => {
  const out = visibleOverlays({ ...base, resizing: true, selected: true, actionArcOpen: true });
  assert.deepEqual(out, ['resize-handles']);
});

test('work-view is exclusive, returns the whole canvas', () => {
  const out = visibleOverlays({ ...base, workViewOpen: true, composerOpen: true, selected: true });
  assert.deepEqual(out, ['work-view']);
});

test('composer shows with optional orthogonal reference badge', () => {
  assert.deepEqual(visibleOverlays({ ...base, composerOpen: true }), ['composer']);
  assert.deepEqual(
    visibleOverlays({ ...base, composerOpen: true, referenceBadge: true }),
    ['composer', 'reference-badge'],
  );
});

test('action-arc shows with optional orthogonal reference badge', () => {
  assert.deepEqual(visibleOverlays({ ...base, actionArcOpen: true }), ['action-arc']);
  assert.deepEqual(
    visibleOverlays({ ...base, actionArcOpen: true, referenceBadge: true }),
    ['action-arc', 'reference-badge'],
  );
});

test('resting: selected => resize-handles only; hover stays single affordance', () => {
  assert.deepEqual(visibleOverlays({ ...base, selected: true }), ['resize-handles']);
  assert.deepEqual(
    visibleOverlays({ ...base, selected: true, referenceBadge: true }),
    ['resize-handles', 'reference-badge'],
  );
  assert.deepEqual(visibleOverlays({ ...base, hovered: true }), ['connect-affordance']);
  assert.deepEqual(
    visibleOverlays({ ...base, hovered: true, referenceBadge: true }),
    ['connect-affordance', 'reference-badge'],
  );
});

test('never resize-handles + node-toolbar + action-arc simultaneously', () => {
  const kinds: OverlayKind[] = ['resize-handles', 'node-toolbar', 'action-arc'];
  // 穷举所有 primary mode × selected × composer × workview 组合
  const modes = ['none', 'composer', 'actionarc', 'workview'] as const;
  for (const m of modes) {
    for (const selected of [false, true]) {
      const input: OverlayInput = {
        ...base,
        selected,
        composerOpen: m === 'composer',
        actionArcOpen: m === 'actionarc',
        workViewOpen: m === 'workview',
      };
      const out = visibleOverlays(input);
      const hits = kinds.filter((k) => out.includes(k));
      assert.ok(
        hits.length <= 1,
        `mode=${m} selected=${selected} produced overlapping toolbars: ${hits.join(',')}`,
      );
    }
  }
});

test('compactRestingOverlays stable order within a layer', () => {
  const out = compactRestingOverlays({ ...base, selected: true, referenceBadge: true, dropPreview: true });
  // 同层内按 REST_ORDER: resize-handles < reference-badge < drop-preview
  assert.deepEqual(out, ['resize-handles', 'reference-badge', 'drop-preview']);
});

test('overlayZ maps every kind into overlayLayers contract, no stray constants', () => {
  const all: OverlayKind[] = [
    'resize-handles', 'node-toolbar', 'connect-affordance', 'reference-badge',
    'drop-preview', 'action-arc', 'composer', 'focus-hud', 'work-view',
  ];
  for (const kind of all) {
    const z = overlayZ(kind);
    const allowed = Object.values(overlayLayers);
    assert.ok(
      allowed.includes(z),
      `${kind} z=${z} not part of overlayLayers contract (${allowed.join(',')})`,
    );
  }
});
