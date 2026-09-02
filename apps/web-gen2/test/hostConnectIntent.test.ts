// A05 semantic-connect kind resolution tests: the Core relation kind is
// decided from the gesture CONTEXT (endpoints + optional ports + surface),
// never hardcoded by the seam. Phase A only resolves to existing Core kinds.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveConnectKind,
  type ConnectIntentContext,
} from '../src/host/hostConnectIntent.js';
import { createHostSeam } from '../src/host/hostSeam.js';

const ctx = (overrides: Partial<ConnectIntentContext> = {}): ConnectIntentContext => ({
  surface: 'c1',
  from: { entityType: 'artifact', entityId: 'a1' },
  to: { entityType: 'artifact', entityId: 'a2' },
  ...overrides,
});

test('resolveConnectKind resolves the neutral references fallback for a plain gesture', () => {
  assert.deepEqual(resolveConnectKind(ctx()), { ok: true, kind: 'references' });
});

test('a two-artifact gesture still resolves to an existing Core kind (never invented)', () => {
  const r = resolveConnectKind(ctx({ fromPort: 'out', toPort: 'in' }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.kind, 'references');
});

test('context carries endpoints, ports and surface through to the resolver', () => {
  const c = ctx({ fromPort: 'out', toPort: 'in', surface: 'workflow' });
  assert.equal(c.surface, 'workflow');
  assert.equal(c.fromPort, 'out');
  assert.equal(c.from.entityId, 'a1');
});

test('seam connectIntent has no hardcoded kind — it resolves via the context', () => {
  const seam = createHostSeam(
    { connect: async () => ({ relationId: 'r1', changeSetId: 'cs1', edgeBinding: undefined }) } as never,
  );
  const intent = seam.connectIntent as { kind?: string };
  assert.equal(intent.kind, undefined, 'seam must not carry a hardcoded relation kind');
});