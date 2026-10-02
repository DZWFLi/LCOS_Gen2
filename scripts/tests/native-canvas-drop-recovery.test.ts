/** Execute real native-drop policy, resolver, router, geometry planner and Core SQLite.
 * The RF event/store transport in this file is isolated; it is NOT full-app E2E.
 * npx tsx --test scripts/tests/native-canvas-drop-recovery.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { restoreNodeDragPositions } from '../../huabu/apps/web/src/handler/nodeDragRecovery.ts';
import { createNativeCanvasDrop, type NativeCanvasDropSource } from '../../huabu/apps/web/src/lcos/drop/nativeCanvasDrop.ts';
import { canvasDragHandlers } from '../../huabu/apps/web/src/lcos-seam/nodeDragPolicy.ts';
import { snapshotCanvasDropNodes, planNativeCanvasLanding } from '../../huabu/apps/web/src/lcos/drop/nativeCanvasDropGeometry.ts';
import { resolveDropPointerTarget } from '../../huabu/apps/web/src/lcos/drop/dropPointerResolution.ts';
import { resolveDropIntent } from '../../huabu/apps/web/src/lcos/drop/dropIntentResolver.ts';
import { DropCommitRouter } from '../../huabu/apps/web/src/lcos/drop/dropCommitRouter.ts';
import { DropTargetRegistry } from '../../huabu/apps/web/src/lcos/drop/dropTargetRegistry.ts';
import { beginDrop, confirmDrop, type SemanticDropState } from '../../apps/web-gen2/src/interaction/semanticDropMachine.ts';
import { planNodeFramePlacement } from '../../huabu/packages/shared/src/canvas-engine/commands/planNodeFramePlacement.ts';
import setNodeGeometry from '../../huabu/packages/shared/src/canvas-engine/commands/setNodeGeometry.ts';
import setNodeParent from '../../huabu/packages/shared/src/canvas-engine/commands/setNodeParent.ts';
import { getAbsolutePosition } from '../../huabu/packages/shared/src/canvas-engine/container/tree.ts';
import { SqliteMetadataRepository } from '../../apps/local-core/src/metadata-repository.ts';
import { MutationSafetyService } from '../../apps/local-core/src/mutation-safety-service.ts';
import { PresentationApplicationService } from '../../apps/local-core/src/presentation-application-service.ts';
import { createMvpSampleSnapshot } from '../../apps/local-core/src/mvp-sample-project.ts';
import type { Node } from '@xyflow/react';
import type { DropPayload, DropResolution, DropTargetRegistration, DropCollectionMembershipIntent } from '../../huabu/apps/web/src/lcos/drop/dropTypes.ts';

const collection: DropTargetRegistration = { targetId: 'collection:c', nodeId: 'folder', kind: 'collection-membership',
  label: '参考集', rect: { left: 400, top: 100, width: 200, height: 400 }, priority: 30, enabled: true,
  semantic: { kind: 'collection-membership', collectionId: 'c' } };
const targetFor = (kind: 'composer-reference' | 'collaboration-reference' | 'portal-receive' | 'canvas'): DropTargetRegistration => ({
  ...collection, kind, targetId: kind, nodeId: undefined,
  semantic: kind === 'composer-reference' ? { kind } : kind === 'collaboration-reference' ? { kind, conversationId: 'conversation' }
    : kind === 'portal-receive' ? { kind, targetRef: { kind: 'workspace', id: 'remote' }, destinationRef:{kind:'worksite',projectId:'p',worksiteId:'remote'},canvasId:'remote-canvas' }
    : { kind, targetRef: { kind: 'workspace', id: 'remote' } },
});
const dataNodes = (): Node[] => [
  { id: 'a-node', type: 'note', data: {}, position: { x: 20, y: 40 }, width: 120, height: 90 },
  { id: 'b-node', type: 'note', data: {}, position: { x: 180, y: 40 }, width: 120, height: 90 },
  { id: 'frame', type: 'frame', data: { lcosCollectionId: 'c' }, position: { x: 400, y: 100 }, width: 240, height: 300 },
];
const dataRefs = () => new Map(['a', 'b'].map((id) => [`${id}-node`, { entityType: 'artifact', entityId: id, descriptor: { artifactViewId: `${id}-old` } }]));
const mouse = (x = 450, y = 150) => ({ clientX: x, clientY: y } as MouseEvent);
function harness() {
  let nodes = dataNodes();
  const refs = dataRefs();
  let scope = { projectId: 'p', canvasId: 'canvas' };
  let state: SemanticDropState = { status: 'idle' };
  let resolution: DropResolution | null = null;
  let witness: NativeCanvasDropSource | undefined;
  let startNodes: Node[] = [];
  let target: DropTargetRegistration | undefined = collection;
  let expanded = true;
  let saves = 0, nativePreviews = 0, rollbacks = 0, commits = 0, held = 0;
  let submitted: NativeCanvasDropSource | undefined;
  let rejects: string[] = [];
  const events = new EventTarget();
  const policy = createNativeCanvasDrop({
    scope: () => scope,
    snapshot: (ns) => snapshotCanvasDropNodes(ns.map((node) => node.id), nodes, refs),
    read: () => ({ state, resolution }),
    begin: (payload, source) => { witness = source; state = beginDrop(payload); resolution = null; },
    advance: (point) => {
      if (!('payload' in state) || state.status === 'committing') return;
      const resolved = resolveDropPointerTarget(state.payload, point.clientX >= 400 ? target : undefined,
        { native: true, rightCarry: false, blockedReason: witness?.blockedReason });
      resolution = resolved.resolution ?? null;
      state = resolved.target ? { status: 'preview', payload: state.payload,
        destination: { targetId: resolved.target.targetId, previewPoint: { x: point.clientX, y: point.clientY } }, carryAnchor: 'left' }
        : beginDrop(state.payload);
    },
    cancelDrop: () => { state = { status: 'idle' }; resolution = null; },
    commit: (source) => { submitted = source; commits++; state = confirmDrop(state, 'tx', { kind: 'collection-membership', targetId: collection.targetId }); return state.status === 'committing'; },
    cancelDrag: () => { rollbacks++; nodes = nodes.map((node) => {
      const original = startNodes.find((item) => item.id === node.id); return original ? { ...node, position: { ...original.position }, dragging: false } : node;
    }); },
    clearNativePreview: () => {}, markSources: () => {}, clearSourceMarks: () => {},
    visibleCollectionFrame: () => expanded ? { frameId: 'frame', position: { x: 400, y: 100 } } : undefined,
    holdLanding: (source) => { if (source.landing) held++; }, clearLanding: () => { held = 0; },
    reject: (message) => { rejects.push(message); },
  }, events);
  const handlers = canvasDragHandlers({
    onNodeDragStart: () => { startNodes = structuredClone(nodes); },
    onNodeDrag: () => { nativePreviews++; },
    onNodeDragStop: () => { saves++; },
    onNodesChange: (changes) => { for (const c of changes) if (c.type === 'position') nodes = nodes.map((node) =>
      node.id === c.id ? { ...node, ...(c.position ? { position: c.position } : {}), ...(c.dragging === undefined ? {} : { dragging: c.dragging }) } : node); },
  }, policy);
  const selected = () => nodes.filter((node) => ['a-node', 'b-node'].includes(node.id));
  return {
    refs, handlers, policy,
    start(event: MouseEvent | TouchEvent = mouse(20, 40)) { handlers.onNodeDragStart(event, nodes[0]!, selected()); },
    move(point = mouse()) {
      handlers.onNodesChange(selected().map((node, index) => ({ type: 'position', id: node.id, position: { x: point.clientX + index * 160, y: point.clientY }, dragging: true })));
      handlers.onNodeDrag(point, nodes[0]!, selected());
    },
    stop(point = mouse()) { handlers.onNodeDragStop(point, nodes[0]!, selected()); },
    interrupt(type: string) { const e = new Event(type, { cancelable: true }); Object.assign(e, { key: 'Escape' }); events.dispatchEvent(e); },
    setTarget(next?: DropTargetRegistration) { target = next; },
    setScope(next: typeof scope) { scope = next; },
    setExpanded(next: boolean) { expanded = next; },
    mutate(fn: (nodes: Node[]) => void) { fn(nodes); },
    get result() { return { nodes, state, resolution, submitted, saves, nativePreviews, rollbacks, commits, held, rejects }; },
  };
}

test('native blank left drag remains native Move: one native save, no Core request', () => {
  const h = harness(); h.start(); h.move(mouse(250, 250)); h.stop(mouse(250, 250));
  assert.equal(h.result.saves, 1); assert.equal(h.result.commits, 0); assert.equal(h.result.rollbacks, 0);
  assert.equal(h.result.nodes[0]!.position.x, 250); h.policy.dispose();
});
test('actual native canvas candidate is excluded from semantic apply for left Move', () => {
  const h = harness(); h.setTarget(targetFor('canvas')); h.start(); h.move(); h.stop();
  assert.equal(h.result.saves, 1); assert.equal(h.result.commits, 0); h.policy.dispose();
});
test('visible Collection release rolls back trial before commit and holds group landing', () => {
  const h = harness(); h.start(); h.move(); h.stop();
  assert.equal(h.result.nativePreviews, 0); assert.equal(h.result.saves, 0); assert.equal(h.result.commits, 1);
  assert.equal(h.result.rollbacks, 1); assert.equal(h.result.held, 1);
  assert.deepEqual(h.result.nodes[0]!.position, { x: 20, y: 40 });
  assert.deepEqual(h.result.submitted!.landing!.nodes[0]!.absolutePosition, { x: 450, y: 150 });
  assert.equal(h.result.submitted!.nodes.length, 2); h.policy.dispose();
});
for (const kind of ['composer-reference', 'collaboration-reference', 'portal-receive'] as const) test(`${kind} uses canonical/draft target, keeps source positions`, () => {
  const h = harness(); h.setTarget(targetFor(kind)); h.start(); h.move(); h.stop();
  assert.equal(h.result.commits, 1); assert.equal(h.result.held, 0); assert.equal(h.result.saves, 0);
  assert.deepEqual(h.result.nodes[0]!.position, { x: 20, y: 40 }); h.policy.dispose();
});
test('collapsed Collection does not auto-open or acquire a Frame', () => {
  const h = harness(); h.setExpanded(false); h.start(); h.move(); h.stop();
  assert.equal(h.result.commits, 1); assert.equal(h.result.held, 0); assert.equal(h.result.submitted!.landing, undefined); h.policy.dispose();
});
for (const end of ['keydown', 'blur', 'pointercancel'] as const) test(`${end} rolls back and ignores RF's subsequent movement/stop ticks`, () => {
  const h = harness(); h.start(); h.move(); h.interrupt(end); h.move(mouse(600, 250)); h.stop();
  assert.equal(h.result.commits, 0); assert.equal(h.result.saves, 0); assert.equal(h.result.rollbacks, 1);
  assert.deepEqual(h.result.nodes[0]!.position, { x: 20, y: 40 }); h.policy.dispose();
});
test('new native drag after cancelled gesture is not permanently blocked', () => {
  const h = harness(); h.start(); h.move(); h.interrupt('keydown'); h.stop();
  h.start(); h.move(mouse(200, 300)); h.stop(mouse(200, 300)); assert.equal(h.result.saves, 1); h.policy.dispose();
});
for (const reason of ['missing', 'disabled', 'retargeted', 'outside', 'source-id', 'source-parent'] as const) test(`${reason} at release cannot become an unpreviewed semantic write or native reparent`, () => {
  const h = harness(); h.start(); h.move();
  if (reason === 'missing') h.setTarget();
  if (reason === 'disabled') h.setTarget({ ...collection, enabled: false });
  if (reason === 'retargeted') h.setTarget({ ...collection, semantic: { kind: 'collection-membership', collectionId: 'other' } });
  if (reason === 'source-id') h.refs.set('a-node', { entityType: 'artifact', entityId: 'other', descriptor: { artifactViewId: 'other' } });
  if (reason === 'source-parent') h.mutate((nodes) => { nodes[0]!.parentId = 'frame'; });
  h.stop(reason === 'outside' ? mouse(20, 40) : mouse());
  assert.equal(h.result.commits, 0); assert.equal(h.result.saves, 0); h.policy.dispose();
});
test('a receiver first appearing on mouse-up is not consent; source rolls back', () => {
  const h = harness(); h.start(); h.move(mouse(100, 300)); h.stop();
  assert.equal(h.result.commits, 0); assert.equal(h.result.saves, 0); assert.equal(h.result.rollbacks, 1); h.policy.dispose();
});
test('mixed bound/unbound selection rejects as a whole', () => {
  const h = harness(); h.refs.delete('b-node'); h.start(); h.move();
  assert.equal(h.result.resolution?.status, 'ineligible'); h.stop(); assert.equal(h.result.commits, 0); h.policy.dispose();
});
test('switching canvas before release never restores old geometry into the new canvas', () => {
  const h = harness(); h.start(); h.move(); h.setScope({ projectId: 'p', canvasId: 'other' }); h.stop();
  assert.equal(h.result.rollbacks, 0); assert.equal(h.result.commits, 0); assert.equal(h.result.saves, 0); h.stop(); assert.equal(h.result.saves, 0); h.policy.dispose();
});
test('native touch owner is not intercepted', () => {
  const h = harness(); const touch = {} as TouchEvent; h.start(touch); h.handlers.onNodeDrag(touch, h.result.nodes[0]!, h.result.nodes); h.stop(touch as MouseEvent);
  assert.equal(h.result.nativePreviews, 1); assert.equal(h.result.saves, 1); assert.equal(h.result.commits, 0); h.policy.dispose();
});
test('dispose cancels uncommitted trial and removes interruption listeners', () => {
  const h = harness(); h.start(); h.move(); h.policy.dispose(); h.interrupt('blur');
  assert.equal(h.result.rollbacks, 1); assert.equal(h.result.commits, 0);
});
test('without host policy, native callbacks are unchanged', () => {
  const calls: string[] = [];
  const h = canvasDragHandlers({ onNodeDragStart: () => calls.push('start'), onNodeDrag: () => calls.push('move'),
    onNodeDragStop: () => calls.push('stop'), onNodesChange: () => calls.push('change') });
  h.onNodeDragStart(mouse(), dataNodes()[0]!, dataNodes()); h.onNodesChange([]); h.onNodeDrag(mouse(), dataNodes()[0]!, dataNodes()); h.onNodeDragStop(mouse(), dataNodes()[0]!, dataNodes());
  assert.deepEqual(calls, ['start', 'change', 'move', 'stop']);
});
test('self-hit excludes dragged nodes, but not another real receiver', () => {
  const registry = new DropTargetRegistry(); registry.register({ ...collection, nodeId: 'a-node' });
  assert.equal(registry.hitTest({ x: 450, y: 150 }, new Set(['a-node'])), undefined);
  registry.register({ ...collection, targetId: 'other', nodeId: 'b-node', priority: 20 });
  assert.equal(registry.hitTest({ x: 450, y: 150 }, new Set(['a-node']))?.targetId, 'other');
});

const objects: DropPayload = { kind: 'objects', objects: [{ entityType: 'artifact', entityId: 'a', artifactViewId: 'a-old' }, { entityType: 'artifact', entityId: 'b', artifactViewId: 'b-old' }, { entityType: 'artifact', entityId: 'a', artifactViewId: 'a-old' }] };
function membership(): DropCollectionMembershipIntent {
  const r = resolveDropIntent(objects, collection); if (r.status !== 'ready' || r.intent.kind !== 'collection-membership') throw Error('expected membership'); return r.intent;
}
test('batch keeps canonical Collection identity but exact per-turn historical View refs', () => {
  assert.deepEqual(membership().memberRefs, [{ type: 'artifact', id: 'a' }, { type: 'artifact', id: 'b' }]);
  const r = resolveDropIntent(objects, targetFor('composer-reference'));
  assert.equal(r.status, 'ready'); if (r.status !== 'ready' || r.intent.kind !== 'composer-reference') throw Error();
  assert.deepEqual(r.intent.references, [{ entityType: 'artifactView', entityId: 'a-old' }, { entityType: 'artifactView', entityId: 'b-old' }]);
});
test('batch Glyth context uses exact ordered source views with no duplicates', () => {
  const r = resolveDropIntent(objects, targetFor('collaboration-reference'));
  assert.equal(r.status, 'ready'); if (r.status !== 'ready' || r.intent.kind !== 'assembly-apply') throw Error();
  assert.deepEqual(r.intent.sourceRefs, [{ kind: 'artifactView', id: 'a-old' }, { kind: 'artifactView', id: 'b-old' }]);
});
test('an unsupported batch source refuses all rather than silently dropping it', () => {
  const r = resolveDropIntent({ kind: 'objects', objects: [{ entityType: 'artifact', entityId: 'a', artifactViewId: 'a-old' }, { entityType: 'run', entityId: 'run' }] }, targetFor('collaboration-reference'));
  assert.equal(r.status, 'ineligible');
});
test('batch router returns per-item success/failure, preserving canonical successes', async () => {
  const calls: string[] = [];
  const router = new DropCommitRouter();
  const owners = { applyAssembly: async () => { throw Error('wrong owner'); }, addComposerReference: () => {},
    addCollectionMember: async (intent: DropCollectionMembershipIntent) => { calls.push(intent.memberRef.id); if (intent.memberRef.id === 'b') throw Error('rejected'); return { collectionId: 'c', memberRef: intent.memberRef, status: 'applied' as const }; } };
  const [a, b] = await Promise.all([router.commit(membership(), 'tx', owners), router.commit(membership(), 'tx', owners)]);
  assert.deepEqual(calls, ['a', 'b']); assert.equal(a, b); assert.equal(a.status, 'partial');
  assert.deepEqual(a.collectionItems?.map((item) => item.status), ['success', 'failed']);
});
function landingFixture() {
  const nodes = dataNodes(), refs = dataRefs();
  const scope = { projectId: 'p', canvasId: 'canvas' };
  const original = snapshotCanvasDropNodes(['a-node', 'b-node'], nodes, refs);
  const releaseNodes = nodes.map((node) => node.type === 'frame' ? node : { ...node, position: { x: node.position.x + 430, y: node.position.y + 120 } });
  const source: NativeCanvasDropSource = { scope, nodes: original, landing: { collectionId: 'c', frameId: 'frame', framePosition: { x: 400, y: 100 }, nodes: snapshotCanvasDropNodes(['a-node', 'b-node'], releaseNodes, refs) } };
  const receipt = { status: 'success' as const, transactionId: 'tx', targetId: collection.targetId, collectionItems: membership().memberRefs!.map((memberRef) => ({ memberRef, status: 'success' as const, canonicalReceipt: { collectionId: 'c', memberRef, status: 'applied' } })) };
  return { nodes, refs, scope, source, receipt };
}
test('native command planner keeps release WORLD positions through one group reparent', () => {
  const f = landingFixture(); const before = JSON.stringify(f.nodes);
  const plan = planNativeCanvasLanding(f.source, membership(), f.receipt, f.scope, f.nodes, f.refs, new Set());
  const state = { nodes: f.nodes, edges: [], canvasId: 'canvas', source: 'ui' as const };
  const commands = planNodeFramePlacement(state, plan.items, 'frame'); assert(commands);
  assert.equal(commands.length, 2); assert.equal(JSON.stringify(f.nodes), before);
  const g = setNodeGeometry.handler(commands[0] as Parameters<typeof setNodeGeometry.handler>[0], state);
  const p = setNodeParent.handler(commands[1] as Parameters<typeof setNodeParent.handler>[0], { ...state, nodes: g.nodes });
  assert(p.applied); assert.deepEqual(getAbsolutePosition(p.nodes, 'a-node'), { x: 450, y: 160 });
  assert.deepEqual(getAbsolutePosition(p.nodes, 'b-node'), { x: 610, y: 160 });
  assert.equal(p.nodes.find((node) => node.id === 'a-node')?.parentId, 'frame');
});
for (const drift of ['source-move', 'source-parent', 'source-id', 'target-move', 'target-id', 'target-collapse', 'target-hidden', 'target-locked', 'canvas-switch'] as const) test(`late ${drift} revokes spatial placement, not canonical truth`, () => {
  const f = landingFixture();
  if (drift === 'source-move') f.nodes[0]!.position.x++;
  if (drift === 'source-parent') f.nodes[0]!.parentId = 'frame';
  if (drift === 'source-id') f.refs.set('a-node', { entityType: 'artifact', entityId: 'other', descriptor: { artifactViewId: 'other' } });
  if (drift === 'target-move') f.nodes[2]!.position.x++;
  if (drift === 'target-id') f.nodes[2]!.data.lcosCollectionId = 'other';
  if (drift === 'target-hidden') f.nodes[2]!.hidden = true;
  if (drift === 'target-locked') f.nodes[2]!.data.locked = true;
  const plan = planNativeCanvasLanding(f.source, membership(), f.receipt,
    drift === 'canvas-switch' ? { ...f.scope, canvasId: 'other' } : f.scope, f.nodes, f.refs, new Set(drift === 'target-collapse' ? ['frame'] : []));
  assert.equal(plan.skipped, true); assert(!plan.items.some((item) => item.nodeId === 'a-node')); assert.equal(f.receipt.status, 'success');
});
test('partial group receipt only places positively confirmed members', () => {
  const f = landingFixture(); f.receipt.collectionItems[1]!.canonicalReceipt.status = 'not-member';
  const plan = planNativeCanvasLanding(f.source, membership(), f.receipt, f.scope, f.nodes, f.refs, new Set());
  assert.deepEqual(plan.items.map((item) => item.nodeId), ['a-node']);
});
for (const invalid of ['missing-source', 'locked-source', 'locked-frame', 'nonfinite', 'cycle'] as const) test(`native command planner rejects ${invalid} before ANY geometry write`, () => {
  const nodes = dataNodes(); const items = [{ nodeId: 'a-node', position: { x: 500, y: 100 } }];
  if (invalid === 'missing-source') items[0]!.nodeId = 'missing';
  if (invalid === 'locked-source') nodes[0]!.data.locked = true;
  if (invalid === 'locked-frame') nodes[2]!.data.locked = true;
  if (invalid === 'nonfinite') items[0]!.position.x = NaN;
  if (invalid === 'cycle') { nodes[0]!.type = 'frame'; nodes[2]!.parentId = 'a-node'; }
  const before = JSON.stringify(nodes);
  assert.equal(planNodeFramePlacement({ nodes, edges: [], canvasId: 'canvas', source: 'ui' }, items, 'frame'), undefined);
  assert.equal(JSON.stringify(nodes), before);
});
test('REAL SQLite: two-object native group -> canonical members -> close/reopen', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-native-group-'));
  const file = join(dir, 'core.sqlite'); let repo = new SqliteMetadataRepository(file);
  try {
    const graph = createMvpSampleSnapshot(join(dir, 'project'), '2026-09-30T00:00:00.000Z'); repo.save(graph);
    const projectId = String(graph.project.id);
    const service = new MutationSafetyService(repo, new PresentationApplicationService(repo, repo));
    const identity = service.createCollection({ projectId, title: 'Native group' }).collection;
    const selected = graph.artifacts.slice(0, 2);
    assert.equal(selected.length, 2);
    const resolved = resolveDropIntent({ kind: 'objects', objects: selected.map((artifact) => ({ entityType: 'artifact', entityId: String(artifact.id) })) },
      { ...collection, semantic: { kind: 'collection-membership', collectionId: String(identity.id) } });
    assert.equal(resolved.status, 'ready'); if (resolved.status !== 'ready') throw Error();
    const receipt = await new DropCommitRouter().commit(resolved.intent, 'sqlite-native', { applyAssembly: async () => { throw Error(); }, addComposerReference: () => {},
      addCollectionMember: async (intent) => service.addCollectionMember({ projectId, collectionId: intent.collectionId, memberRef: intent.memberRef }) });
    assert.equal(receipt.status, 'success'); assert.equal(receipt.collectionItems?.length, 2);
    repo.close(); repo = new SqliteMetadataRepository(file);
    assert.equal(repo.listCollectionMemberships(projectId, String(identity.id)).length, 2);
    assert.equal(repo.foreignKeyCheck().length, 0);
  } finally { repo.close(); await rm(dir, { recursive: true, force: true }); }
});

for (const reason of ['parent-changed', 'identity-changed'] as const) test(`native cancel does not overwrite ${reason} geometry`, () => {
  const nodes = dataNodes(); const origins = new Map([['a-node', { x: 20, y: 40 }]]);
  nodes[0]!.position = { x: 7, y: 9 }; nodes[0]!.dragging = true;
  if (reason === 'parent-changed') nodes[0]!.parentId = 'frame';
  const restored = restoreNodeDragPositions(nodes, origins, reason === 'identity-changed' ? ['a-node'] : []);
  assert.deepEqual(restored[0]!.position, { x: 7, y: 9 }); assert.equal(restored[0]!.dragging, false);
});
test('native cancel restores a child in its unchanged parent coordinates', () => {
  const nodes = dataNodes(); nodes[0]!.parentId = 'frame'; nodes[0]!.position = { x: 77, y: 88 };
  const restored = restoreNodeDragPositions(nodes, new Map([['a-node', { x: 20, y: 40, parentId: 'frame' }]]));
  assert.deepEqual(restored[0]!.position, { x: 20, y: 40 }); assert.equal(restored[0]!.parentId, 'frame');
});

test('a selected Collection cannot be offered as a member of itself', () => {
  const r = resolveDropIntent({ kind: 'objects', objects: [{ entityType: 'collection', entityId: 'c' }, { entityType: 'artifact', entityId: 'a' }] }, collection);
  assert.equal(r.status, 'ineligible');
});


test('an autosave during native drag can serialize origin geometry without moving the live bodies', () => {
  const nodes = dataNodes(); const original = new Map([['a-node', { x: 20, y: 40 }]]);
  nodes[0]!.position = { x: 500, y: 300 }; nodes[0]!.dragging = true;
  const forSave = restoreNodeDragPositions(nodes, original);
  assert.deepEqual(forSave[0]!.position, { x: 20, y: 40 });
  assert.deepEqual(nodes[0]!.position, { x: 500, y: 300 });
  assert.equal(nodes[0]!.dragging, true);
  assert.equal(forSave[1], nodes[1]);
});
