import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveGlythIdentity,
  resolveGlythPresentation,
} from '../src/presentation/glythPresentation.js';

test('Glyth donor identity is deterministic but remains presentation-only', () => {
  assert.deepEqual(resolveGlythIdentity('conversation-1'), resolveGlythIdentity('conversation-1'));
  assert.notEqual(resolveGlythIdentity('conversation-1').shape, undefined);
});

test('Glyth pose uses real waiting/active facts before local attention', () => {
  assert.equal(resolveGlythPresentation({ waiting: true, active: true, phase: 'selected' }), 'curious');
  assert.equal(resolveGlythPresentation({ active: true, phase: 'selected' }), 'working');
  assert.equal(resolveGlythPresentation({ phase: 'selected' }), 'listening');
  assert.equal(resolveGlythPresentation({ phase: 'rest' }), 'idle');
});
