import { afterEach, describe, expect, it } from 'vitest';
import { useLcosDropStore } from './lcosDropState';
import type { DropPayload } from '@local-creative-os/web-gen2';

const payload: DropPayload = { kind: 'assembly', itemId: 'collection-a',
  sourceRef: { kind: 'collection', id: 'collection-a' }, entityRef: { type: 'collection', id: 'collection-a' } };
function start() {
  const store = useLcosDropStore.getState();
  store.reset();
  store.begin(payload);
  store.setBounds({ left: 0, top: 0, right: 1000, bottom: 700 });
  store.advance({ x: 240, y: 180 }, false, 100, undefined, undefined, undefined, { x: 440, y: 260 });
  return useLcosDropStore.getState();
}
afterEach(() => useLcosDropStore.getState().reset());
describe('carry pointer belongs to the existing transient Drop presentation', () => {
  it('preserves a screen sample without inventing a target or altering the payload', () => {
    const store = start();
    expect(store.pointerScreenPoint).toEqual({ x: 440, y: 260 });
    expect(store.resolution).toBeNull();
    expect(store.state.status).toBe('tracking');
    if ('payload' in store.state) expect(store.state.payload).toBe(payload);
  });
  it.each(['cancel', 'reset', 'dismissFeedback'] as const)('%s removes the pointer together with the carry', (action) => {
    start()[action]();
    expect(useLcosDropStore.getState().pointerScreenPoint).toBeNull();
  });
  it('does not retain the old pointer after reacquisition', () => {
    start().begin(payload);
    expect(useLcosDropStore.getState().pointerScreenPoint).toBeNull();
  });
  it('ignores non-finite transport samples', () => {
    start().advance({ x: 250, y: 180 }, false, 101, undefined, undefined, undefined, { x: Infinity, y: 300 });
    expect(useLcosDropStore.getState().pointerScreenPoint).toBeNull();
  });
  it('keeps the pointer out of durable intent but retains the visual sample through committing', () => {
    const store = start();
    store.advance({ x: 250, y: 180 }, true, 101,
      { targetId: 'target-b', previewPoint: { x: 250, y: 180 } },
      { status: 'ready', intent: { kind: 'collection-membership', targetId: 'target-b', collectionId: 'collection-b',
        memberRef: { type: 'collection', id: 'collection-a' } } }, undefined, { x: 450, y: 260 });
    const ready = useLcosDropStore.getState();
    expect(JSON.stringify(ready.resolution)).not.toContain('pointerScreenPoint');
    ready.commitAt('commit-a');
    const committing = useLcosDropStore.getState();
    expect(committing.state.status).toBe('committing');
    expect(committing.pointerScreenPoint).toEqual({ x: 450, y: 260 });
    committing.settle({ status: 'success', transactionId: 'commit-a', targetId: 'target-b' });
    expect(useLcosDropStore.getState().feedback?.receipt.status).toBe('success');
    expect(useLcosDropStore.getState().pointerScreenPoint).toBeNull();
  });
});
