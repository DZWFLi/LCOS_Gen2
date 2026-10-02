/** Regression tests for the real helpers/owner router, with a real SQLite membership round trip.
 * Run with the installed workspace dependencies: npx tsx --test scripts/tests/g1-interaction-recovery.test.ts
 * Browser transport is also exercised separately; these tests are not a full React app E2E.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { layoutCollectionMembers, collectionExpansionGeometry } from '../../huabu/apps/web/src/lcos/nodes/collectionExpandLayout.ts';
import { captureCollectionDropPlacement, planCollectionDropPlacement } from '../../huabu/apps/web/src/lcos/drop/collectionDropPlacement.ts';
import { DropCommitRouter } from '../../huabu/apps/web/src/lcos/drop/dropCommitRouter.ts';
import { resolveDropIntent } from '../../huabu/apps/web/src/lcos/drop/dropIntentResolver.ts';
import { DropTargetRegistry } from '../../huabu/apps/web/src/lcos/drop/dropTargetRegistry.ts';
import { assemblyDropReceipt } from '../../huabu/apps/web/src/lcos/drop/dropAssemblyReceipt.ts';
import { canCommitDropRelease } from '../../huabu/apps/web/src/lcos/drop/dropReleaseConsistency.ts';
import { bindNativeAssemblyDropEvents, ASSEMBLY_DRAG_MIME } from '../../huabu/apps/web/src/lcos/drop/nativeAssemblyDrop.ts';
import { beginDrop, confirmDrop } from '../../apps/web-gen2/src/interaction/semanticDropMachine.ts';
import { SqliteMetadataRepository } from '../../apps/local-core/src/metadata-repository.ts';
import { MutationSafetyService } from '../../apps/local-core/src/mutation-safety-service.ts';
import { PresentationApplicationService } from '../../apps/local-core/src/presentation-application-service.ts';
import { createMvpSampleSnapshot } from '../../apps/local-core/src/mvp-sample-project.ts';
import type { Node } from '@xyflow/react';
import type { DropPayload, SemanticDropState } from '../../apps/web-gen2/src/interaction/semanticDropMachine.ts';
import type { DropCollectionMembershipIntent, DropIntent, DropResolution, DropTargetRegistration } from '../../huabu/apps/web/src/lcos/drop/dropTypes.ts';
import type { CoreCollectionMembershipReceipt } from '../../apps/web-gen2/src/backend/collections.ts';

const container = { id: 'collection', x: 100, y: 100, width: 248, height: 244 };
const members = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `n${i}`, x: 0, y: 100 + i, width: 200, height: 160 }));
for (const [count, expected] of [[9, [5, 4]], [10, [3, 3, 2, 2]], [20, [4, 4, 4, 4, 4]], [30, [6, 6, 6, 6, 6]]] as const) {
  test(`G1 layout: ${count} members use balanced columns without a long final column`, () => {
    const result = layoutCollectionMembers(container, members(count), []);
    const columns = new Map<number, number>();
    for (const item of result) columns.set(item.position!.x, (columns.get(item.position!.x) ?? 0) + 1);
    assert.deepEqual([...columns.values()], expected);
    assert.equal(new Set(result.map((item) => item.nodeId)).size, count);
  });
}
test('small Collection retains its measured-size fan-out and obstacle clearance', () => {
  const result = layoutCollectionMembers(container, [
    { id: 'a', x: 0, y: 100, width: 280, height: 180 },
    { id: 'b', x: 0, y: 100, width: 180, height: 100 },
  ], [{ id: 'o', x: 390, y: 90, width: 300, height: 220 }]);
  assert.deepEqual(result.map((item) => item.position), [{ x: 390, y: 352 }, { x: 390, y: 556 }]);
});
test('large Collection avoids obstacles as a whole, including when all preferred positions are blocked', () => {
  const obstacles = [{ id: 'wall', x: -10_000, y: -10_000, width: 20_000, height: 20_000 }];
  const result = layoutCollectionMembers(container, members(30), obstacles);
  assert(result.every((item) => item.position!.y >= 10020));
  assert.equal(new Set(result.map((item) => item.position!.x)).size, 5);
});
test('large Collection respects heterogeneous real sizes and does not mutate its inputs', () => {
  const items = members(30).map((item, i) => ({ ...item, width: 90 + (i % 7) * 73, height: 80 + (i % 4) * 65 }));
  const before = JSON.stringify(items);
  const result = layoutCollectionMembers(container, items, []);
  const laidOut = result.map((row) => ({ ...items.find((item) => item.id === row.nodeId)!, ...row.position! }));
  for (let i = 0; i < laidOut.length; i++) for (let j = i + 1; j < laidOut.length; j++) {
    const a = laidOut[i]!, b = laidOut[j]!;
    assert(!(a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y));
  }
  assert.equal(JSON.stringify(items), before);
});
const nodes = (): Node[] => [
  { id: 'folder', type: 'note', position: { x: 1000, y: 1000 }, width: 248, height: 244, data: {} },
  { id: 'frame', type: 'frame', position: { x: 1290, y: 1000 }, width: 900, height: 1000,
    data: { lcosCollectionId: 'c1', lcosCollectionNodeId: 'folder' } },
  { id: 'child', type: 'note', parentId: 'frame', position: { x: 0, y: 0 }, width: 200, height: 160, data: {} },
  { id: 'source', type: 'note', position: { x: 100, y: 100 }, width: 200, height: 160, data: {} },
];
test('adding to an expanded Collection uses child WORLD coordinates, not parent-relative obstacles', () => {
  const input = nodes();
  const before = JSON.stringify(input);
  const result = collectionExpansionGeometry(input, 'folder', ['source'], ['child']);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.position!.x, 1290);
  assert(result[0]!.position!.y >= 1180 && result[0]!.position!.y < 1300);
  assert.equal(JSON.stringify(input), before);
});
test('right carry has no spatial manifestation even when the destination Frame is expanded', () => {
  const input = nodes();
  assert.equal(captureCollectionDropPlacement(input, new Set(), 'c1', 'source', true), undefined);
});
test('a matching Assembly addition can be hosted after its receipt without stealing another Frame child', () => {
  const input = nodes();
  const source = captureCollectionDropPlacement(input, new Set(), 'c1', 'source', false);
  assert(source);
  const plan = planCollectionDropPlacement(source, input, new Set(), 'c1');
  assert.equal(plan?.memberNodeId, 'source');
  assert.equal(plan?.frameId, 'frame');
  assert.equal(captureCollectionDropPlacement(input, new Set(), 'c1', 'child', false), undefined);
});
for (const reason of ['moved', 'reparented', 'dragging', 'collapsed', 'removed', 'identity-changed'] as const) {
  test(`late Collection receipt cannot take over a source/destination that was ${reason}`, () => {
    const input = nodes();
    const source = captureCollectionDropPlacement(input, new Set(), 'c1', 'source', false);
    if (reason === 'moved') input[3]!.position.x += 1;
    if (reason === 'reparented') input[3]!.parentId = 'other-frame';
    if (reason === 'dragging') input[3]!.dragging = true;
    if (reason === 'removed') input.pop();
    if (reason === 'identity-changed') input[1]!.data.lcosCollectionId = 'other-collection';
    assert.equal(planCollectionDropPlacement(source, input, new Set(reason === 'collapsed' ? ['frame'] : []), 'c1'), undefined);
  });
}
const canvas: DropTargetRegistration = { targetId: 'canvas', kind: 'canvas', label: 'Canvas', rect: { left: 0, top: 0, width: 1000, height: 800 }, priority: 1, enabled: true, semantic: { kind: 'canvas', targetRef: { kind: 'main' } } };
const collection: DropTargetRegistration = { ...canvas, targetId: 'collection', kind: 'collection-membership', label: '集合', priority: 30, semantic: { kind: 'collection-membership', collectionId: 'c1' } };
const assembly: DropPayload = { kind: 'assembly', itemId: 'a1', sourceRef: { kind: 'artifactView', id: 'view-old' }, entityRef: { type: 'artifact', id: 'a1' } };
test('Assembly uses canonical Artifact membership but retains exact View identity for apply/composer', () => {
  const resolved = resolveDropIntent(assembly, collection);
  assert.equal(resolved.status, 'ready');
  if (resolved.status !== 'ready') throw new Error('Expected a ready collection');
  assert.deepEqual(resolved.intent, { kind: 'collection-membership', targetId: 'collection', collectionId: 'c1', memberRef: { type: 'artifact', id: 'a1' } });
  assert.deepEqual((resolveDropIntent(assembly, canvas) as Extract<DropResolution, { status: 'ready' }>).intent,
    { kind: 'assembly-apply', targetId: 'canvas', targetRef: { kind: 'main' }, sourceRefs: [{ kind: 'artifactView', id: 'view-old' }] });
  const composer = resolveDropIntent(assembly, { ...canvas, semantic: { kind: 'composer-reference' } });
  assert.equal(composer.status, 'ready');
  if (composer.status === 'ready' && composer.intent.kind === 'composer-reference') assert.equal(composer.intent.reference.entityId, 'view-old');
});
test('an ArtifactView without canonical entity evidence is NOT guessed into an Artifact', () => {
  assert.equal(resolveDropIntent({ kind: 'assembly', itemId: 'a1', sourceRef: { kind: 'artifactView', id: 'view-old' } }, collection).status, 'ineligible');
  assert.equal(resolveDropIntent({ ...assembly, entityRef: { type: 'artifact', id: '' } }, collection).status, 'ineligible');
});
test('disabled receiver blocks background fallback and supplies the actual rejection reason', () => {
  const registry = new DropTargetRegistry();
  registry.register(canvas);
  registry.register({ ...collection, enabled: false, ineligibleReason: '目标尚未就绪' });
  const target = registry.hitTest({ x: 10, y: 10 })!;
  assert.equal(target.targetId, 'collection');
  assert.deepEqual(resolveDropIntent(assembly, target), { status: 'ineligible', targetId: 'collection', reason: '目标尚未就绪' });
});
test('zero-size/invalid live rects are not receivers, and hit tests respect real occlusion', () => {
  const registry = new DropTargetRegistry();
  registry.register({ ...collection, rect: { left: 0, top: 0, width: 0, height: 0 } });
  assert.equal(registry.hitTest({ x: 0, y: 0 }), undefined);
  registry.register({ ...collection, rect: { left: NaN, top: 0, width: 10, height: 10 } });
  assert.equal(registry.hitTest({ x: 0, y: 0 }), undefined);
  registry.register({ ...collection, acceptsPoint: () => false });
  assert.equal(registry.hitTest({ x: 10, y: 10 }), undefined);
});
test('older target cleanup cannot delete a newer registration with the same identity', () => {
  const registry = new DropTargetRegistry();
  const dispose = registry.register(collection);
  const disposeNew = registry.register({ ...collection, label: 'replacement' });
  dispose();
  assert.equal(registry.get('collection')?.label, 'replacement');
  disposeNew();
  assert.equal(registry.get('collection'), undefined);
});
const intent: DropCollectionMembershipIntent = { kind: 'collection-membership', targetId: 'collection', collectionId: 'c1', memberRef: { type: 'artifact', id: 'a1' } };
const positive: CoreCollectionMembershipReceipt = { status: 'applied', collectionId: 'c1', memberRef: intent.memberRef };
for (const bad of [
  { ...positive, collectionId: 'wrong' },
  { ...positive, memberRef: { type: 'artifact' as const, id: 'wrong' } },
  { ...positive, status: 'removed' as const },
  { ...positive, status: 'not-member' as const },
]) {
  test(`negative/mismatched Core receipt cannot run geometry: ${JSON.stringify(bad)}`, async () => {
    let placements = 0;
    const result = await new DropCommitRouter().commit(intent, 't1', {
      applyAssembly: async () => { throw new Error('wrong owner'); }, addComposerReference: () => { throw new Error('wrong owner'); },
      addCollectionMember: async () => bad, onCollectionApplied: () => { placements++; },
    });
    assert.equal(result.status, 'failed');
    assert.equal(placements, 0);
  });
}
test('spatial failure after a positive receipt stays a saved membership, with no mutation retry', async () => {
  let writes = 0;
  const router = new DropCommitRouter();
  const owners = {
    applyAssembly: async () => { throw new Error('wrong owner'); }, addComposerReference: () => {},
    addCollectionMember: async () => { writes++; return positive; },
    onCollectionApplied: () => { throw new Error('Frame unavailable'); },
  };
  const [first, second] = await Promise.all([router.commit(intent, 'one', owners), router.commit(intent, 'one', owners)]);
  assert.equal(first, second);
  assert.equal(writes, 1);
  assert.equal(first.status, 'partial');
  assert.match(first.message!, /已保存/);
  assert.equal(first.canonicalReceipt, positive);
  assert.equal(first.retrySourceRefs, undefined);
});
test('applied + already-member is success, already-member + failed is partial', () => {
  const refs = [{ kind: 'note', id: 'a' }, { kind: 'note', id: 'b' }] as const;
  const applyIntent = { kind: 'assembly-apply', targetId: 'canvas', targetRef: { kind: 'main' }, sourceRefs: refs } as const;
  const already = { sourceRef: refs[1], status: 'skipped', channel: 'already-member' } as const;
  const succeeded = assemblyDropReceipt(applyIntent, 't', { schemaVersion: 1, projectId: 'p', allApplied: false,
    results: [{ sourceRef: refs[0], status: 'applied', channel: 'presentation-membership' }, already] }, 'p');
  assert.equal(succeeded.status, 'success');
  const partial = assemblyDropReceipt(applyIntent, 't', { schemaVersion: 1, projectId: 'p', allApplied: true,
    results: [{ sourceRef: refs[0], status: 'failed', channel: 'error' }, already] }, 'p');
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.retrySourceRefs, [refs[0]]);
});

function preview(intent: DropIntent, payload: DropPayload = assembly) {
  return {
    state: { status: 'preview', payload, destination: { targetId: intent.targetId, previewPoint: { x: 150, y: 150 } }, carryAnchor: 'left' } as SemanticDropState,
    resolution: { status: 'ready', intent } as DropResolution,
  };
}
test('release cannot swap a Portal receiver behind a stable DOM target id', () => {
  const before = preview({ kind: 'assembly-apply', targetId: 'portal:one', targetRef: { kind: 'workspace', id: 'ws-original' }, sourceRefs: [assembly.sourceRef] });
  const after = preview({ kind: 'assembly-apply', targetId: 'portal:one', targetRef: { kind: 'workspace', id: 'ws-changed' }, sourceRefs: [assembly.sourceRef] });
  assert.equal(canCommitDropRelease(before, after), false);
});
test('release cannot swap a Glyth session or Collection behind a stable target id', () => {
  const session = (id: string) => preview({ kind: 'assembly-apply', targetId: 'glyth:one', targetRef: { kind: 'conversation', id }, sourceRefs: [assembly.sourceRef] });
  assert.equal(canCommitDropRelease(session('original'), session('replacement')), false);
  assert.equal(canCommitDropRelease(preview(intent), preview({ ...intent, collectionId: 'replacement' })), false);
});
test('release cannot swap the source payload after the user saw the preview', () => {
  assert.equal(canCommitDropRelease(preview(intent), preview(intent, { ...assembly, itemId: 'different' })), false);
});
test('release must preserve target and receiver kind, not merely have a valid new target', () => {
  const after = preview({ kind: 'assembly-apply', targetId: 'canvas', targetRef: { kind: 'main' }, sourceRefs: [assembly.sourceRef] });
  assert.equal(canCommitDropRelease(preview(intent), after), false);
  assert.equal(canCommitDropRelease(preview(intent), preview({ kind: 'composer-reference', targetId: intent.targetId, reference: { entityType: 'artifact', entityId: 'a1' } })), false);
});
test('a new intentional hover can accept a new receiver, and a first fast drop needs no timed gate', () => {
  const after = preview({ ...intent, targetId: 'collection:two', collectionId: 'c2' });
  assert.equal(canCommitDropRelease(after, after), true);
  assert.equal(canCommitDropRelease({ state: beginDrop(assembly), resolution: null }, after), true);
});
test('release rejects stale intent geometry and an ineligible last preview', () => {
  const ready = preview(intent);
  const inconsistent = { ...ready, state: { ...ready.state, destination: { targetId: 'other', previewPoint: { x: 150, y: 150 } } } as SemanticDropState };
  assert.equal(canCommitDropRelease(ready, inconsistent), false);
  assert.equal(canCommitDropRelease({ ...ready, resolution: { status: 'ineligible', targetId: intent.targetId, reason: 'not ready' } }, ready), false);
});

function dragHarness() {
  const host = new EventTarget();
  let state: SemanticDropState = beginDrop(assembly);
  let resolution: DropResolution | null = null;
  let commits = 0, cancels = 0;
  const registry = new DropTargetRegistry();
  registry.register({ ...collection, rect: { left: 100, top: 100, width: 100, height: 100 } });
  const dispose = bindNativeAssemblyDropEvents(host as unknown as Window, {
    read: () => ({ state, resolution }),
    advance: ({ clientX: x, clientY: y }) => {
      const target = registry.hitTest({ x, y });
      if (!target) { state = beginDrop(assembly); resolution = null; return true; }
      resolution = resolveDropIntent(assembly, target);
      state = { status: 'preview', payload: assembly, destination: { targetId: target.targetId, previewPoint: { x, y } }, carryAnchor: 'left' };
      return true;
    },
    commit: () => { commits++; state = confirmDrop(state, 'tx', { kind: 'collection-membership', targetId: 'collection' }); },
    cancel: () => { cancels++; state = { status: 'idle' }; resolution = null; },
  });
  const dispatch = (name: string, x = 150, y = 150, internal = true) => {
    const event = new Event(name, { cancelable: true });
    Object.assign(event, { clientX: x, clientY: y, key: 'Escape', dataTransfer: { types: internal ? [ASSEMBLY_DRAG_MIME] : ['Files'], dropEffect: 'none' } });
    host.dispatchEvent(event);
    return event;
  };
  return { dispatch, dispose, registry, get result() { return { commits, cancels, state }; }, setIdle: () => { state = { status: 'idle' }; } };
}
for (const ending of ['dragend', 'keydown', 'blur']) {
  test(`native Assembly hover followed by ${ending} cancels without a commit`, () => {
    const h = dragHarness();
    h.dispatch('dragover');
    assert.equal(h.result.state.status, 'preview');
    h.dispatch(ending);
    assert.equal(h.result.commits, 0);
    assert.equal(h.result.state.status, 'idle');
    h.dispose();
  });
}
test('native drop re-hit-tests release position, not the last eligible hover', () => {
  const h = dragHarness();
  h.dispatch('dragover');
  const event = h.dispatch('drop', 800, 600);
  assert(event.defaultPrevented);
  assert.equal(h.result.commits, 0);
  assert.equal(h.result.state.status, 'idle');
  h.dispose();
});
test('removed receiver at release cannot receive a native Assembly drop', () => {
  const h = dragHarness();
  h.dispatch('dragover');
  h.registry.clear();
  h.dispatch('drop');
  assert.equal(h.result.commits, 0);
  h.dispose();
});
test('native drop commits once; following dragend, duplicate drop and blur do not cancel its receipt', () => {
  const h = dragHarness();
  const event = h.dispatch('drop');
  h.dispatch('dragend'); h.dispatch('drop'); h.dispatch('blur');
  assert(event.defaultPrevented);
  assert.equal(h.result.commits, 1);
  assert.equal(h.result.state.status, 'committing');
  assert.equal(h.result.cancels, 0);
  h.dispose();
});
test('native bridge does not consume unrelated file imports; stale internal MIME cannot fall through', () => {
  const h = dragHarness(); h.setIdle();
  assert.equal(h.dispatch('drop', 100, 100, false).defaultPrevented, false);
  assert.equal(h.dispatch('drop').defaultPrevented, true);
  assert.equal(h.result.commits, 0);
  h.dispose();
});
test('disposed native bridge leaves no window listener capable of committing', () => {
  const h = dragHarness(); h.dispose();
  assert.equal(h.dispatch('drop').defaultPrevented, false);
  assert.equal(h.result.commits, 0);
});

test('REAL Core: Assembly ArtifactView -> canonical Collection -> SQLite reopen; right-carry source unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-g1-repair-'));
  const db = join(dir, 'metadata.sqlite');
  let repo = new SqliteMetadataRepository(db);
  try {
    const graph = createMvpSampleSnapshot(join(dir, 'project'), '2026-09-30T00:00:00.000Z');
    repo.save(graph);
    const projectId = String(graph.project.id);
    const service = new MutationSafetyService(repo, new PresentationApplicationService(repo, repo));
    const { collection: identity } = service.createCollection({ projectId, title: 'Interaction regression' });
    const artifact = graph.artifacts.find((item) => String(item.id) === 'artifact-feedback')!;
    const view = graph.artifactViews.find((item) => item.artifactId === artifact.id)!;
    assert(view);
    const result = resolveDropIntent({ kind: 'assembly', itemId: String(artifact.id),
      sourceRef: { kind: 'artifactView', id: String(view.id) }, entityRef: { type: 'artifact', id: String(artifact.id) } },
      { ...collection, semantic: { kind: 'collection-membership', collectionId: String(identity.id) } });
    assert.equal(result.status, 'ready');
    if (result.status !== 'ready' || result.intent.kind !== 'collection-membership') throw new Error('Membership intent missing');
    const input = nodes(); input[1]!.data.lcosCollectionId = String(identity.id);
    const before = JSON.stringify(input);
    const source = captureCollectionDropPlacement(input, new Set(), String(identity.id), 'source', true);
    let spatialCommands = 0;
    const receipt = await new DropCommitRouter().commit(result.intent, 'sqlite-right-carry', {
      applyAssembly: async () => { throw new Error('wrong owner'); }, addComposerReference: () => {},
      addCollectionMember: (intent) => Promise.resolve(service.addCollectionMember({ projectId, collectionId: intent.collectionId, memberRef: intent.memberRef })),
      onCollectionApplied: (intent) => {
        if (planCollectionDropPlacement(source, input, new Set(), intent.collectionId)) spatialCommands++;
      },
    });
    assert.equal(receipt.status, 'success');
    assert.equal(spatialCommands, 0);
    assert.equal(JSON.stringify(input), before);
    repo.close(); repo = new SqliteMetadataRepository(db);
    const persisted = repo.listCollectionMemberships(projectId, String(identity.id));
    assert.equal(persisted.length, 1);
    assert.deepEqual(persisted[0]!.memberRef, { type: 'artifact', id: String(artifact.id) });
    assert.equal(repo.foreignKeyCheck().length, 0);
  } finally { repo.close(); await rm(dir, { recursive: true, force: true }); }
});
