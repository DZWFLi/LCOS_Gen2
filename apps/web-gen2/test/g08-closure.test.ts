import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from '../src/backend/client.js';
import { SqliteBindingStore } from '../src/backend/sqliteBindingStore.js';
import { ProjectionBindingRegistry, MemoryBindingStore, type ProjectionBinding } from '../src/spatial/projectionBinding.js';
import { HuabuRfsClient } from '../src/spatial/huabuRfsClient.js';
import { ProjectToSpaceProjection } from '../src/spatial/projectToSpaceProjection.js';
import { RelationProjection } from '../src/spatial/relationProjection.js';
import { ReconciliationRunner } from '../src/spatial/reconciliationRunner.js';

const CANVAS = 'c1';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

// ---- G0.8: SqliteBindingStore (production, over Core SQLite) ----

test('SqliteBindingStore.list/find: reads bindings from Core GET', async () => {
  const bindings = [
    { projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'n1', entityType: 'artifact', entityId: 'a1' },
    { projectId: 'p1', canvasId: CANVAS, spatialKind: 'edge', spatialId: 'e1', entityType: 'relation', entityId: 'r1' },
  ] as ProjectionBinding[];
  const http = new HttpClient({
    baseUrl: 'http://core.test',
    fetch: async (input) => {
      assert.ok(String(input).endsWith('/projects/p1/spatial/bindings'));
      return jsonResponse({ ok: true, value: bindings });
    },
  });
  const store = new SqliteBindingStore(http, 'p1');
  const list = await store.list();
  assert.equal(list.length, 2);
  const found = await store.find({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', entityType: 'artifact', entityId: 'a1' });
  assert.equal(found?.spatialId, 'n1');
});

test('SqliteBindingStore: upsert/delete issue single-row writes (atomic, no snapshot)', async () => {
  const stored = new Map<string, ProjectionBinding>();
  const methods: string[] = [];
  const http = new HttpClient({
    baseUrl: 'http://core.test',
    fetch: async (input, init) => {
      const method = init?.method ?? 'GET';
      const body = JSON.parse((init?.body?.toString() ?? '{}')) as Record<string, unknown>;
      methods.push(method);
      if (method === 'GET') return jsonResponse({ ok: true, value: [...stored.values()] });
      if (method === 'PUT') {
        const key = `${body.projectId}|${body.canvasId}|${body.spatialKind}|${body.entityType}|${body.entityId}`;
        stored.set(key, body as unknown as ProjectionBinding);
        return jsonResponse({ ok: true, value: body });
      }
      if (method === 'DELETE') {
        const key = `${'p1'}|${body.canvasId}|${body.spatialKind}|${body.entityType}|${body.entityId}`;
        stored.delete(key);
        return jsonResponse({ ok: true, value: null });
      }
      return jsonResponse({ ok: true, value: null });
    },
  });
  const store = new SqliteBindingStore(http, 'p1');
  await store.upsert({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'n1', entityType: 'artifact', entityId: 'a1' });
  await store.upsert({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'edge', spatialId: 'e1', entityType: 'relation', entityId: 'r1' });
  assert.equal(methods.filter((m) => m === 'PUT').length, 2);
  assert.equal((await store.find({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', entityType: 'artifact', entityId: 'a1' }))?.spatialId, 'n1');
  await store.delete({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', entityType: 'artifact', entityId: 'a1' });
  assert.equal(methods.filter((m) => m === 'DELETE').length, 1);
  assert.equal(await store.find({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', entityType: 'artifact', entityId: 'a1' }), undefined);
});

test('SqliteBindingStore: concurrent upserts never lose each other (no lost-update)', async () => {
  const stored = new Map<string, ProjectionBinding>();
  const http = new HttpClient({
    baseUrl: 'http://core.test',
    fetch: async (input, init) => {
      const method = init?.method ?? 'GET';
      const body = JSON.parse((init?.body?.toString() ?? '{}')) as Record<string, unknown>;
      if (method === 'GET') return jsonResponse({ ok: true, value: [...stored.values()] });
      if (method === 'PUT') {
        await new Promise((r) => setTimeout(r, 2));
        stored.set(`${body.projectId}|${body.canvasId}|${body.spatialKind}|${body.entityType}|${body.entityId}`, body as unknown as ProjectionBinding);
        return jsonResponse({ ok: true, value: body });
      }
      if (method === 'DELETE') {
        const key = `${'p1'}|${body.canvasId}|${body.spatialKind}|${body.entityType}|${body.entityId}`;
        stored.delete(key);
        return jsonResponse({ ok: true, value: null });
      }
      return jsonResponse({ ok: true, value: null });
    },
  });
  const store = new SqliteBindingStore(http, 'p1');
  await Promise.all([
    store.upsert({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'nA', entityType: 'artifact', entityId: 'aA' }),
    store.upsert({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'nB', entityType: 'artifact', entityId: 'aB' }),
  ]);
  const list = await store.list();
  assert.equal(list.length, 2);
  assert.ok(list.some((b) => b.spatialId === 'nA'));
  assert.ok(list.some((b) => b.spatialId === 'nB'));
});

// ---- G0.8: ReconciliationRunner orchestrates repair primitives ----

function createdResponse(nodes?: { nodeId: string }[], edges?: { edgeId: string }[]) {
  return {
    canvasId: CANVAS,
    runId: 'r',
    fromVersion: 0,
    toVersion: 1,
    commands: [],
    results: [{ index: 0, type: 'CREATE_NODES', applied: true, nodes, edges }],
    revisions: [],
    affected: {},
  };
}

test('ReconciliationRunner.runOnce: projects artifacts, reconciles relations, prunes orphans', async () => {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  let nodeSeq = 0;
  let edgeSeq = 0;

  {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const text = init?.body?.toString() ?? '';
      const body = text ? JSON.parse(text) : undefined;
      const type = (body as { type?: string })?.type ?? (body as { commands?: { type?: string }[] })?.commands?.[0]?.type;
      if (type === 'INSPECT_NODES') {
        const ids = (body as { ids: string[] }).ids;
        return jsonResponse({ type: 'INSPECT_NODES', result: { count: 0, total: 0, truncated: false, nodes: ids.filter((id) => nodes.has(id)).map((id) => ({ id, type: 'note', filename: `${id}.md`, position: { x: 0, y: 0 }, absolutePosition: { x: 0, y: 0 }, size: { width: 280, height: 220 } })) } });
      }
      if (type === 'CREATE_NODES') {
        const created = (body as { commands: { nodes: { nodeType: string; data: { label: string } }[] }[] }).commands[0].nodes.map(() => ({ nodeId: `node-${++nodeSeq}` }));
        created.forEach((n) => nodes.add(n.nodeId));
        return jsonResponse(createdResponse(created));
      }
      if (type === 'INSPECT_EDGES') {
        const ids = (body as { ids: string[] }).ids;
        return jsonResponse({ type: 'INSPECT_EDGES', result: { count: 0, total: 0, truncated: false, edges: ids.filter((id) => edges.has(id)).map((id) => ({ id, source: 'a', target: 'b' })) } });
      }
      if (type === 'CONNECT_NODES') {
        const created = [{ edgeId: `edge-${++edgeSeq}` }];
        created.forEach((e) => edges.add(e.edgeId));
        return jsonResponse(createdResponse(undefined, created));
      }
      if (type === 'DISCONNECT_EDGES') {
        const edgesArg = (body as { commands: { edges: string[] }[] }).commands[0].edges;
        edgesArg.forEach((e) => edges.delete(e));
        return jsonResponse(createdResponse());
      }
      return jsonResponse({});
    };
    const rfs = new HuabuRfsClient({ canvasId: CANVAS, baseUrl: 'http://huabu.test', bearerToken: 'tok', fetch: fetchMock });

    const bindings = new ProjectionBindingRegistry(new MemoryBindingStore());
    const nodeProjector = new ProjectToSpaceProjection(rfs, bindings);
    const relationProjector = new RelationProjection(rfs, { async createRelation() { return { id: 'rel' }; }, async deleteRelation() {} }, bindings, 'p1');

    const projects = {
      getProjectGraph: async () => ({ artifacts: [{ id: 'a1' }, { id: 'a2' }] }),
    } as never;
    const relations = {
      listRelations: async () => [{ id: 'rel-1', sourceEntityType: 'artifact', sourceEntityId: 'a1', targetEntityType: 'artifact', targetEntityId: 'a2', kind: 'references', createdAt: 't', updatedAt: 't' }],
    } as never;

    const runner = new ReconciliationRunner({ projectId: 'p1', canvasId: CANVAS, projects, relations, nodeProjector, relationProjector, bindings } as never);
    const result = await runner.runOnce();

    assert.equal(result.artifactsProjected, 2);
    assert.equal(result.relationsScanned, 1);
    assert.equal(result.reconciledEdges, 1);
    assert.equal(result.removedOrphanEdges, 0);
    assert.equal(nodes.size, 2);
    assert.equal(edges.size, 1);
  }
});

test('ReconciliationRunner.runOnce: prunes orphan artifact node bindings when the artifact is gone', async () => {
  const nodes = new Set<string>();
  let deleted: string[] = [];
  let nodeSeq = 0;
  {
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const text = init?.body?.toString() ?? '';
      const body = text ? JSON.parse(text) : undefined;
      const type = (body as { type?: string })?.type ?? (body as { commands?: { type?: string }[] })?.commands?.[0]?.type;
      if (type === 'INSPECT_NODES') {
        const ids = (body as { ids: string[] }).ids;
        return jsonResponse({ type: 'INSPECT_NODES', result: { count: 0, total: 0, truncated: false, nodes: ids.filter((id) => nodes.has(id)).map((id) => ({ id, type: 'note', filename: `${id}.md`, position: { x: 0, y: 0 }, absolutePosition: { x: 0, y: 0 }, size: { width: 280, height: 220 } })) } });
      }
      if (type === 'CREATE_NODES') {
        const created = (body as { commands: { nodes: { nodeType: string; data: { label: string } }[] }[] }).commands[0].nodes.map(() => ({ nodeId: `node-${++nodeSeq}` }));
        created.forEach((n) => nodes.add(n.nodeId));
        return jsonResponse(createdResponse(created));
      }
      if (type === 'DELETE_NODES') {
        const ids = (body as { commands: { nodeIds: string[] }[] }).commands[0].nodeIds;
        ids.forEach((id) => nodes.delete(id));
        deleted = ids;
        return jsonResponse(createdResponse());
      }
      return jsonResponse({});
    };
    const rfs = new HuabuRfsClient({ canvasId: CANVAS, baseUrl: 'http://huabu.test', bearerToken: 'tok', fetch: fetchMock });

    const bindings = new ProjectionBindingRegistry(new MemoryBindingStore());
    await bindings.bind({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'node-ghost', entityType: 'artifact', entityId: 'ghost' });

    const nodeProjector = new ProjectToSpaceProjection(rfs, bindings);
    const relationProjector = new RelationProjection(rfs, { async createRelation() { return { id: 'rel' }; }, async deleteRelation() {} }, bindings, 'p1');

    const projects = { getProjectGraph: async () => ({ artifacts: [{ id: 'a1' }] }) } as never;
    const relations = { listRelations: async () => [] } as never;

    const runner = new ReconciliationRunner({ projectId: 'p1', canvasId: CANVAS, projects, relations, nodeProjector, relationProjector, bindings } as never);
    const result = await runner.runOnce();

    assert.equal(result.removedOrphanNodes, 1);
    assert.equal(result.artifactsProjected, 1);
    assert.deepEqual(deleted, ['node-ghost']);
    assert.equal(await bindings.findNode('p1', CANVAS, 'artifact', 'ghost'), undefined);
    assert.equal((await bindings.findNode('p1', CANVAS, 'artifact', 'a1'))?.spatialId, 'node-1');
  }
});
