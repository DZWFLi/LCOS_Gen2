// A03-lean adoption tests (audit P0-3): binding -> real CoreEntityRef;
// missing binding fail-closes; empty ids and unknown entity types never
// fabricate a ref.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bindingToCoreRef,
  resolveOrAdoptNode,
} from '../src/interaction/nodeAdoption.js';

test('valid binding resolves to the real CoreEntityRef', () => {
  const r = resolveOrAdoptNode({ spatialId: 'n1' }, {
    entityType: 'artifact',
    entityId: 'art-42',
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.entityRef, { entityType: 'artifact', entityId: 'art-42' });
  }
});

test('missing binding fails closed with an actionable reason (no note:nodeId guess)', () => {
  const r = resolveOrAdoptNode({ spatialId: 'n1' });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.reason, /ProjectionBinding/);
    assert.ok(!r.reason.includes('note:'), 'must not fabricate a note:<id> ref');
  }
});

test('empty entity id fails closed', () => {
  const r = bindingToCoreRef({ entityType: 'artifact', entityId: '' });
  assert.equal(r.ok, false);
});

test('unknown entity type fails closed instead of inventing a taxonomy', () => {
  const r = bindingToCoreRef({ entityType: 'gizmo', entityId: 'x1' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /not a Core domain entity/);
});

test('null binding is treated like missing (fail-close, no adoption by guessing)', () => {
  const r = resolveOrAdoptNode({ spatialId: 'n2' }, null);
  assert.equal(r.ok, false);
});
