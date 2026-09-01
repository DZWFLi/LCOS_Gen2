import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectionBindingRegistry, MemoryBindingStore } from '../src/spatial/projectionBinding.js';
import { HuabuRfsClient } from '../src/spatial/huabuRfsClient.js';
import { ProjectToSpaceProjection } from '../src/spatial/projectToSpaceProjection.js';
import { HostLifecycleReconciler } from '../src/host/lifecycleReconciler.js';
import { connectSemantic, ConnectIntentError } from '../src/host/hostConnectIntent.js';
import { Gen2Host } from '../src/host/projectionFacade.js';
import { HttpClient } from '../src/backend/client.js';
import { CoreRelationClient } from '../src/backend/relations.js';

const CANVAS = 'c1';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function makeRfs(router: (body?: unknown, method?: string) => Response) {
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url;
    const text = init?.body?.toString() ?? '';
    const body = text ? JSON.parse(text) : undefined;
    return router(body, init?.method);
  };
  return new HuabuRfsClient({ canvasId: CANVAS, baseUrl: 'http://huabu.test', bearerToken: 'tok', fetch: fetchMock });
}

function createdResponse(nodes?: { nodeId: string }[], edges?: { edgeId: string }[]) {
  return { canvasId: CANVAS, runId: 'r', fromVersion: 0, toVersion: 1, commands: [], results: [{ index: 0, type: 'CREATE_NODES', applied: true, nodes, edges }], revisions: [], affected: {} };
}

function cmdType(body?: unknown): string | undefined {
  return (body as { commands?: { type?: string }[] })?.commands?.[0]?.type ?? (body as { type?: string })?.type;
}

// ---- G0.9 #5: generic spatial consumer reuses the SAME Binding model (no new type) ----

test('projectEntity: conversation/skill reuse the same ProjectionBinding model', async () => {
  const bindings = new ProjectionBindingRegistry(new MemoryBindingStore());
  const rfs = makeRfs((body) => {
    if (cmdType(body) === 'CREATE_NODES') return jsonResponse(createdResponse([{ nodeId: 'node-conv' }]));
    return jsonResponse({});
  });
  const proj = new ProjectToSpaceProjection(rfs, bindings);
  const b = await proj.projectEntity({ projectId: 'p1', entityType: 'conversation', entityId: 'c1', kind: 'text', title: 'Convo' });
  assert.equal(b.entityType, 'conversation');
  assert.equal(b.spatialId, 'node-conv');
  const found = await bindings.findNode('p1', CANVAS, 'conversation', 'c1');
  assert.equal(found?.spatialId, 'node-conv');
});

test('projectEntity: stale binding repaired for any entityType (skill)', async () => {
  const bindings = new ProjectionBindingRegistry(new MemoryBindingStore());
  await bindings.bind({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'node-GONE', entityType: 'skill', entityId: 's1' });
  const rfs = makeRfs((body) => {
    const type = cmdType(body);
    if (type === 'INSPECT_NODES') return jsonResponse({ type: 'INSPECT_NODES', result: { count: 0, total: 0, truncated: false, nodes: [] } });
    if (type === 'CREATE_NODES') return jsonResponse(createdResponse([{ nodeId: 'node-SKILL' }]));
    return jsonResponse({});
  });
  const proj = new ProjectToSpaceProjection(rfs, bindings);
  const b = await proj.projectEntity({ projectId: 'p1', entityType: 'skill', entityId: 's1', kind: 'file', title: 'Skill' });
  assert.equal(b.spatialId, 'node-SKILL');
  assert.equal((await bindings.findNode('p1', CANVAS, 'skill', 's1'))?.spatialId, 'node-SKILL');
});

// ---- G0.9 #4: reconciliation wired into host lifecycle ----

test('HostLifecycleReconciler: cooldown throttles immediate re-runs', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  t.after(() => mock.timers.reset());

  let runs = 0;
  const rec = new HostLifecycleReconciler({ runOnce: async () => { runs += 1; } }, 'p1', { cooldownMs: 100, debounceMs: 50 });

  rec.onProjectOpen();
  assert.equal(runs, 1, 'project-open runs');
  rec.onProjectOpen(); // within cooldown -> skipped
  assert.equal(runs, 1, 'second open within cooldown skipped');
  rec.onConnectionRestored(); // within cooldown -> skipped
  assert.equal(runs, 1, 'reconnect within cooldown skipped');
  rec.dispose();
});

test('HostLifecycleReconciler: mutation debounces and coalesces a burst', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  t.after(() => mock.timers.reset());

  let runs = 0;
  const rec = new HostLifecycleReconciler({ runOnce: async () => { runs += 1; } }, 'p1', { cooldownMs: 0, debounceMs: 50 });

  rec.onMutationSuccess();
  assert.equal(runs, 0, 'not run before debounce');
  await mock.timers.tick(60);
  assert.equal(runs, 1, 'runs after debounce');

  rec.onMutationSuccess();
  rec.onMutationSuccess();
  assert.equal(runs, 1, 'burst not run before debounce');
  await mock.timers.tick(60);
  assert.equal(runs, 2, 'burst collapses to one sweep');
  rec.dispose();
});

test('HostLifecycleReconciler: reconnect runs immediately; periodic is fallback', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
  t.after(() => mock.timers.reset());

  let runs = 0;
  const rec = new HostLifecycleReconciler({ runOnce: async () => { runs += 1; } }, 'p1', { cooldownMs: 100 });

  rec.onConnectionRestored();
  assert.equal(runs, 1, 'reconnect runs immediately');

  rec.startPeriodic(50);
  await mock.timers.tick(200);
  assert.ok(runs >= 1 && runs <= 3, `periodic is throttled by cooldown (runs=${runs})`);
  rec.dispose();
});

// ---- G0.9 #3: connect intent -> Core relation (min endpoint) -> Huabu edge ----

test('connectSemantic: creates Core relation (Core owns id/changeSet) then projects edge', async () => {
  const core = {
    createRelation: async (projectId: string, input: unknown) => ({ relation: { id: 'rel-1' }, changeSetId: 'cs-1' }),
    deleteRelation: async () => {},
  } as never as CoreRelationClient;

  let projected:
    | { relation: { id: string; kind: string; from: unknown; to: unknown }; fromNodeId: string; toNodeId: string }
    | undefined;
  const deps = {
    core,
    nodeIdFor: async () => 'node-a',
    projectEdge: async (relation: { id: string }, fromNodeId: string, toNodeId: string) => {
      projected = { relation: relation as never, fromNodeId, toNodeId };
      return { spatialId: 'edge-1' } as never;
    },
  };
  const result = await connectSemantic('p1', { from: { entityType: 'artifact', entityId: 'a1' }, to: { entityType: 'artifact', entityId: 'a2' }, kind: 'references' }, deps);
  assert.equal(result.relationId, 'rel-1');
  assert.equal(result.changeSetId, 'cs-1');
  assert.equal(result.edgeBinding?.spatialId, 'edge-1');
  assert.equal(projected?.fromNodeId, 'node-a');
});

test('connectSemantic: fails fast when an endpoint is not projected (no orphan relation)', async () => {
  let createCalled = false;
  const core = { createRelation: async () => { createCalled = true; return { relation: { id: 'x' }, changeSetId: 'x' }; }, deleteRelation: async () => {} } as never as CoreRelationClient;
  await assert.rejects(
    connectSemantic('p1', { from: { entityType: 'artifact', entityId: 'a1' }, to: { entityType: 'artifact', entityId: 'a2' }, kind: 'references' }, { core, nodeIdFor: async () => undefined, projectEdge: async () => undefined }),
    (err: unknown) => err instanceof ConnectIntentError && err.code === 'ENDPOINT_UNPROJECTED',
  );
  assert.equal(createCalled, false, 'no Core relation created when an endpoint is unprojected');
});

// ---- G0.9 #1/#2: small typed facade (Gen2Host) ----

test('Gen2Host: wire nodeIdFor + connect through Core Relation -> Edge', async () => {
  const storedBindings = new Map<string, unknown>();
  const http = new HttpClient({
    baseUrl: 'http://core.test',
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const body = JSON.parse((init?.body?.toString() ?? '{}'));
      if (url.startsWith('http://core.test/projects/p1/relations') && method === 'POST') {
        return jsonResponse({ ok: true, value: { id: 'rel-h', projectId: 'p1', sourceEntityType: 'artifact', sourceEntityId: 'a1', targetEntityType: 'artifact', targetEntityId: 'a2', kind: 'references', createdAt: 't', updatedAt: 't' }, meta: { changeSetId: 'cs-h' } });
      }
      if (url.includes('/spatial/bindings')) {
        const key = `${body.canvasId ?? ''}|${body.spatialKind ?? ''}|${body.entityType ?? ''}|${body.entityId ?? ''}`;
        if (method === 'GET') return jsonResponse({ ok: true, value: [...storedBindings.values()] });
        if (method === 'PUT') { storedBindings.set(key + '|' + body.spatialId, body); return jsonResponse({ ok: true, value: body }); }
        if (method === 'DELETE') { for (const k of [...storedBindings.keys()]) if (k.startsWith(`${body.canvasId}|${body.spatialKind}|${body.entityType}|${body.entityId}`)) storedBindings.delete(k); return jsonResponse({ ok: true, value: null }); }
      }
      return jsonResponse({ ok: true, value: [] });
    },
  });

  const rfs = makeRfs((body) => {
    const type = cmdType(body);
    if (type === 'CREATE_NODES') {
      const created = (body as { commands: { nodes: unknown[] }[] }).commands[0].nodes.map(() => ({ nodeId: `node-${Math.random().toString(36).slice(2, 8)}` }));
      return jsonResponse(createdResponse(created));
    }
    if (type === 'CONNECT_NODES') return jsonResponse(createdResponse(undefined, [{ edgeId: `edge-${Math.random().toString(36).slice(2, 8)}` }]));
    return jsonResponse({});
  });

  const host = new Gen2Host({ http, rfs, projectId: 'p1' });
  // Seed node bindings through the same store the facade uses (persists over Core mock).
  await host.bindings.bind({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'node-a', entityType: 'artifact', entityId: 'a1' });
  await host.bindings.bind({ projectId: 'p1', canvasId: CANVAS, spatialKind: 'node', spatialId: 'node-b', entityType: 'artifact', entityId: 'a2' });

  const result = await host.connect({ entityType: 'artifact', entityId: 'a1' }, { entityType: 'artifact', entityId: 'a2' }, 'references');
  assert.equal(result.relationId, 'rel-h');
  assert.equal(result.changeSetId, 'cs-h');
  assert.ok(result.edgeBinding?.spatialId, 'edge binding returned');
  assert.equal(await host.nodeIdFor('artifact', 'a1'), 'node-a');
});
