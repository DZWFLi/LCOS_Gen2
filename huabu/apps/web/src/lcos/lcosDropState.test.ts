// A06 Semantic Drop store tests: the presentation layer drives the pure
// web-gen2 machine through the store's begin/advance/commit/cancel actions.
import { beforeEach, describe, expect, it } from 'vitest';

import { useLcosDropStore } from './lcosDropState';

import type { DropResolution } from './drop/dropTypes';

const BOUNDS = { left: 0, right: 1200, top: 0, bottom: 800 };
const PAYLOAD = { kind: 'object', entityType: 'artifact', entityId: 'a1' } as const;
const CANVAS_RESOLUTION: DropResolution = {
  status: 'ready',
  intent: {
    kind: 'assembly-apply',
    targetId: 'canvas:main',
    targetRef: { kind: 'main' },
    sourceRefs: [{ kind: 'artifactView', id: 'a1' }],
  },
};

const act = () => useLcosDropStore.getState();
const state = () => useLcosDropStore.getState().state;

beforeEach(() => {
  useLcosDropStore.getState().reset();
});

describe('LcosDropStore (A06)', () => {
  it('begin acquires a payload into tracking', () => {
    act().begin(PAYLOAD);
    expect(state().status).toBe('tracking');
  });

  it('advance without bounds is a no-op (nothing spatial to judge against)', () => {
    act().begin(PAYLOAD);
    act().advance({ x: 400, y: 795 }, false, 1000);
    expect(state().status).toBe('tracking');
  });

  it('held at an edge band stays dwell until a live target is supplied', () => {
    act().begin(PAYLOAD);
    act().setBounds(BOUNDS);
    act().advance({ x: 400, y: 795 }, false, 1000);
    expect(state().status).toBe('dwell');
    // still within the dwell window (1000 -> 1420)
    act().advance({ x: 400, y: 795 }, false, 1300);
    expect(state().status).toBe('dwell');
    // An edge band alone is not a business destination.
    act().advance({ x: 400, y: 795 }, false, 1500);
    expect(state().status).toBe('dwell');
  });

  it('creates a preview only from the supplied registered target', () => {
    act().begin(PAYLOAD);
    act().setBounds(BOUNDS);
    act().advance({ x: 400, y: 795 }, false, 1000);
    act().advance(
      { x: 400, y: 795 },
      true,
      1500,
      { targetId: 'canvas:main', previewPoint: { x: 400, y: 795 } },
      CANVAS_RESOLUTION,
    );
    expect(state().status).toBe('preview');
    const st = state();
    if (st.status !== 'preview') throw new Error('expected preview');
    expect(st.destination.targetId).toBe('canvas:main');
  });

  it('commitAt turns a preview into committing', () => {
    act().begin(PAYLOAD);
    act().setBounds(BOUNDS);
    act().advance({ x: 400, y: 795 }, false, 1000);
    act().advance(
      { x: 400, y: 795 },
      true,
      1500,
      { targetId: 'canvas:main', previewPoint: { x: 400, y: 795 } },
      CANVAS_RESOLUTION,
    );
    act().commitAt('tx-1');
    expect(state()).toEqual({
      status: 'committing',
      payload: PAYLOAD,
      destination: { targetId: 'canvas:main', previewPoint: { x: 400, y: 795 } },
      carryAnchor: 'bottom',
      intent: { kind: 'assembly-apply', targetId: 'canvas:main' },
      transactionId: 'tx-1',
    });
  });

  it('a target disappearing invalidates the preview and cannot commit', () => {
    act().begin(PAYLOAD);
    act().setBounds(BOUNDS);
    act().advance({ x: 400, y: 795 }, false, 1000);
    act().advance(
      { x: 400, y: 795 },
      true,
      1500,
      { targetId: 'canvas:main', previewPoint: { x: 400, y: 795 } },
      CANVAS_RESOLUTION,
    );
    act().advance({ x: 400, y: 795 }, false, 1600);
    expect(state().status).toBe('tracking');
    act().commitAt('tx-gone');
    expect(state().status).toBe('tracking');
  });

  it('cancel aborts an uncommitted drop back to idle', () => {
    act().begin(PAYLOAD);
    act().setBounds(BOUNDS);
    act().advance({ x: 0, y: 400 }, false, 1000); // left band
    expect(state().status).toBe('dwell');
    act().cancel();
    expect(state().status).toBe('idle');
  });

  it('fail surfaces a recoverable reason', () => {
    act().fail('core unreachable', true);
    expect(state()).toEqual({
      status: 'failed',
      reason: 'core unreachable',
      recoverable: true,
    });
  });
});
