import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectionBindingRegistry, MemoryBindingStore, type ProjectionBinding } from '../src/spatial/projectionBinding.js';
import { HuabuRfsClient } from '../src/spatial/huabuRfsClient.js';
import { ProjectToSpaceProjection } from '../src/spatial/projectToSpaceProjection.js';
import { RelationProjection, type CoreRelationWriter, type NodeBindingResolver } from '../src/spatial/relationProjection.js';
import type { RfsExecuteResponse } from '../src/spatial/types.js';

const BASE = 'http://huabu.test';
const CANVAS = 'c1';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Captured {
  url: string;
  body?: unknown;
}

function makeRfs(router: (req: Captured) => Response) {
  const captured: Captured[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url;
    const text = init?.body?.toString() ?? '';
    const body = text ? JSON.parse(text) : undefined;
    captured.push({ url, body });
    return router({ url, body });
  };
  const client = new HuabuRfsClient({ canvasId: CANVAS, baseUrl: BASE, bearerToken: 'tok', fetch: fetchMock });
  return { client, captured };
}

/** RFS execute body is { commands:[...] }; query body is the raw query object. */
function cmdType(body: unknown): string | undefined {
  const b = body as { commands?: { type?: string }[] };
  return b.commands?.[0]?.type;
}

function createdResponse(nodes?: { nodeId: string }[], edges?: { edgeId: string }[]): RfsExecuteResponse {
  return {
    canvasId: CANVAS,
    runId: 'run-1',
    fromVersion: 0,
    toVersion: 1,
    commands: [],
    results: [{ index: 0, type: 'CREATE_NODES', applied: true, nodes, edges }],
    revisions: [],
    affected: { nodeIds: nodes?.map((n) => n.nodeId) ?? [], edgeIds: edges?.map((e) => e.edgeId) ?? [], deletedNodeIds: [], deletedEdgeIds: [] },
  };
}

function inspectNodesFound(found: string[]): Response {
  return jsonResponse({
    type: 'INSPECT_NODES',
    result: { count: found.length, total: found.length, truncated: false, nodes: found.map((id) => ({ id, type: 'note', filename: `${id}.md`, position: { x: 0, y: 0 }, absolutePosition: { x: 0, y: 0 }, size: { width: 280, height: 220 } })) },
  });
}

function inspectEdgesFound(found: string[]): Response {
  return jsonResponse({
    type: 'INSPECT_EDGES',
    result: { count: found.length, total: found.length, truncated: false, edges: found.map((id) => ({ id, source: 'a', target: 'b' })) },
  });
}

function edgeBinding(edgeId: string): ProjectionBinding {
  return { projectId: 'p1', canvasId: CANVAS, spatialKind: 'edge', spatialId: edgeId, entityType: 'relation', entityId: 'rel-1' };
}

const noopWriter: CoreRelationWriter = { async createRelation() { return { id: 'rel-1' }; }, async deleteRelation() {} };
const resolver: NodeBindingResolver = () => ({ entityType: 'artifact', entityId: 'a1' });

// ---- G0.6: artifact stale-binding repair ----

test('project: existing binding reuses node when the Huabu node still exists', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'node-A1', entityType: 'artifact', entityId: 'a1' });
  const { client } = makeRfs((req) => {
    if (req.body?.type === 'INSPECT_NODES') return inspectNodesFound((req.body as { ids: string[] }).ids);
    assert.fail(`unexpected ${req.url}`);
  });
  const proj = new ProjectToSpaceProjection(client, reg);
  const out = await proj.projectArtifacts([{ projectId: 'p1', artifactId: 'a1', kind: 'text', title: 'Doc' }]);
  assert.equal(out[0]?.spatialId, 'node-A1');
});

test('project: stale binding (node gone in Huabu) is dropped and the artifact re-created', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'node-GONE', entityType: 'artifact', entityId: 'a1' });
  const creates: Record<string, unknown>[] = [];
  const { client } = makeRfs((req) => {
    if (req.body?.type === 'INSPECT_NODES') return inspectNodesFound([]);
    if (cmdType(req.body) === 'CREATE_NODES') {
      creates.push(req.body as Record<string, unknown>);
      return jsonResponse(createdResponse([{ nodeId: 'node-NEW' }]));
    }
    return jsonResponse({});
  });
  const proj = new ProjectToSpaceProjection(client, reg);
  const out = await proj.projectArtifacts([{ projectId: 'p1', artifactId: 'a1', kind: 'text', title: 'Doc' }]);
  assert.equal(out[0]?.spatialId, 'node-NEW');
  assert.equal(creates.length, 1);
  assert.equal(await reg.findNode('p1', CANVAS, 'artifact', 'a1').then((b) => b?.spatialId), 'node-NEW');
});

// ---- G0.6: relation↔edge reconciliation ----

test('reconcileRelationEdge: no binding -> projects edge and binds it', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  const { client } = makeRfs((req) => {
    assert.equal(cmdType(req.body), 'CONNECT_NODES');
    return jsonResponse(createdResponse(undefined, [{ edgeId: 'edge-1' }]));
  });
  const proj = new RelationProjection(client, noopWriter, reg, 'p1');
  await proj.reconcileRelationEdge({ id: 'rel-1', kind: 'references', from: { entityType: 'artifact', entityId: 'a1' }, to: { entityType: 'artifact', entityId: 'a2' } }, 'nA', 'nB');
  assert.equal((await reg.findEdge('p1', CANVAS, 'rel-1'))?.spatialId, 'edge-1');
});

test('reconcileRelationEdge: binding + edge present -> no-op (no CONNECT)', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind(edgeBinding('edge-1'));
  const connects: unknown[] = [];
  const { client } = makeRfs((req) => {
    if (req.body?.type === 'INSPECT_EDGES') return inspectEdgesFound((req.body as { ids: string[] }).ids);
    if (cmdType(req.body) === 'CONNECT_NODES') { connects.push(req.body); return jsonResponse(createdResponse(undefined, [{ edgeId: 'edge-X' }])); }
    return jsonResponse({});
  });
  const proj = new RelationProjection(client, noopWriter, reg, 'p1');
  await proj.reconcileRelationEdge({ id: 'rel-1', kind: 'references', from: { entityType: 'artifact', entityId: 'a1' }, to: { entityType: 'artifact', entityId: 'a2' } }, 'nA', 'nB');
  assert.equal(connects.length, 0);
  assert.equal((await reg.findEdge('p1', CANVAS, 'rel-1'))?.spatialId, 'edge-1');
});

test('reconcileRelationEdge: binding + edge gone -> disconnect stale, re-CONNECT, rebind', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind(edgeBinding('edge-DEAD'));
  const calls: unknown[] = [];
  const { client } = makeRfs((req) => {
    if (req.body?.type === 'INSPECT_EDGES') return inspectEdgesFound([]);
    const type = cmdType(req.body);
    if (type === 'DISCONNECT_EDGES') { calls.push(['disconnect', (req.body as { commands: { edges: unknown[] }[] }).commands[0].edges]); return jsonResponse(createdResponse()); }
    if (type === 'CONNECT_NODES') { calls.push(['connect']); return jsonResponse(createdResponse(undefined, [{ edgeId: 'edge-NEW' }])); }
    return jsonResponse({});
  });
  const proj = new RelationProjection(client, noopWriter, reg, 'p1');
  await proj.reconcileRelationEdge({ id: 'rel-1', kind: 'references', from: { entityType: 'artifact', entityId: 'a1' }, to: { entityType: 'artifact', entityId: 'a2' } }, 'nA', 'nB');
  assert.ok(calls.some((c) => (c as unknown[])[0] === 'disconnect' && (c as unknown[])[1][0] === 'edge-DEAD'));
  assert.ok(calls.some((c) => (c as unknown[])[0] === 'connect'));
  assert.equal((await reg.findEdge('p1', CANVAS, 'rel-1'))?.spatialId, 'edge-NEW');
});

test('removeOrphanRelationEdge: disconnects + unbinds a leftover edge with no Core relation', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind(edgeBinding('edge-ORPHAN'));
  const disconnect: unknown[] = [];
  const { client } = makeRfs((req) => {
    assert.equal(cmdType(req.body), 'DISCONNECT_EDGES');
    disconnect.push((req.body as { commands: { edges: unknown[] }[] }).commands[0].edges);
    return jsonResponse(createdResponse());
  });
  const proj = new RelationProjection(client, noopWriter, reg, 'p1');
  await proj.removeOrphanRelationEdge('rel-1');
  assert.equal(disconnect[0]?.[0], 'edge-ORPHAN');
  assert.equal(await reg.findEdge('p1', CANVAS, 'rel-1'), undefined);
});

// ---- G0.6: createRelation client (minimal POST) ----

test('relations.createRelation: POSTs minimal input and returns Core-generated relation + changeSetId', async () => {
  const { CoreRelationClient } = await import('../src/backend/relations.js');
  const { HttpClient } = await import('../src/backend/client.js');
  const http = new HttpClient({
    baseUrl: 'http://core.test',
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.url;
      const body = JSON.parse((init?.body?.toString() ?? '{}'));
      assert.equal(url, 'http://core.test/projects/p1/relations');
      assert.equal(body.sourceEntityType, 'artifact');
      assert.equal(body.kind, 'references');
      assert.equal('createdAt' in body, false);
      return jsonResponse({ ok: true, value: { id: 'relation-gen', projectId: 'p1', sourceEntityType: 'artifact', sourceEntityId: 'a1', targetEntityType: 'artifact', targetEntityId: 'a2', kind: 'references', createdAt: '2026', updatedAt: '2026' }, meta: { changeSetId: 'cs-1' } });
    },
  });
  const client = new CoreRelationClient(http);
  const result = await client.createRelation('p1', { sourceEntityType: 'artifact', sourceEntityId: 'a1', targetEntityType: 'artifact', targetEntityId: 'a2', kind: 'references' });
  assert.equal(result.relation.id, 'relation-gen');
  assert.equal(result.changeSetId, 'cs-1');
});
