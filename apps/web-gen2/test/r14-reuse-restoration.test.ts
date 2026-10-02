import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePresentationDensity, resolveStablePresentationDensity, type NodePresentationInput } from '../src/presentation/nodePresentation.ts';
import { finishPresentationDensity } from '../../../huabu/apps/web/src/lcos/nodes/densityBudget.ts';
import { visibleFlowNodeCount } from '../../../huabu/apps/web/src/lcos/nodes/visibleNodeCount.ts';
import { layoutNodeLocked, planSelectionLayout } from '../../../huabu/apps/web/src/lcos/navigation/selectionLayout.ts';
import { nodeVisualBounds, layoutVisualGrid } from '../../../huabu/apps/web/src/lcos/navigation/donor/gen1VisualLayout.ts';
import { canvasTextReplyMatches, canvasTextCarrierMatches } from '../../../huabu/apps/web/src/lcos/nodes/canvasTextSave.ts';

const presentation = (patch: Partial<NodePresentationInput> = {}): NodePresentationInput => ({
  worldWidth: 200, worldHeight: 100, zoom: 1, dpr: 1, screenWidth: 200, screenHeight: 100, phase: 'rest', ...patch,
});
const node = (id: string, x = 0, y = 0, width = 180, height = 90, extra: any = {}) => ({
  id, type: 'image', position: { x, y }, width, height, data: {}, ...extra,
});
const internal = (id: string, x = 0, y = 0, extra: any = {}) => ({
  ...node(id, x, y), measured: { width: 180, height: 90 }, internals: { positionAbsolute: { x, y } }, ...extra,
});
const flow = (nodes: any[], patch: any = {}) => ({ nodeLookup: new Map(nodes.map((n) => [n.id, n])), width: 600, height: 400, transform: [0, 0, 1], ...patch }) as any;

test('R14 density: final active editing cannot be capped by 301 visible nodes', () => {
  const density = resolveStablePresentationDensity(presentation({ phase: 'editing', screenWidth: 20 }), 'summary', 10);
  assert.equal(finishPresentationDensity(density, 301, 'editing'), 'working');
  assert.equal(finishPresentationDensity('reading', 301, 'rest'), 'summary');
});
test('R14 density: resizing/dragging keep their size-based body rather than population cap', () => {
  assert.equal(finishPresentationDensity('reading', 900, 'dragging'), 'reading');
  assert.equal(finishPresentationDensity('working', 900, 'resizing'), 'working');
});
test('R14 density: hidden and offscreen nodes do not count against the visible editor', () => {
  const state = flow([internal('visible'), ...Array.from({ length: 300 }, (_, i) => internal(`h${i}`, 0, 0, { hidden: true })), internal('far', 2000)]);
  assert.equal(visibleFlowNodeCount(state), 1);
});
test('R14 density: hidden ancestor excludes visible child; cycles cannot hang', () => {
  assert.equal(visibleFlowNodeCount(flow([internal('p', 0, 0, { hidden: true }), internal('c', 0, 0, { parentId: 'p' })])), 0);
  assert.equal(visibleFlowNodeCount(flow([internal('a', 0, 0, { parentId: 'b' }), internal('b', 0, 0, { parentId: 'a' })])), 0);
});
test('R14 density: live camera transform and actual measured dimensions determine intersection', () => {
  assert.equal(visibleFlowNodeCount(flow([internal('a', 1000)], { transform: [-1000, 0, 1] })), 1);
  assert.equal(visibleFlowNodeCount(flow([internal('a', 605, 0, { measured: { width: 10, height: 10 } })])), 0);
  assert.equal(visibleFlowNodeCount(flow([internal('a', -5, 0, { measured: { width: 10, height: 10 } })])), 1);
});
test('R14 density: repeated selectors share same immutable snapshot, new snapshot changes result', () => {
  const state = flow([internal('a')]);
  assert.equal(visibleFlowNodeCount(state), 1); assert.equal(visibleFlowNodeCount(state), 1);
  assert.equal(visibleFlowNodeCount({ ...state, transform: [-800, 0, 1] }), 0);
});
test('R14 density: no measurable viewport does not force a heavy scene into a fake capacity', () => {
  assert.equal(visibleFlowNodeCount(flow([internal('a')], { width: 0 })), 0);
});
test('R14 density: first render uses original resolver, not an arbitrary fixed tier', () => {
  for (const width of [20, 80, 100, 179, 181, 490]) {
    const input = presentation({ screenWidth: width, screenHeight: 300 });
    assert.equal(resolveStablePresentationDensity(input, undefined, 10), resolvePresentationDensity(input));
  }
});
test('R14 density: 179.9/180.1 does not repeatedly switch information', () => {
  let previous: any = 'summary';
  for (const screenWidth of [179.9, 180.1, 179.9, 180.1]) {
    previous = resolveStablePresentationDensity(presentation({ screenWidth }), previous, 10);
    assert.equal(previous, 'summary');
  }
  assert.equal(resolveStablePresentationDensity(presentation({ screenWidth: 191 }), previous, 10), 'working');
});
test('R14 density: demotion has the same band and still responds to a large zoom change', () => {
  assert.equal(resolveStablePresentationDensity(presentation({ screenWidth: 175 }), 'working', 10), 'working');
  assert.equal(resolveStablePresentationDensity(presentation({ screenWidth: 169 }), 'working', 10), 'summary');
  assert.equal(resolveStablePresentationDensity(presentation({ screenWidth: 12, screenHeight: 12 }), 'reading', 10), 'mark');
});
test('R14 density: device pixel ratio is not a second information threshold', () => {
  assert.equal(resolveStablePresentationDensity(presentation({ dpr: 1 }), 'summary', 10),
    resolveStablePresentationDensity(presentation({ dpr: 3 }), 'summary', 10));
});
test('R14 layout: G1 original visible-body insets are preserved for approved collection', () => {
  assert.deepEqual(nodeVisualBounds({ id: 'f', entityKind: 'collection', x: 20, y: 30, width: 200, height: 100 }),
    { x: 10, y: 12, width: 222, height: 142 });
});
test('R14 layout: large first image does not allocate 830px to every small image', () => {
  const nodes = [node('big', 0, 0, 800), ...Array.from({ length: 5 }, (_, i) => node(`s${i}`, 1000 + i * 400, i * 100))];
  const updates = planSelectionLayout(nodes, nodes.map((n) => n.id), 'tidy');
  const a = updates.find((n) => n.nodeId === 's0')!.position!, b = updates.find((n) => n.nodeId === 's1')!.position!;
  assert.equal(b.y, a.y); assert.equal(b.x - a.x, 180 + 14 + 30);
});
test('R14 layout: host adapter supplies real Collection identity, not a title guess', () => {
  const nodes = [node('f', 20, 20, 200, 100), node('a', 900, 20)];
  const plain = planSelectionLayout(nodes, ['f', 'a'], 'tidy');
  const collection = planSelectionLayout(nodes, ['f', 'a'], 'tidy', new Map([['f', 'collection']]));
  assert.notDeepEqual(collection, plain);
});
test('R14 layout: a child of a locked parent and unknown/cyclic parents cannot move', () => {
  const nodes = [node('p', 0, 0, 1000, 1000, { data: { locked: true } }), node('c', 10, 20, 100, 100, { parentId: 'p' }), node('o', 2000)];
  assert(layoutNodeLocked(nodes, 'c')); assert(layoutNodeLocked(nodes, 'missing'));
  assert(!planSelectionLayout(nodes, ['c', 'o'], 'tidy').some((p) => p.nodeId === 'c'));
  assert(layoutNodeLocked([node('a', 0, 0, 100, 100, { parentId: 'a' })], 'a'));
});
test('R14 layout: lifted function does not mutate inputs and locked anchors remain exact', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, width: 800, height: 200 }, { id: 'locked', x: 400, y: 400, width: 100, height: 100, positionLocked: true }];
  const before = JSON.stringify(nodes), result = layoutVisualGrid(nodes, { x: 0, y: 0 });
  assert.equal(JSON.stringify(nodes), before); assert.deepEqual(result.find((p) => p.id === 'locked'), { id: 'locked', x: 400, y: 400 });
});
const sent = { canvasId: 'canvas', spatialId: 'node', body: '# 原稿', expectedRevisionId: null };
const reply = { ...sent, projectId: 'p', artifactId: 'a', revisionId: 'r', viewId: 'v', fileRecordId: 'file', title: '原稿' };
test('R14 text reply: exact saved identity/body confirms the same native carrier', () => assert(canvasTextReplyMatches('p', sent, reply)));
for (const field of ['projectId', 'canvasId', 'spatialId', 'body', 'artifactId'] as const) {
  test(`R14 text reply: mismatched ${field} cannot register or clear a draft`, () => {
    assert(!canvasTextReplyMatches('p', { ...sent, artifactId: 'a' }, { ...reply, [field]: 'other' }));
  });
}

test('R14 text reply: original unbound carrier can accept its committed artifact', () => {
  assert(canvasTextCarrierMatches(undefined, reply));
});
test('R14 text reply: matching projected artifact does not block confirmation', () => {
  assert(canvasTextCarrierMatches({ entityType: 'artifact', entityId: reply.artifactId }, reply));
});
test('R14 text reply: changed carrier identity cannot be overwritten by a late save', () => {
  assert(!canvasTextCarrierMatches({ entityType: 'artifact', entityId: 'different' }, reply));
});
test('R14 text reply: same string ID in another entity type is not the saved artifact', () => {
  assert(!canvasTextCarrierMatches({ entityType: 'collection', entityId: reply.artifactId }, reply));
});
