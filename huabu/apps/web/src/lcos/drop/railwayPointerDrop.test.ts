import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveDropIntent } from './dropIntentResolver';
import { createRailwayPointerDropController, type RailwayPointerDropPort } from './railwayPointerDrop';
import { railwayAggregatePayload, type RailwayAggregateSourceSnapshot } from './railwayAssemblyDrop';

import type { DropPayload, SemanticDropState } from '@local-creative-os/web-gen2';
import type { DropResolution } from './dropTypes';
import type { RailwayDestinationV1 } from '@local-creative-os/contracts';
import type { PointerEvent as ReactPointerEvent } from 'react';

const destination: RailwayDestinationV1 = {
  key: 'worksite:target', ref: { kind: 'worksite', projectId: 'project-1', worksiteId: 'workspace-target' },
  label: '目标现场', role: 'worksite', available: true, workspaceId: 'workspace-target', canvasId: 'canvas-target', accepts: ['artifactView', 'note'],
};

const targetId = 'canvas:main';
const mainTarget = { targetId, enabled: true, semantic: { kind: 'canvas' as const, targetRef: { kind: 'main' as const } } };

function payload(kind: 'scene' | 'context' | 'workflow' | 'collection' = 'scene'): DropPayload {
  const id = kind === 'scene' ? 'workspace-source' : `${kind}-source`;
  const entityType = kind === 'scene' ? 'workspace' : kind === 'collection' ? 'collection' : 'scope';
  const sourceRef = { kind, id } as Extract<import('@local-creative-os/contracts').AssemblySourceRefV1,
    { kind: 'scene' | 'context' | 'workflow' | 'collection' }>;
  return railwayAggregatePayload({ projectId: 'project-1', sourceRef, entityRef: { type: entityType, id }, label: id, available: true }, 'project-1')!;
}

function pointerEvent(input: { button: number; buttons: number; altKey?: boolean; target?: EventTarget | null; pointerId?: number; x?: number; y?: number }) {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  const currentTarget = document.createElement('button');
  currentTarget.setPointerCapture = vi.fn();
  currentTarget.hasPointerCapture = vi.fn(() => false);
  currentTarget.releasePointerCapture = vi.fn();
  const event = new Event('pointerdown', { cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: input.pointerId ?? 7 }, pointerType: { value: 'mouse' },
    button: { value: input.button }, buttons: { value: input.buttons }, altKey: { value: input.altKey ?? false },
    clientX: { value: input.x ?? 10 }, clientY: { value: input.y ?? 10 },
    target: { value: input.target ?? currentTarget }, currentTarget: { value: currentTarget },
    preventDefault: { value: preventDefault }, stopPropagation: { value: stopPropagation },
  });
  return { event: event as unknown as ReactPointerEvent<HTMLElement>, currentTarget, preventDefault, stopPropagation };
}

function pointerMove(input: { pointerId?: number; buttons: number; x?: number; y?: number }) {
  const event = new Event('pointermove', { cancelable: true });
  Object.defineProperties(event, { pointerId: { value: input.pointerId ?? 7 }, pointerType: { value: 'mouse' },
    button: { value: -1 }, buttons: { value: input.buttons }, clientX: { value: input.x ?? 30 }, clientY: { value: input.y ?? 30 } });
  return event;
}

function pointerUp(input: { pointerId?: number; button: number; buttons?: number; x?: number; y?: number }) {
  const event = new Event('pointerup', { cancelable: true });
  Object.defineProperties(event, { pointerId: { value: input.pointerId ?? 7 }, pointerType: { value: 'mouse' },
    button: { value: input.button }, buttons: { value: input.buttons ?? 0 }, clientX: { value: input.x ?? 40 }, clientY: { value: input.y ?? 40 } });
  return event;
}

function pointerCancel() {
  const event = new Event('pointercancel', { cancelable: true });
  Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: 'mouse' }, button: { value: -1 }, buttons: { value: 0 }, clientX: { value: 40 }, clientY: { value: 40 } });
  return event;
}

type AdvanceResult = { readonly state: SemanticDropState; readonly resolution: DropResolution | null }
  | ((current: SemanticDropState) => { readonly state: SemanticDropState; readonly resolution: DropResolution | null });

function harness(advanceResults: readonly AdvanceResult[] = []) {
  let state: SemanticDropState = { status: 'idle' };
  let resolution: DropResolution | null = null;
  let projectId: string | null = 'project-1';
  let index = 0;
  const begin = vi.fn((value: Extract<DropPayload, { kind: 'assembly' }>) => { state = { status: 'tracking', payload: value }; return true; });
  const advance = vi.fn(() => {
    const queued = advanceResults[index++];
    const result = typeof queued === 'function' ? queued(state) : queued ?? {
      state: { status: 'preview', payload: (state as Exclude<SemanticDropState, { status: 'idle' } | { status: 'failed' }>).payload,
        destination: { targetId, previewPoint: { x: 40, y: 40 } }, carryAnchor: 'left' } as SemanticDropState,
      resolution: resolveDropIntent((state as Exclude<SemanticDropState, { status: 'idle' } | { status: 'failed' }>).payload, mainTarget),
    };
    state = result.state; resolution = result.resolution; return true;
  });
  const commit = vi.fn(() => {
    if (state.status !== 'preview') return false;
    const preview = state;
    state = { ...preview, status: 'committing', intent: { kind: 'assembly-apply', targetId }, transactionId: 'tx-1' };
    return true;
  });
  const cancel = vi.fn(() => { if (state.status === 'tracking' || state.status === 'dwell' || state.status === 'preview') state = { status: 'idle' }; });
  const port: RailwayPointerDropPort = { read: () => ({ state, resolution }), begin, advance, commit, cancel, currentProjectId: () => projectId };
  return { port, begin, advance, commit, cancel, read: () => ({ state, resolution }), setProject: (next: string | null) => { projectId = next; } };
}

afterEach(() => vi.restoreAllMocks());

describe('Railway pointer transport reuses Semantic Drop ownership', () => {
  it.each([
    [{ button: 2, buttons: 2 }, 'secondary-pointer'],
    [{ button: 0, buttons: 1, altKey: true }, 'modifier-primary'],
  ] as const)('arms a frozen aggregate source and acquires only after movement for trigger %s', (input, _trigger) => {
    const fixture = harness();
    const event = pointerEvent(input);
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    expect(controller.onPointerDown(event.event, destination, 'project-1')).toBe(true);
    expect(fixture.begin).not.toHaveBeenCalled();
    expect(fixture.read().state.status).toBe('idle');
    events.dispatchEvent(pointerMove({ buttons: input.buttons }));
    const state = fixture.read().state;
    expect(state).toMatchObject({ status: 'preview', payload: { sourceRef: { kind: 'scene', id: 'workspace-target' } } });
    if (!('payload' in state)) throw new Error('Expected the existing Drop store payload');
    expect(Object.isFrozen(state.payload)).toBe(true);
    expect(fixture.begin).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledTimes(input.button === 0 ? 1 : 0);
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    controller.dispose();
    expect(fixture.cancel).toHaveBeenCalledOnce();
  });

  it('recognizes an explicit Semantic Drop handle without consuming ordinary left-drag', () => {
    const fixture = harness();
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    const plain = pointerEvent({ button: 0, buttons: 1 });
    expect(controller.onPointerDown(plain.event, destination, 'project-1')).toBe(false);
    const handle = document.createElement('span');
    handle.dataset.semanticDropHandle = '';
    const explicit = pointerEvent({ button: 0, buttons: 1, target: handle });
    expect(controller.onPointerDown(explicit.event, destination, 'project-1')).toBe(true);
    expect(fixture.begin).not.toHaveBeenCalled();
    events.dispatchEvent(pointerMove({ buttons: 1 }));
    expect(fixture.begin).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it.each([
    [{kind:'context',id:'scope-context'}, 'scope'], [{kind:'workflow',id:'scope-workflow'}, 'scope'], [{kind:'collection',id:'collection-aggregate'}, 'collection'],
  ] as const)('captures one frozen %s aggregate from the canonical Rail row', (sourceRef, entityType) => {
    const fixture = harness();
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    const source: RailwayAggregateSourceSnapshot = { projectId: 'project-1', sourceRef,
      entityRef: { type: entityType, id: sourceRef.id }, label: sourceRef.id, available: true };
    expect(controller.onPointerDown(pointerEvent({ button: 0, buttons: 1, altKey: true }).event, source, 'project-1')).toBe(true);
    expect(fixture.begin).not.toHaveBeenCalled();
    events.dispatchEvent(pointerMove({ buttons: 1 }));
    const current = fixture.read().state;
    expect(current).toMatchObject({ status: 'preview', payload: { sourceRef } });
    if (!('payload' in current)) throw new Error('Expected aggregate payload');
    expect(Object.isFrozen(current.payload)).toBe(true);
    controller.dispose();
  });

  it('advances the existing target resolver on move and re-hits release before one commit', () => {
    const fixture = harness();
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    controller.onPointerDown(pointerEvent({ button: 2, buttons: 2 }).event, destination, 'project-1');
    events.dispatchEvent(pointerMove({ buttons: 2, x: 20, y: 20 }));
    expect(fixture.advance).toHaveBeenCalledTimes(1);
    events.dispatchEvent(pointerUp({ button: 2, x: 40, y: 40 }));
    expect(fixture.advance).toHaveBeenCalledTimes(2);
    expect(fixture.commit).toHaveBeenCalledOnce();
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.read().state.status).toBe('committing');
    controller.dispose();
    expect(fixture.cancel).not.toHaveBeenCalled();
  });

  it('cancels if only the release point discovers a target or the receiver changes', () => {
    const fixture = harness([
      (current) => ({ state: current, resolution: null }),
      (current) => { const source = 'payload' in current ? current.payload : payload('scene'); return {
        state: { status: 'preview', payload: source, destination: { targetId, previewPoint: { x: 40, y: 40 } }, carryAnchor: 'left' },
        resolution: resolveDropIntent(source, mainTarget),
      }; },
    ]);
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    controller.onPointerDown(pointerEvent({ button: 0, buttons: 1, altKey: true }).event, destination, 'project-1');
    events.dispatchEvent(pointerMove({ buttons: 1 }));
    events.dispatchEvent(pointerUp({ button: 0 }));
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.cancel).toHaveBeenCalledOnce();
    controller.dispose();

    const otherTarget = { targetId: 'canvas:other', enabled: true, semantic: { kind: 'canvas' as const, targetRef: { kind: 'main' as const } } };
    const changed = harness([
      (current) => { const source = 'payload' in current ? current.payload : payload('scene'); return {
        state: { status: 'preview', payload: source, destination: { targetId, previewPoint: { x: 20, y: 20 } }, carryAnchor: 'left' }, resolution: resolveDropIntent(source, mainTarget),
      }; },
      (current) => { const source = 'payload' in current ? current.payload : payload('scene'); return {
        state: { status: 'preview', payload: source, destination: { targetId: otherTarget.targetId, previewPoint: { x: 40, y: 40 } }, carryAnchor: 'left' }, resolution: resolveDropIntent(source, otherTarget),
      }; },
    ]);
    const changedEvents = new EventTarget();
    const changedController = createRailwayPointerDropController(changed.port, changedEvents);
    changedController.onPointerDown(pointerEvent({ button: 2, buttons: 2 }).event, destination, 'project-1');
    changedEvents.dispatchEvent(pointerMove({ buttons: 2 }));
    changedEvents.dispatchEvent(pointerUp({ button: 2 }));
    expect(changed.commit).not.toHaveBeenCalled();
    expect(changed.cancel).toHaveBeenCalledOnce();
    changedController.dispose();
  });

  it.each(['pointercancel', 'Escape', 'blur', 'project-switch', 'button-lost'] as const)('cancels pending pointer session on %s', (reason) => {
    const fixture = harness();
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    controller.onPointerDown(pointerEvent({ button: 2, buttons: 2 }).event, destination, 'project-1');
    events.dispatchEvent(pointerMove({ buttons: 2 }));
    if (reason === 'pointercancel') events.dispatchEvent(pointerCancel());
    else if (reason === 'Escape') {
      const escape = new Event('keydown', { cancelable: true }); Object.defineProperty(escape, 'key', { value: 'Escape' });
      events.dispatchEvent(escape);
    } else if (reason === 'blur') events.dispatchEvent(new Event('blur'));
    else if (reason === 'project-switch') { fixture.setProject('project-2'); events.dispatchEvent(pointerMove({ buttons: 2 })); }
    else events.dispatchEvent(pointerMove({ buttons: 0 }));
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.cancel).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it('keeps a stationary right click and a movement of at most four pixels outside the Drop owner', () => {
    const fixture = harness();
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    const down = pointerEvent({ button: 2, buttons: 2 });
    controller.onPointerDown(down.event, destination, 'project-1');
    events.dispatchEvent(pointerMove({ buttons: 2, x: 14, y: 10 }));
    const menu = new Event('contextmenu', { cancelable: true });
    events.dispatchEvent(menu);
    events.dispatchEvent(pointerUp({ button: 2, x: 14, y: 10 }));
    expect(menu.defaultPrevented).toBe(false);
    expect(down.currentTarget.setPointerCapture).not.toHaveBeenCalled();
    expect(fixture.begin).not.toHaveBeenCalled();
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.commit).not.toHaveBeenCalled();
    expect(fixture.read().state.status).toBe('idle');
    controller.dispose();
  });

  it('does not cancel an unrelated gesture that acquired the owner while this source was only armed', () => {
    const fixture = harness();
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    controller.onPointerDown(pointerEvent({ button: 2, buttons: 2 }).event, destination, 'project-1');
    const other = payload('collection') as Extract<DropPayload, {kind:'assembly'}>;
    fixture.port.begin(other);
    events.dispatchEvent(pointerMove({ buttons: 2 }));
    expect(fixture.begin).toHaveBeenCalledOnce();
    expect(fixture.cancel).not.toHaveBeenCalled();
    expect(fixture.read().state).toMatchObject({status:'tracking',payload:other});
    controller.dispose();
  });

  it('suppresses only the compatibility click after a drag and leaves the next deliberate click alone', () => {
    const fixture = harness();
    const events = new EventTarget();
    const controller = createRailwayPointerDropController(fixture.port, events);
    controller.onPointerDown(pointerEvent({ button: 0, buttons: 1, altKey:true }).event, destination, 'project-1');
    events.dispatchEvent(pointerMove({ buttons:1 }));
    events.dispatchEvent(pointerUp({ button:0 }));
    const click = new MouseEvent('click', {detail:1,cancelable:true});
    Object.defineProperty(click,'pointerId',{value:7});
    events.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    const next = new MouseEvent('click', {detail:1,cancelable:true});
    Object.defineProperty(next,'pointerId',{value:7});
    events.dispatchEvent(new Event('pointerdown'));
    events.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
    controller.dispose();
  });

});


it('cancels when the current project becomes unavailable before a release', () => {
  const fixture = harness();
  const events = new EventTarget();
  const controller = createRailwayPointerDropController(fixture.port, events);
  controller.onPointerDown(pointerEvent({button:2,buttons:2}).event, destination, 'project-1');
  events.dispatchEvent(pointerMove({buttons:2}));
  fixture.setProject(null);
  events.dispatchEvent(pointerUp({button:2}));
  expect(fixture.commit).not.toHaveBeenCalled();
  expect(fixture.cancel).toHaveBeenCalledOnce();
  controller.dispose();
});

it('retains keyboard activation while suppressing the pointer compatibility click', () => {
  const fixture = harness();
  const events = new EventTarget();
  const controller = createRailwayPointerDropController(fixture.port, events);
  controller.onPointerDown(pointerEvent({button:0,buttons:1,altKey:true}).event, destination, 'project-1');
  events.dispatchEvent(pointerMove({buttons:1}));
  events.dispatchEvent(pointerUp({button:0}));
  const keyboardClick = new MouseEvent('click', {detail:0,cancelable:true});
  events.dispatchEvent(keyboardClick);
  expect(keyboardClick.defaultPrevented).toBe(false);
  controller.dispose();
});
