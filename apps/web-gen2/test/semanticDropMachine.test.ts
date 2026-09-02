// A06 Semantic Drop machine tests: the pure state fabric (tracking -> dwell ->
// preview -> committing / failed) with Huabu-rescaled dwell tokens + hysteresis.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  idleDrop,
  beginDrop,
  advanceDropIntent,
  anchoringAt,
  inDropPreviewCarryZone,
  completeDropDwell,
  confirmDrop,
  failDrop,
  DROP_INTENT_TOKENS,
  type DropPayload,
  type DropBounds,
  type DropDestination,
} from '../src/interaction/semanticDropMachine.js';

const BOUNDS: DropBounds = { left: 0, right: 1200, top: 0, bottom: 800 };
const PAYLOAD: DropPayload = { kind: 'object', entityType: 'artifact', entityId: 'a1' };
const now = (): number => 1_000_000;

function trackingState() {
  return beginDrop(PAYLOAD);
}

test('idle ignores movement', () => {
  assert.deepEqual(advanceDropIntent(idleDrop(), { x: 300, y: 400 }, BOUNDS, now()), { status: 'idle' });
});

test('entering the bottom dwell band starts dwell timing', () => {
  const s = advanceDropIntent(trackingState() as never, { x: 400, y: 795 }, BOUNDS, now());
  assert.equal(s.status, 'dwell');
  if (s.status === 'dwell') {
    assert.equal(s.anchor, 'bottom');
    assert.deepEqual(s.payload, PAYLOAD);
    assert.equal(s.since, now());
  }
});

test('leaving the (LEFTER) anchor band cancels back to tracking', () => {
  const s = advanceDropIntent(trackingState() as never, { x: 20, y: 400 }, BOUNDS, now());
  assert.equal(s.status, 'dwell');
  if (s.status !== 'dwell') return;
  const left = advanceDropIntent(s, { x: 400, y: 400 }, BOUNDS, now());
  assert.equal(left.status, 'tracking');
});

test('dwell completes to preview only after the dwell period', () => {
  const d = trackToDwell();
  const dest = slotDest();
  // too soon => stays dwell
  assert.equal(completeDropDwell(d, dest, now() - DROP_INTENT_TOKENS.dwellMs + 1).status, 'dwell');
  // after dwellMs => preview
  const p = completeDropDwell(d, dest, now() + DROP_INTENT_TOKENS.dwellMs);
  assert.equal(p.status, 'preview');
  if (p.status !== 'preview') return;
  assert.deepEqual(p.payload, PAYLOAD);
  assert.equal(p.destination.surface, 'c1');
});

test('once in preview, hysteresis keeps it until leaving the carry zone', () => {
  const track = beginDrop(PAYLOAD);
  const dwell = advanceDropIntent(track as never, { x: 400, y: 795 }, BOUNDS, now());
  const dest = slotDest();
  const preview = completeDropDwell(dwell as never, dest, now() + DROP_INTENT_TOKENS.dwellMs);
  assert.equal(preview.status, 'preview');

  const still = advanceDropIntent(preview as never, { x: 380, y: 760 }, BOUNDS, now() + 1000, false);
  assert.equal(still.status, 'preview');

  const left = advanceDropIntent(preview as never, { x: 300, y: 400 }, BOUNDS, now() + 1000, false);
  assert.equal(left.status, 'tracking');
});

test('confirm commits with a transaction id; fail reports recoverable', () => {
  const dwell = trackToDwell();
  const preview = completeDropDwell(dwell, slotDest(), now() + DROP_INTENT_TOKENS.dwellMs);
  if (preview.status !== 'preview') throw new Error('expected preview');
  assert.deepEqual(confirmDrop(preview, 'tx1'), { status: 'committing', transactionId: 'tx1' });
  assert.deepEqual(failDrop(preview, 'core unreachable', true), { status: 'failed', reason: 'core unreachable', recoverable: true });
});

function trackToDwell(): ReturnType<typeof advanceDropIntent> {
  return advanceDropIntent(trackingState() as never, { x: 400, y: 795 }, BOUNDS, now());
}
function slotDest(): DropDestination {
  return { kind: 'slot', anchor: 'bottom', surface: 'c1', place: { x: 400, y: 760 } };
}

test('anchoringAt and carry zone agree on the bottom band', () => {
  assert.equal(anchoringAt({ x: 400, y: 788 }, BOUNDS), 'bottom');
  assert.equal(anchoringAt({ x: 0, y: 400 }, BOUNDS), 'left');
  assert.equal(anchoringAt({ x: 400, y: 400 }, BOUNDS), null);
  assert.equal(inDropPreviewCarryZone({ x: 400, y: 200 }, BOUNDS, 'bottom'), false);
});