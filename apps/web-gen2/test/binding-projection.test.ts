import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProjectionBindingRegistry,
  MemoryBindingStore,
  FileBindingStore,
  type ProjectionBinding,
} from '../src/spatial/projectionBinding.js';
import { HuabuRfsClient } from '../src/spatial/huabuRfsClient.js';
import { ProjectToSpaceProjection } from '../src/spatial/projectToSpaceProjection.js';
import { RelationProjection, type CoreRelationWriter, type NodeBindingResolver } from '../src/spatial/relationProjection.js';
import type { RfsExecuteResponse } from '../src/spatial/types.js';

const BASE = 'http://huabu.test';
const CANVAS = 'c1';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function nodeBinding(overrides: Partial<ProjectionBinding> = {}): ProjectionBinding {
  return {
    projectId: 'p1',
    canvasId: CANVAS,
    spatialKind: 'node',
    spatialId: 'node-a1',
    entityType: 'artifact',
    entityId: 'a1',
    ...overrides,
  };
}

function createdResponse(nodes?: { nodeId: string }[], edges?: { edgeId: string }[]): RfsExecuteResponse {
  return {
    canvasId: CANVAS,
    runId: 'run-1',
    fromVersion: 0,
    toVersion: 1,
    commands: [],
    results: [
      {
        index: 0,
        type: 'CREATE_NODES',
        applied: true,
        nodes,
        edges,
      },
    ],
    revisions: [],
    affected: { nodeIds: nodes?.map((n) => n.nodeId) ?? [], edgeIds: edges?.map((e) => e.edgeId) ?? [], deletedNodeIds: [], deletedEdgeIds: [] },
  };
}

function makeRfs(route: (req: { url: string; body?: unknown }) => Response) {
  const captured: { url: string; body?: unknown }[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url;
    const bodyText = init?.body?.toString() ?? '';
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    captured.push({ url, body });
    return route({ url, body });
  };
  const client = new HuabuRfsClient({ canvasId: CANVAS, baseUrl: BASE, bearerToken: 'tok', fetch: fetchMock });
  return { client, captured };
}

// ---- §12.5 binding persistence across registry instances ----

function memoryFs() {
  const map = new Map<string, string>();
  return {
    readFile: async (path: string) => {
      const value = map.get(path);
      if (value === undefined) throw new Error('ENOENT');
      return value;
    },
    writeFile: async (path: string, data: string) => {
      map.set(path, data);
    },
    map,
  };
}

test('binding persistence: survives registry dispose + new registry over same durable store', async () => {
  const fs = memoryFs();
  const path = '/tmp/bindings.json';

  const reg1 = new ProjectionBindingRegistry(new FileBindingStore(path, fs));
  await reg1.bind(nodeBinding());

  const reg2 = new ProjectionBindingRegistry(new FileBindingStore(path, fs));
  const found = await reg2.findNode('p1', CANVAS, 'artifact', 'a1');
  assert.ok(found);
  assert.equal(found?.spatialId, 'node-a1');
  assert.equal(found?.spatialKind, 'node');
});

// ---- §12.6 multi-canvas ----

test('multi-canvas: same artifact projects to distinct nodes in two canvases', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind(nodeBinding({ canvasId: 'A', spatialId: 'node-A' }));
  await reg.bind(nodeBinding({ canvasId: 'B', spatialId: 'node-B' }));

  const a = await reg.findNode('p1', 'A', 'artifact', 'a1');
  const b = await reg.findNode('p1', 'B', 'artifact', 'a1');
  assert.equal(a?.spatialId, 'node-A');
  assert.equal(b?.spatialId, 'node-B');

  const dup = await reg.findNode('p1', 'A', 'artifact', 'a1');
  assert.equal(dup?.spatialId, 'node-A');
});

test('binding registry: unbindByEntity removes only the targeted binding', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind(nodeBinding({ canvasId: 'A', spatialId: 'node-A' }));
  await reg.bind(nodeBinding({ canvasId: 'B', spatialId: 'node-B' }));

  await reg.unbindByEntity('p1', 'A', 'node', 'artifact', 'a1');
  assert.equal(await reg.findNode('p1', 'A', 'artifact', 'a1'), undefined);
  assert.equal((await reg.findNode('p1', 'B', 'artifact', 'a1'))?.spatialId, 'node-B');
});

// ---- ProjectToSpaceProjection: idempotence + nodeId extraction ----

test('project: idempotent reuses existing binding without issuing CREATE_NODES', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind(nodeBinding());

  const { client } = makeRfs((req) => {
    if (req.body?.type === 'INSPECT_NODES') {
      return jsonResponse({ type: 'INSPECT_NODES', result: { count: 1, total: 1, truncated: false, nodes: [{ id: 'node-a1', type: 'note', filename: 'a.md', position: { x: 0, y: 0 }, absolutePosition: { x: 0, y: 0 }, size: { width: 280, height: 220 } }] } });
    }
    return jsonResponse(createdResponse());
  });
  const proj = new ProjectToSpaceProjection(client, reg);
  const out = await proj.projectArtifacts([{ projectId: 'p1', artifactId: 'a1', kind: 'text', title: 'Doc' }]);

  assert.equal(out.length, 1);
  assert.equal(out[0]?.spatialId, 'node-a1');
});

test('project: new artifact issues CREATE_NODES and binds the real nodeId', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  const { client } = makeRfs((req) => {
    const cmd = (req.body as { commands: { type: string; nodes: { nodeType: string; data: { label: string }; position: { x: number; y: number } }[] }[] }).commands[0];
    assert.equal(cmd.type, 'CREATE_NODES');
    assert.equal(cmd.nodes[0]?.nodeType, 'text');
    assert.equal(cmd.nodes[0]?.data?.label, 'Doc');
    return jsonResponse(createdResponse([{ nodeId: 'nX' }]));
  });

  const proj = new ProjectToSpaceProjection(client, reg);
  const out = await proj.projectArtifacts([{ projectId: 'p1', artifactId: 'a1', kind: 'text', title: 'Doc' }]);

  assert.equal(out[0]?.spatialId, 'nX');
  assert.equal(out[0]?.entityType, 'artifact');
  assert.equal(await reg.findNode('p1', CANVAS, 'artifact', 'a1').then((b) => b?.spatialId), 'nX');
});

test('project: CREATE_NODES with no returned nodeId throws', async () => {
  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  const { client } = makeRfs(() => jsonResponse(createdResponse([])));
  const proj = new ProjectToSpaceProjection(client, reg);
  await assert.rejects(() => proj.projectArtifacts([{ projectId: 'p1', artifactId: 'a1', kind: 'text', title: 'Doc' }]));
});

// ---- RelationProjection: Core canonical -> Edge, real edgeId, delete order ----

test('relation: onConnectGesture creates Core relation first, then Edge, then binds real edgeId', async () => {
  const calls: string[] = [];
  const core: CoreRelationWriter = {
    async createRelation(input) {
      calls.push('core:create');
      return { id: 'rel-1' };
    },
    async deleteRelation(id) {
      calls.push(`core:delete:${id}`);
    },
  };

  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  const { client } = makeRfs((req) => {
    const cmd = (req.body as { commands: { type: string; edges: { source: string; target: string }[] }[] }).commands[0];
    assert.equal(cmd.type, 'CONNECT_NODES');
    calls.push('rfs:connect');
    return jsonResponse({
      canvasId: CANVAS,
      runId: 'run',
      fromVersion: 0,
      toVersion: 1,
      commands: [],
      results: [{ index: 0, type: 'CONNECT_NODES', applied: true, edges: [{ edgeId: 'edge-1', source: 'nA', target: 'nB' }] }],
      revisions: [],
      affected: { nodeIds: [], edgeIds: ['edge-1'], deletedNodeIds: [], deletedEdgeIds: [] },
    });
  });

  const proj = new RelationProjection(client, core, reg, 'p1');
  const resolver: NodeBindingResolver = (nodeId: string) =>
    nodeId === 'nA' ? { entityType: 'artifact', entityId: 'a1' } : nodeId === 'nB' ? { entityType: 'artifact', entityId: 'a2' } : undefined;

  const { relationId, edgeId } = await proj.onConnectGesture({ sourceNodeId: 'nA', targetNodeId: 'nB', label: 'references' }, resolver);

  assert.equal(relationId, 'rel-1');
  assert.equal(edgeId, 'edge-1');
  assert.deepEqual(calls.slice(0, 2), ['core:create', 'rfs:connect']);
  assert.equal((await reg.findEdge('p1', CANVAS, 'rel-1'))?.spatialId, 'edge-1');
});

test('relation: deleteRelation deletes Core first, then disconnects real edgeId, then unbinds', async () => {
  const calls: string[] = [];
  const core: CoreRelationWriter = {
    async createRelation() {
      return { id: 'rel-1' };
    },
    async deleteRelation(id) {
      calls.push(`core:delete:${id}`);
    },
  };

  const reg = new ProjectionBindingRegistry(new MemoryBindingStore());
  await reg.bind({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'edge', spatialId: 'edge-1', entityType: 'relation', entityId: 'rel-1' });

  const { client } = makeRfs((req) => {
    const cmd = (req.body as { commands: { type: string; edges: unknown }[] }).commands[0];
    assert.equal(cmd.type, 'DISCONNECT_EDGES');
    assert.equal(cmd.edges[0], 'edge-1');
    calls.push('rfs:disconnect');
    return jsonResponse({ canvasId: CANVAS, runId: 'run', fromVersion: 0, toVersion: 1, commands: [], results: [{ index: 0, type: 'DISCONNECT_EDGES', applied: true }], revisions: [], affected: { nodeIds: [], edgeIds: [], deletedNodeIds: [], deletedEdgeIds: ['edge-1'] } });
  });

  const proj = new RelationProjection(client, core, reg, 'p1');
  await proj.deleteRelation('rel-1');

  assert.deepEqual(calls, ['core:delete:rel-1', 'rfs:disconnect']);
  assert.equal(await reg.findEdge('p1', CANVAS, 'rel-1'), undefined);
});
