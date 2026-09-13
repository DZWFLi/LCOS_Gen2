// Sprint 4（T5）测试：Figma state 映射完整性 + 生产 body 状态呈现。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FIGMA_ENTRY_GROUP_STATES,
  assertAllFigmaStatesMappedV1,
  mapFigmaStateToT5StatusV1,
} from '../src/presentation/figmaStateMap.js';

test('every Figma state in the snapshot maps to a typed T5 status (no silent unavailable)', () => {
  const unmapped = assertAllFigmaStatesMappedV1();
  assert.deepEqual(unmapped, []);
});

test('16 entry groups are present with their Figma state lists', () => {
  assert.equal(Object.keys(FIGMA_ENTRY_GROUP_STATES).length, 16);
  assert.deepEqual(FIGMA_ENTRY_GROUP_STATES.current_receiver, [
    'ready', 'loading', 'empty', 'offline', 'reconnecting', 'unsupported', 'handoff_pending', 'error', 'list', 'chooser', 'handoff',
  ]);
  assert.ok(FIGMA_ENTRY_GROUP_STATES.recovery_section.includes('recover_bind'));
  assert.ok(FIGMA_ENTRY_GROUP_STATES.recovery_section.includes('retry_projection'));
  assert.ok(FIGMA_ENTRY_GROUP_STATES.browser_capture.includes('outcome_unknown'));
});

test('recovery states map to recovering/outcome_unknown, never to a success disguise', () => {
  assert.equal(mapFigmaStateToT5StatusV1('recover_bind'), 'recovering');
  assert.equal(mapFigmaStateToT5StatusV1('retry_projection'), 'recovering');
  assert.equal(mapFigmaStateToT5StatusV1('reconcile'), 'outcome_unknown');
  assert.equal(mapFigmaStateToT5StatusV1('outcome_unknown'), 'outcome_unknown');
  assert.equal(mapFigmaStateToT5StatusV1('cancelled'), 'cancelled');
});

test('unknown Figma state falls back to unavailable (honest, no guess)', () => {
  assert.equal(mapFigmaStateToT5StatusV1('totally_new_state'), 'unavailable');
});
