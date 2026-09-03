// A03 + A06 regression tests — the reference-pick and semantic-drop
// recognizers must follow the frozen gestures through the Huabu router
// contract.
//
// Fake pointer events carry only what a recognizer reads (pointerType,
// button, isPrimary, modifiers, client coords, pointerId, preventDefault /
// stopPropagation spies). The router context is the minimal subset a
// recognizer touches (interactivityLocked for the picker; wrapper bounding
// rect for the drop driver).

import { describe, expect, it, beforeEach, vi } from 'vitest';

import { createReferencePickRecognizer, createDropRecognizer, acquireDrop } from './lcosRecognizers';
import { useLcosReferenceStore } from './lcosReferenceState';
import { useLcosDropStore } from './lcosDropState';

interface FakeEvent {
  pointerId: number;
  pointerType: string;
  button: number;
  isPrimary: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  clientX: number;
  clientY: number;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

function fakeEvent(overrides: Partial<FakeEvent> = {}): FakeEvent & PointerEvent {
  const base = {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    isPrimary: true,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    clientX: 10,
    clientY: 10,
  };
  const event = {
    ...base,
    ...overrides,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as FakeEvent;
  return event as unknown as FakeEvent & PointerEvent;
}

const ctx = { interactivityLocked: false } as never;

// The recognizer resolves the node under the pointer through
// nodeIdAtScreenPoint — mock the module so tests control the hit target.
const mockHitNode = vi.hoisted(() => ({ current: null as string | null }));
vi.mock('@/handler/canvasNodeAtPoint', () => ({
  nodeIdAtScreenPoint: (_x: number, _y: number) => mockHitNode.current,
}));

// A06 drop recognizer reads ctx.wrapper.getBoundingClientRect() for the
// screen-space surface the dwell anchors are judged against.
const dropWrapper = {
  getBoundingClientRect: () => ({
    left: 0,
    right: 1200,
    top: 0,
    bottom: 800,
    width: 1200,
    height: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }),
} as unknown as HTMLDivElement;
const dropCtx = { wrapper: dropWrapper } as never;

const REF_A = { entityType: 'artifact', entityId: 'a1' };
const REF_B = { entityType: 'artifact', entityId: 'b2' };

beforeEach(() => {
  mockHitNode.current = null;
  useLcosReferenceStore.getState().reset();
  useLcosDropStore.getState().reset();
});

describe('reference-pick recognizer (A03)', () => {
  it('Ctrl+click a projected node toggles it into the ordered draft references', () => {
    useLcosReferenceStore.getState().registerNodeEntity('node-1', REF_A);
    mockHitNode.current = 'node-1';
    const recognizer = createReferencePickRecognizer();

    expect(recognizer.canClaim(fakeEvent({ ctrlKey: true }), ctx)).toBe(true);
    expect(recognizer.onDown(fakeEvent({ ctrlKey: true }), ctx)).toBe('claim');
    recognizer.onUp?.(fakeEvent({ ctrlKey: true }), ctx);

    const refs = useLcosReferenceStore.getState().orderedNodeReferences();
    expect(refs.map((r) => r.entityId)).toEqual(['a1']);
  });

  it('selection is untouched: claiming suppresses the default chain (preventDefault + stopPropagation)', () => {
    useLcosReferenceStore.getState().registerNodeEntity('node-1', REF_A);
    mockHitNode.current = 'node-1';
    const recognizer = createReferencePickRecognizer();

    const down = fakeEvent({ ctrlKey: true });
    recognizer.onDown(down, ctx);
    expect(down.preventDefault).toHaveBeenCalled();
    expect(down.stopPropagation).toHaveBeenCalled();
  });

  it('a second Ctrl+click on the same node REMOVES it (toggle, order preserved)', () => {
    const store = useLcosReferenceStore.getState();
    store.registerNodeEntity('node-1', REF_A);
    store.registerNodeEntity('node-2', REF_B);
    mockHitNode.current = 'node-1';
    const recognizer = createReferencePickRecognizer();

    // pick A, pick B, then un-pick A — B stays, alone, in order.
    recognizer.onDown(fakeEvent({ ctrlKey: true }), ctx);
    recognizer.onUp?.(fakeEvent({ ctrlKey: true }), ctx);
    mockHitNode.current = 'node-2';
    recognizer.onDown(fakeEvent({ pointerId: 2, ctrlKey: true }), ctx);
    recognizer.onUp?.(fakeEvent({ pointerId: 2, ctrlKey: true }), ctx);
    mockHitNode.current = 'node-1';
    recognizer.onDown(fakeEvent({ pointerId: 3, ctrlKey: true }), ctx);
    recognizer.onUp?.(fakeEvent({ pointerId: 3, ctrlKey: true }), ctx);

    const refs = useLcosReferenceStore.getState().orderedNodeReferences();
    expect(refs.map((r) => r.entityId)).toEqual(['b2']);
  });

  it('Shift NEVER triggers a reference pick (Shift wins — additive selection keeps Huabu)', () => {
    useLcosReferenceStore.getState().registerNodeEntity('node-1', REF_A);
    mockHitNode.current = 'node-1';
    const recognizer = createReferencePickRecognizer();

    const withShift = fakeEvent({ shiftKey: true, ctrlKey: true });
    expect(recognizer.canClaim(withShift, ctx)).toBe(false);
    const withShiftOnly = fakeEvent({ shiftKey: true });
    expect(recognizer.canClaim(withShiftOnly, ctx)).toBe(false);
  });

  it('native (unregistered) node without a Core binding is REFUSED — fail-close, no note:<id> fabrication (audit P0-3)', () => {
    mockHitNode.current = 'native-node';
    const recognizer = createReferencePickRecognizer();

    // canClaim may still be true (gesture shape), but onDown must fail-close:
    // the node has no ProjectionBinding-derived Core ref -> no claim, no toggle.
    const event = fakeEvent({ ctrlKey: true });
    expect(recognizer.onDown(event, ctx)).toBe('pass');
    expect(useLcosReferenceStore.getState().orderedNodeReferences()).toEqual([]);
    expect(useLcosReferenceStore.getState().nodeEntityRefs.has('native-node')).toBe(false);
  });

  it('a BOUND native node is referenceable — binding-derived identity, claim + toggle', () => {
    // binding-derived cache (P0-5): reference store holds a real CoreEntityRef
    mockHitNode.current = 'native-node';
    useLcosReferenceStore.getState().registerNodeEntity('native-node', {
      entityType: 'artifact',
      entityId: 'art-native',
    });
    const recognizer = createReferencePickRecognizer();

    const event = fakeEvent({ ctrlKey: true });
    expect(recognizer.onDown(event, ctx)).toBe('claim');
    recognizer.onUp?.(fakeEvent({ ctrlKey: true }), ctx);
    const refs = useLcosReferenceStore.getState().orderedNodeReferences();
    expect(refs).toEqual([{ entityType: 'artifact', entityId: 'art-native' }]);
  });

  it('a second Ctrl+click on the same BOUND native node un-references it (toggle parity)', () => {
    mockHitNode.current = 'native-node';
    useLcosReferenceStore.getState().registerNodeEntity('native-node', {
      entityType: 'artifact',
      entityId: 'art-native',
    });
    const recognizer = createReferencePickRecognizer();

    recognizer.onDown(fakeEvent({ ctrlKey: true }), ctx);
    recognizer.onUp?.(fakeEvent({ ctrlKey: true }), ctx);
    recognizer.onDown(fakeEvent({ pointerId: 2, ctrlKey: true }), ctx);
    recognizer.onUp?.(fakeEvent({ pointerId: 2, ctrlKey: true }), ctx);

    expect(useLcosReferenceStore.getState().orderedNodeReferences()).toEqual([]);
  });

  it('a drag beyond the slop cancels the pick — no phantom reference on Ctrl+drag', () => {
    useLcosReferenceStore.getState().registerNodeEntity('node-1', REF_A);
    mockHitNode.current = 'node-1';
    const recognizer = createReferencePickRecognizer();

    recognizer.onDown(fakeEvent({ ctrlKey: true, clientX: 0, clientY: 0 }), ctx);
    recognizer.onMove?.(fakeEvent({ ctrlKey: true, clientX: 50, clientY: 50 }), ctx);
    recognizer.onUp?.(fakeEvent({ ctrlKey: true, clientX: 50, clientY: 50 }), ctx);

    expect(useLcosReferenceStore.getState().orderedNodeReferences()).toEqual([]);
  });

  it('touch pointers never claim (touch gestures keep their Huabu owners)', () => {
    useLcosReferenceStore.getState().registerNodeEntity('node-1', REF_A);
    mockHitNode.current = 'node-1';
    const recognizer = createReferencePickRecognizer();

    expect(
      recognizer.canClaim(fakeEvent({ ctrlKey: true, pointerType: 'touch' }), ctx),
    ).toBe(false);
  });

  it('Cmd (meta) alone also picks — macOS parity', () => {
    useLcosReferenceStore.getState().registerNodeEntity('node-1', REF_A);
    mockHitNode.current = 'node-1';
    const recognizer = createReferencePickRecognizer();

    expect(recognizer.canClaim(fakeEvent({ metaKey: true }), ctx)).toBe(true);
    recognizer.onDown(fakeEvent({ metaKey: true }), ctx);
    recognizer.onUp?.(fakeEvent({ metaKey: true }), ctx);
    expect(
      useLcosReferenceStore.getState().orderedNodeReferences().length,
    ).toBe(1);
  });

  it('interactivityLocked disables claiming', () => {
    useLcosReferenceStore.getState().registerNodeEntity('node-1', REF_A);
    mockHitNode.current = 'node-1';
    const recognizer = createReferencePickRecognizer();
    const lockedCtx = { interactivityLocked: true } as never;

    expect(recognizer.canClaim(fakeEvent({ ctrlKey: true }), lockedCtx)).toBe(false);
  });
});

describe('semantic-drop recognizer (A06)', () => {
  it('is a pure observer: never claims a pointer, never invents a payload', () => {
    const recognizer = createDropRecognizer();
    expect(recognizer.canClaim(fakeEvent(), ctx)).toBe(false);
    expect(recognizer.onDown(fakeEvent(), ctx)).toBe('pass');
  });

  it('acquireDrop starts a drop with a real payload', () => {
    expect(useLcosDropStore.getState().state.status).toBe('idle');
    acquireDrop({ kind: 'text', value: 'hello' });
    expect(useLcosDropStore.getState().state.status).toBe('tracking');
  });

  it('observes pointer movement into the dwell band, then cancels on release', () => {
    acquireDrop({ kind: 'object', entityType: 'artifact', entityId: 'a1' });
    const recognizer = createDropRecognizer();

    recognizer.observe?.onDown?.(fakeEvent(), dropCtx);
    // move into the bottom dwell band -> dwell (bounds read from the wrapper).
    recognizer.observe?.onMove?.(fakeEvent({ clientX: 400, clientY: 795 }), dropCtx);
    expect(useLcosDropStore.getState().state.status).toBe('dwell');

    recognizer.observe?.onUp?.(fakeEvent({ clientX: 400, clientY: 795 }), dropCtx);
    expect(useLcosDropStore.getState().state.status).toBe('idle');
  });

  it('ignores movement when no drop is in flight (idle observer is passive)', () => {
    const recognizer = createDropRecognizer();
    recognizer.observe?.onDown?.(fakeEvent(), dropCtx);
    recognizer.observe?.onMove?.(fakeEvent({ clientX: 400, clientY: 795 }), dropCtx);
    expect(useLcosDropStore.getState().state.status).toBe('idle');
  });
});