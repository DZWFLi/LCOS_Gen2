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
  assert.equal(p.destination.targetId, 'canvas:c1');
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

test('a different live target invalidates the old preview before commit', () => {
  const dwell = trackToDwell();
  const preview = completeDropDwell(dwell, slotDest(), now() + DROP_INTENT_TOKENS.dwellMs);
  if (preview.status !== 'preview') throw new Error('expected preview');
  const next = advanceDropIntent(
    preview,
    { x: 400, y: 795 },
    BOUNDS,
    now() + 1000,
    true,
    { targetId: 'railway:scene-1', previewPoint: { x: 20, y: 20 } },
  );
  assert.deepEqual(next, { status: 'tracking', payload: PAYLOAD });
});

test('confirm commits with a transaction id; fail reports recoverable', () => {
  const dwell = trackToDwell();
  const preview = completeDropDwell(dwell, slotDest(), now() + DROP_INTENT_TOKENS.dwellMs);
  if (preview.status !== 'preview') throw new Error('expected preview');
  assert.deepEqual(confirmDrop(preview, 'tx1', { kind: 'assembly-apply', targetId: 'canvas:c1' }), {
    status: 'committing',
    payload: PAYLOAD,
    destination: slotDest(),
    carryAnchor: 'bottom',
    intent: { kind: 'assembly-apply', targetId: 'canvas:c1' },
    transactionId: 'tx1',
  });
  assert.deepEqual(failDrop(preview, 'core unreachable', true), { status: 'failed', reason: 'core unreachable', recoverable: true });
});

function trackToDwell(): ReturnType<typeof advanceDropIntent> {
  return advanceDropIntent(trackingState() as never, { x: 400, y: 795 }, BOUNDS, now());
}
function slotDest(): DropDestination {
  return { targetId: 'canvas:c1', previewPoint: { x: 400, y: 760 } };
}

test('anchoringAt and carry zone agree on the bottom band', () => {
  assert.equal(anchoringAt({ x: 400, y: 788 }, BOUNDS), 'bottom');
  assert.equal(anchoringAt({ x: 0, y: 400 }, BOUNDS), 'left');
  assert.equal(anchoringAt({ x: 400, y: 400 }, BOUNDS), null);
  assert.equal(inDropPreviewCarryZone({ x: 400, y: 200 }, BOUNDS, 'bottom'), false);
});

test('B6-R1: resting on a live registered destination dwells outside any edge band', () => {
  // Canvas centre: no edge band applies (anchoringAt === null).
  assert.equal(anchoringAt({ x: 400, y: 400 }, BOUNDS), null);
  const s = advanceDropIntent(trackingState() as never, { x: 400, y: 400 }, BOUNDS, now(), true);
  assert.equal(s.status, 'dwell');
  if (s.status !== 'dwell') return;
  assert.deepEqual(s.payload, PAYLOAD);
  assert.equal(s.since, now());
});

test('B6-R1: a destination dwell completes to that exact destination and commits', () => {
  const dwell = advanceDropIntent(trackingState() as never, { x: 400, y: 400 }, BOUNDS, now(), true);
  assert.equal(dwell.status, 'dwell');
  const dest: DropDestination = { targetId: 'glyth:node-1', previewPoint: { x: 400, y: 400 } };
  assert.equal(completeDropDwell(dwell, dest, now() - DROP_INTENT_TOKENS.dwellMs + 1).status, 'dwell');
  const preview = completeDropDwell(dwell, dest, now() + DROP_INTENT_TOKENS.dwellMs);
  assert.equal(preview.status, 'preview');
  if (preview.status !== 'preview') return;
  assert.equal(preview.destination.targetId, 'glyth:node-1');
  const committed = confirmDrop(preview, 'tx-glyth', { kind: 'collaboration-reference', targetId: 'glyth:node-1' });
  assert.equal(committed.status, 'committing');
});

test('B6-R1: drifting off a destination dwell falls back to tracking (no phantom preview)', () => {
  const dwell = advanceDropIntent(trackingState() as never, { x: 400, y: 400 }, BOUNDS, now(), true);
  assert.equal(dwell.status, 'dwell');
  const moved = advanceDropIntent(dwell, { x: 430, y: 400 }, BOUNDS, now() + 100, false);
  assert.equal(moved.status, 'tracking');
});

test('B6-R1: an edge-band dwell still cancels when the pointer leaves the band and the target', () => {
  const dwell = advanceDropIntent(trackingState() as never, { x: 400, y: 795 }, BOUNDS, now());
  assert.equal(dwell.status, 'dwell');
  const left = advanceDropIntent(dwell, { x: 400, y: 400 }, BOUNDS, now() + 100, false);
  assert.equal(left.status, 'tracking');
});

test('R1 pin: a bare Canvas destination accepts a CENTRE drop — the 56px edge band is not a precondition', () => {
  // 冻结语义钉死：裸 Canvas 本身就是有效注册 destination 时，画布中央的 drop 必须成立。
  // 边带（dwellBand）只是「没有目标也在画布上停一下」的锚点，不是允许 drop 的前提。
  const centre = { x: 600, y: 400 };
  assert.equal(anchoringAt(centre, BOUNDS), null, '中央点不在任何边带内');
  const dwell = advanceDropIntent(trackingState() as never, centre, BOUNDS, now(), true);
  assert.equal(dwell.status, 'dwell');
  const dest: DropDestination = { targetId: 'canvas:main', previewPoint: centre };
  const preview = completeDropDwell(dwell, dest, now() + DROP_INTENT_TOKENS.dwellMs);
  assert.equal(preview.status, 'preview');
  if (preview.status !== 'preview') return;
  assert.equal(preview.destination.targetId, 'canvas:main');
  assert.deepEqual(preview.destination.previewPoint, centre);
});
