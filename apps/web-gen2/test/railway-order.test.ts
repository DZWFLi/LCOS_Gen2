import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  removeRailwayRefV1,
  reorderRailwayRefV1,
  railwayRefKeyV1,
} from '../src/navigation/railwayOrder.js';
import { CoreRailwayClient } from '../src/backend/railway.js';
import { HttpClient } from '../src/backend/client.js';

const A = { kind: 'scene' as const, viewId: 'a' };
const B = { kind: 'context' as const, viewId: 'b' };
const HIDDEN = { kind: 'scene' as const, viewId: 'legacy-root' };
const C = { kind: 'collection' as const, viewId: 'c' };

test('railwayRefKeyV1 uses exact Core kind + view identity', () => {
  assert.equal(railwayRefKeyV1(A), 'scene:a');
  assert.equal(railwayRefKeyV1(B), 'context:b');
});

test('reorderRailwayRefV1 moves before/after without dropping hidden refs', () => {
  const order = [A, HIDDEN, B, C];
  assert.deepEqual(reorderRailwayRefV1(order, 'collection:c', 'scene:a', 'before'), [C, A, HIDDEN, B]);
  assert.deepEqual(reorderRailwayRefV1(order, 'scene:a', 'collection:c', 'after'), [HIDDEN, B, C, A]);
  assert.equal(reorderRailwayRefV1(order, 'scene:missing', 'collection:c', 'before'), order);
});

test('reorderRailwayRefV1 is a no-op for same target and does not fabricate duplicate keys', () => {
  const order = [A, HIDDEN, B];
  assert.equal(reorderRailwayRefV1(order, 'scene:a', 'scene:a', 'after'), order);
  assert.deepEqual(reorderRailwayRefV1(order, 'scene:a', 'context:b', 'before'), [HIDDEN, A, B]);
});

test('reorderRailwayRefV1 fails closed when either moved or target identity is duplicated', () => {
  const duplicateMoved = [A, { ...A }, B, C];
  const duplicateTarget = [A, B, { ...B }, C];
  assert.equal(reorderRailwayRefV1(duplicateMoved, 'scene:a', 'collection:c', 'after'), duplicateMoved);
  assert.equal(reorderRailwayRefV1(duplicateTarget, 'scene:a', 'context:b', 'before'), duplicateTarget);
});

test('removeRailwayRefV1 removes one exact raw ref and keeps unknown refs unchanged', () => {
  const order = [A, HIDDEN, B];
  assert.deepEqual(removeRailwayRefV1(order, 'scene:legacy-root'), [A, B]);
  assert.equal(removeRailwayRefV1(order, 'scene:missing'), order);
});

test('CoreRailwayClient.write forwards the observed version and accepts the server order', async () => {
  let body: unknown;
  const http = new HttpClient({
    baseUrl: 'http://core.test',
    fetch: async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({
        ok: true,
        value: { projectId: 'p', orderedRefs: [B, A], version: 4, updatedAt: 'now' },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  const committed = await new CoreRailwayClient(http).write({
    projectId: 'p',
    orderedRefs: [B, A],
    expectedVersion: 3,
  });
  assert.deepEqual(body, { orderedRefs: [B, A], expectedVersion: 3 });
  assert.equal(committed.version, 4);
});
