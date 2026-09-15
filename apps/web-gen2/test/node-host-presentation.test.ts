import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveLcosInitialGeometryPreset,
  resolveLcosNodeHostPresentation,
} from '../src/presentation/nodeHostPresentation.js';

test('Figma Main exact geometry presets map only authoritative visual families', () => {
  assert.deepEqual(resolveLcosInitialGeometryPreset({ entityType: 'conversation' }), {
    width: 121,
    height: 142,
    figmaNodeId: '5388:118',
  });
  assert.deepEqual(resolveLcosInitialGeometryPreset({ entityType: 'artifact', artifactKind: 'image' }), {
    width: 410,
    height: 273,
    figmaNodeId: '5388:98',
  });
  assert.deepEqual(
    resolveLcosInitialGeometryPreset({
      entityType: 'artifact',
      artifactKind: 'image',
      displayMode: 'thumbnail',
    }),
    { width: 205, height: 127, figmaNodeId: '5388:111' },
  );
  assert.deepEqual(resolveLcosInitialGeometryPreset({ entityType: 'artifact', artifactKind: 'markdown' }), {
    width: 206,
    height: 154,
    figmaNodeId: '5388:106',
  });
  assert.deepEqual(resolveLcosInitialGeometryPreset({ entityType: 'artifact', artifactKind: 'other', mimeType: 'text/plain' }), {
    width: 385,
    height: 142,
    figmaNodeId: '5388:102',
  });
  assert.deepEqual(resolveLcosInitialGeometryPreset({ entityType: 'artifact', artifactKind: 'other', mimeType: 'audio/wav' }), {
    width: 171,
    height: 96,
    figmaNodeId: '5388:121',
  });
});

test('Core-bound LCOS morphology suppresses native wrapper chrome but keeps native fallback undefined', () => {
  assert.deepEqual(resolveLcosNodeHostPresentation({ entityType: 'conversation' }), {
    surface: 'transparent',
    showAiBadge: false,
    allowOverflow: true,
  });
  assert.deepEqual(resolveLcosNodeHostPresentation({ entityType: 'artifact', artifactKind: 'image' }), {
    surface: 'media',
    showAiBadge: false,
    allowOverflow: true,
  });
  assert.equal(resolveLcosNodeHostPresentation({}), undefined);
});
