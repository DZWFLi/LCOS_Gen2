import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRightCarryRecognizer, type RightCarrySource } from '../../../huabu/apps/web/src/lcos/drop/rightCarry';
import { PointerRouterCore } from '../../../huabu/apps/web/src/handler/pointerRouter';
import { beginDrop, confirmDrop, idleDrop } from '../src/interaction/semanticDropMachine';
import { resolveDropIntent } from '../../../huabu/apps/web/src/lcos/drop/dropIntentResolver';
import type { DropResolution, DropTargetRegistration } from '../../../huabu/apps/web/src/lcos/drop/dropTypes';
import type { CanvasPointerRouterContext } from '../../../huabu/apps/web/src/handler/canvasPointerRouterContext';
import type { SemanticDropState } from '../src/interaction/semanticDropMachine';

function fixture(count = 1, unboundMember = false) {
  let state: SemanticDropState = idleDrop(); let resolution: DropResolution | null = null;
  let current = true; let bound = true; let enabled = true; let targetId = 'glyth:target'; let conversationId = 'conversation';
  let starts = 0, commits = 0, cancels = 0, menuBegins = 0; const menus: boolean[] = [], errors: string[] = [];
  const excluded: string[][] = [];
  const captured = new Set<number>();
  const source: RightCarrySource = {
    scope: { projectId: 'p', canvasId: 'canvas' }, primaryNodeId: 'n0', element: {} as Element,
    nodes: Array.from({ length: count }, (_, i) => ({ nodeId: `n${i}`, position: { x: i * 100, y: 20 }, absolutePosition: { x: i * 100, y: 20 },
      reference: unboundMember && i === 1 ? undefined : { entityType: 'artifact', entityId: `a${i}`, artifactViewId: `view-${i}` } })),
  };
  const before = structuredClone(source.nodes);
  const ctx = { wrapper: { setPointerCapture(id: number) { captured.add(id); }, hasPointerCapture: (id: number) => captured.has(id), releasePointerCapture(id: number) { captured.delete(id); } },
    interactivityLocked: false, explicitToolActive: false } as unknown as CanvasPointerRouterContext;
  const recognizer = createRightCarryRecognizer({
    acquire: () => bound ? source : undefined, isCurrent: () => current,
    read: () => ({ state, resolution }), begin: (payload, _id, ids) => { starts++; excluded.push([...ids]); state = beginDrop(payload); },
    advance: (event) => {
      if (!('payload' in state)) return;
      if (event.clientX < 100) { state = { status: 'tracking', payload: state.payload }; resolution = null; return; }
      const target: DropTargetRegistration = { targetId, kind: 'collaboration-reference', label: '会话上下文', priority: 20, rect: { left: 100, top: 0, width: 300, height: 300 }, enabled,
        semantic: { kind: 'collaboration-reference', conversationId }, ineligibleReason: '暂不可用' };
      resolution = resolveDropIntent(state.payload, target);
      state = { status: 'preview', payload: state.payload, destination: { targetId, previewPoint: { x: event.clientX, y: event.clientY } }, carryAnchor: 'left' } as SemanticDropState;
    }, commit: () => { commits++; if (state.status === 'preview') state = confirmDrop(state, 'tx'); },
    cancel: () => { cancels++; state = idleDrop(); resolution = null; }, reject: text => errors.push(text), threshold: () => 4,
    beginMenu: () => { menuBegins++; }, finishMenu: show => menus.push(show),
  });
  const router = new PointerRouterCore([recognizer], () => ctx);
  const event = (x: number, patch: Partial<PointerEvent> = {}) => ({ pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 2, buttons: 2,
    clientX: x, clientY: 20, preventDefault() {}, stopPropagation() {}, ...patch } as PointerEvent);
  return { source, ctx, router, event, down: () => router.handleDown(event(0)), move: (x: number) => router.handleMove(event(x)), up: (x: number) => router.handleUp(event(x, { buttons: 0 })),
    change: (patch: { current?: boolean; bound?: boolean; enabled?: boolean; conversationId?: string; targetId?: string }) => { if (patch.current !== undefined) current = patch.current; if (patch.bound !== undefined) bound = patch.bound; if (patch.enabled !== undefined) enabled = patch.enabled; if (patch.conversationId) conversationId = patch.conversationId; if (patch.targetId) targetId = patch.targetId; },
    check: () => { assert.deepEqual(source.nodes, before); return { state, resolution, starts, commits, cancels, menuBegins, menus, errors, captured: captured.size, excluded }; },
  };
}

test('R3 right tap defers menu until release; no payload, mutation or source movement', () => {
  const f = fixture(); f.down(); assert.equal(f.check().captured, 1); f.up(1);
  assert.deepEqual(f.check().menus, [true]); assert.equal(f.check().starts, 0); assert.equal(f.check().commits, 0); assert.equal(f.check().captured, 0);
});
test('R3 right group carry preserves source/view identities and commits exactly once', () => {
  const f = fixture(3); f.down(); f.move(150); f.move(160); f.up(160); f.up(160);
  const r = f.check(); assert.equal(r.commits, 1); assert.equal(r.starts, 1); assert.deepEqual(r.menus, [false]);
  assert.deepEqual(r.excluded, [['n0','n1','n2']]);
  assert.equal(r.resolution?.status, 'ready');
  if (r.resolution?.status === 'ready' && r.resolution.intent.kind === 'assembly-apply') {
    assert.deepEqual(r.resolution.intent.sourceRefs, [0,1,2].map(i => ({ kind: 'artifactView', id: `view-${i}` })));
    assert.deepEqual(r.resolution.intent.targetRef, { kind: 'conversation', id: 'conversation' });
  } else assert.fail('Expected durable conversation context, not draft reference');
});
test('R3 direct release over unseen target does not create an unpreviewed mutation', () => {
  const f = fixture(); f.down(); f.move(20); f.up(150); assert.equal(f.check().commits, 0); assert.equal(f.check().cancels, 1);
});
for (const change of ['receiver', 'target', 'disable'] as const) test(`R3 ${change} changed at release rejects stale preview`, () => {
  const f = fixture(); f.down(); f.move(150); f.change(change === 'receiver' ? { conversationId: 'other' } : change === 'target' ? { targetId: 'other' } : { enabled: false }); f.up(150);
  assert.equal(f.check().commits, 0); assert.equal(f.check().cancels, 1);
});
for (const moment of ['move','release'] as const) test(`R3 deleted/rebound/moved source at ${moment} cancels rather than copying stale identity`, () => {
  const f = fixture(); f.down(); f.move(150); f.change({ current: false }); if (moment === 'move') f.move(160); else f.up(160);
  assert.equal(f.check().commits, 0); assert.equal(f.check().captured, 0); assert.equal(f.check().errors.length, 1);
});
for (const reason of ['escape','blur','unmount','hidden','pointercancel'] as const) test(`R3 ${reason} cancels only uncommitted right carry`, () => {
  const f = fixture(); f.down(); f.move(150); reason === 'pointercancel' ? f.router.handleCancel(f.event(150)) : f.router.cancelAll(); f.up(150);
  const r = f.check(); assert.equal(r.commits, 0); assert.equal(r.cancels, 1); assert.equal(r.captured, 0); assert.deepEqual(r.menus, [false]);
});
test('R3 leaving receiver for blank returns to tracking and cannot commit', () => {
  const f = fixture(); f.down(); f.move(150); f.move(50); f.up(50); assert.equal(f.check().commits, 0);
});
test('R3 chorded mouse buttons cancel without menu replay', () => {
  const f = fixture(); f.down(); f.move(150); f.router.handleMove(f.event(155, { buttons: 3 })); f.up(155); assert.equal(f.check().commits, 0); assert.deepEqual(f.check().menus, [false]);
});
test('R3 mixed selection containing unbound member cannot silently submit supported subset', () => {
  const f = fixture(2, true); f.down(); f.move(150); f.up(150);
  assert.equal(f.check().commits, 0); assert.equal(f.check().starts, 0); assert.equal(f.check().errors.length, 1);
  assert.equal(f.router.ownerOf(1), null);
});
for (const mode of ['lock','tool','touch','left','nonprimary','unbound'] as const) test(`R3 preserves other pointer owners: ${mode}`, () => {
  const f = fixture();
  if (mode === 'lock') (f.ctx as { interactivityLocked: boolean }).interactivityLocked = true;
  if (mode === 'tool') (f.ctx as { explicitToolActive: boolean }).explicitToolActive = true;
  if (mode === 'unbound') f.change({ bound: false });
  f.router.handleDown(f.event(0, mode === 'touch' ? { pointerType:'touch' } : mode === 'left' ? { button:0,buttons:1 } : mode === 'nonprimary' ? { isPrimary:false } : {}));
  assert.equal(f.router.ownerOf(1), null); assert.equal(f.check().menuBegins, 0);
});
test('R3 lock appearing during gesture stops the gesture without committing', () => {
  const f = fixture(); f.down(); f.move(150); (f.ctx as { interactivityLocked: boolean }).interactivityLocked = true; f.up(160); assert.equal(f.check().commits, 0);
});
