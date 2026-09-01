import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HuabuRfsClient, RfsContractError } from '../src/spatial/huabuRfsClient.js';
import type { RfsCapabilitiesResponse, RfsExecuteResponse } from '../src/spatial/types.js';

const BASE = 'http://huabu.test';
const CANVAS = 'c1';

const CAPABILITIES: RfsCapabilitiesResponse = {
  protocolVersion: 2,
  permissions: { read: true, write: true },
  execution: { atomic: false, partialCommit: true, idempotent: false, runIdIsIdempotencyKey: false },
  limits: { queryDefault: 50, queryMax: 200, searchDefault: 200, searchMax: 2000, executeMaxCommands: 50, snapshotMaxNodes: 50 },
  queryTypes: ['GET_SPACE_OUTLINE', 'INSPECT_NODES', 'INSPECT_EDGES', 'SEARCH', 'SNAPSHOT_NODES'],
  commandTypes: ['CREATE_NODES', 'DELETE_NODES', 'MERGE_NODE_DATA', 'SET_NODE_PARENT', 'DISSOLVE_FRAME', 'SET_NODE_GEOMETRY', 'REORDER_NODES', 'CONNECT_NODES', 'DISCONNECT_EDGES', 'SET_EDGE_STYLE', 'ALIGN_NODES', 'DISTRIBUTE_NODES', 'SET_FRAME_LAYOUT', 'SET_PORTAL_NODE_PINS'],
  links: { skill: '', query: '', execute: '', queryCapabilityTemplate: '', commandCapabilityTemplate: '' },
};

const OUTLINE = {
  type: 'GET_SPACE_OUTLINE',
  result: {
    version: 1,
    bbox: null,
    nodes: [],
    edges: [],
    spatial: { clusters: [] },
  },
};

function createdResponse(type: string, extra: Partial<RfsExecuteResponse> = {}): RfsExecuteResponse {
  return {
    canvasId: CANVAS,
    runId: 'run-1',
    fromVersion: 0,
    toVersion: 1,
    commands: [],
    results: [{ index: 0, type, applied: true }],
    revisions: [],
    affected: { nodeIds: [], edgeIds: [], deletedNodeIds: [], deletedEdgeIds: [] },
    ...extra,
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

interface CapturedRequest {
  url: string;
  method: string;
  body?: unknown;
}

function makeRfs(router: (req: CapturedRequest) => Response) {
  const captured: CapturedRequest[] = [];
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init?.method ?? 'GET';
    const bodyText = init?.body?.toString() ?? '';
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    captured.push({ url, method, body });
    return router({ url, method, body });
  };
  const client = new HuabuRfsClient({ canvasId: CANVAS, baseUrl: BASE, bearerToken: 'tok', fetch: fetchMock });
  return { client, captured };
}

test('capabilities: reads protocolVersion from capabilities endpoint', async () => {
  const { client } = makeRfs((req) => {
    assert.equal(req.url, `${BASE}/api/rfs/${CANVAS}/capabilities`);
    return jsonResponse(CAPABILITIES);
  });
  const caps = await client.capabilities();
  assert.equal(caps.protocolVersion, 2);
  assert.equal(caps.execution.partialCommit, true);
  assert.equal(caps.execution.atomic, false);
});

test('assertProtocol: passes on protocolVersion 2 and fails fast on mismatch', async () => {
  const ok = makeRfs(() => jsonResponse(CAPABILITIES));
  await ok.client.assertProtocol();

  const bad = makeRfs(() => jsonResponse({ ...CAPABILITIES, protocolVersion: 3 }));
  await assert.rejects(() => bad.client.assertProtocol(), RfsContractError);
});

test('GET_SPACE_OUTLINE: POSTs the query body; parsed from discriminated {type,result} envelope', async () => {
  const { client } = makeRfs((req) => {
    assert.equal(req.url, `${BASE}/api/rfs/${CANVAS}/query`);
    assert.deepEqual(req.body, { type: 'GET_SPACE_OUTLINE' });
    return jsonResponse(OUTLINE);
  });
  const res = await client.query({ type: 'GET_SPACE_OUTLINE' });
  assert.equal(res.type, 'GET_SPACE_OUTLINE');
  assert.ok(res.result);
  assert.ok(Array.isArray(res.result.nodes));
});

test('outline(): convenience wrapper returns outline result', async () => {
  const { client } = makeRfs(() => jsonResponse(OUTLINE));
  const res = await client.outline();
  assert.equal(res.type, 'GET_SPACE_OUTLINE');
  assert.ok(res.result);
});

test('CREATE_NODES: sends nodeType+data+position+size, no geometry/lcos; extracts results[0].nodes[0].nodeId', async () => {
  const { client, captured } = makeRfs((req) => {
    assert.equal(req.url, `${BASE}/api/rfs/${CANVAS}/execute`);
    const cmd = (req.body as { commands: { type: string }[] }).commands[0];
    assert.equal(cmd.type, 'CREATE_NODES');
    return jsonResponse(createdResponse('CREATE_NODES', {
      results: [{ index: 0, type: 'CREATE_NODES', applied: true, nodes: [{ nodeId: 'n1', width: 280, height: 220 }], },],
      affected: { nodeIds: ['n1'], edgeIds: [], deletedNodeIds: [], deletedEdgeIds: [] },
    }));
  });

  const res = await client.execute([
    { type: 'CREATE_NODES', nodes: [{ nodeType: 'note', data: { label: 'hello' }, position: { x: 0, y: 0 }, size: { width: 280, height: 220 } }] },
  ]);

  const outgoing = (captured[0]?.body as { commands: { nodes: Record<string, unknown> }[] }).commands[0].nodes[0];
  assert.equal(outgoing.nodeType, 'nodeType' in outgoing ? outgoing.nodeType : 'note');
  assert.equal(outgoing.nodeType, 'note');
  assert.ok(outgoing.position);
  assert.ok(outgoing.size);
  assert.equal('geometry' in outgoing, false);
  const data = outgoing.data as { lcos?: unknown; label?: string };
  assert.equal(data.lcos, undefined);

  assert.equal(HuabuRfsClient.firstCreatedNodeId(res), 'n1');
});

test('SET_NODE_GEOMETRY: sends items[] and treats applied=true as success', async () => {
  const { client, captured } = makeRfs((req) => {
    const cmd = (req.body as { commands: { type: string }[] }).commands[0];
    assert.equal(cmd.type, 'SET_NODE_GEOMETRY');
    return jsonResponse(createdResponse('SET_NODE_GEOMETRY'));
  });
  const res = await client.execute([
    { type: 'SET_NODE_GEOMETRY', items: [{ nodeId: 'n1', position: { x: 10, y: 20 } }] },
  ]);
  const outgoing = (captured[0]?.body as { commands: { items: { nodeId: string; position: { x: number; y: number } }[] }[] }).commands[0].items[0];
  assert.equal(outgoing.nodeId, 'n1');
  assert.deepEqual(outgoing.position, { x: 10, y: 20 });
  assert.equal(res.results?.[0]?.applied, true);
});

test('CONNECT_NODES: sends edges[] and extracts results[0].edges[0].edgeId', async () => {
  const { client } = makeRfs((req) => {
    const cmd = (req.body as { commands: { type: string }[] }).commands[0];
    assert.equal(cmd.type, 'CONNECT_NODES');
    return jsonResponse(createdResponse('CONNECT_NODES', {
      results: [{ index: 0, type: 'CONNECT_NODES', applied: true, edges: [{ edgeId: 'e1', source: 'a', target: 'b' }] }],
      affected: { nodeIds: [], edgeIds: ['e1'], deletedNodeIds: [], deletedEdgeIds: [] },
    }));
  });
  const res = await client.execute([
    { type: 'CONNECT_NODES', edges: [{ source: 'a', target: 'b', style: { lineType: 'bezier', direction: 'forward', label: 'references' } }] },
  ]);
  assert.equal(HuabuRfsClient.firstCreatedEdgeId(res), 'e1');
});

test('DISCONNECT_EDGES: sends edges[] (CanvasEdgeRef) and applied=true is success', async () => {
  const { client } = makeRfs((req) => {
    const cmd = (req.body as { commands: { type: string; edges: unknown }[] }).commands[0];
    assert.equal(cmd.type, 'DISCONNECT_EDGES');
    assert.ok(Array.isArray(cmd.edges));
    return jsonResponse(createdResponse('DISCONNECT_EDGES'));
  });
  const res = await client.execute([{ type: 'DISCONNECT_EDGES', edges: ['e1'] }]);
  assert.equal(res.results?.[0]?.applied, true);
});

test('partial commit: HTTP 200 but applied=false is a contract failure', async () => {
  const failing = makeRfs(() =>
    jsonResponse(createdResponse('CREATE_NODES', {
      results: [{ index: 0, type: 'CREATE_NODES', applied: false, reason: 'not-found' }],
    })),
  );
  await assert.rejects(() => failing.client.execute([{ type: 'CREATE_NODES', nodes: [{ nodeType: 'note', data: { label: 'x' }, position: { x: 0, y: 0 } }] }]), RfsContractError);

  const relaxed = makeRfs(() =>
    jsonResponse(createdResponse('CREATE_NODES', {
      results: [{ index: 0, type: 'CREATE_NODES', applied: false, reason: 'not-found' }],
    })),
  );
  const res = await relaxed.client.executeRelaxed([{ type: 'CREATE_NODES', nodes: [{ nodeType: 'note', position: { x: 0, y: 0 } }] }]);
  assert.equal(res.results?.[0]?.applied, false);
});

test('execute(): passes through a real applied=true create result cleanly', async () => {
  const { client } = makeRfs((req) => {
    assert.equal(req.url, `${BASE}/api/rfs/${CANVAS}/execute`);
    return jsonResponse(createdResponse('CREATE_NODES', {
      results: [{ index: 0, type: 'CREATE_NODES', applied: true, nodes: [{ nodeId: 'n9', width: 100, height: 100 }] }],
      affected: { nodeIds: ['n9'], edgeIds: [], deletedNodeIds: [], deletedEdgeIds: [] },
    }));
  });
  const res = await client.execute([
    { type: 'CREATE_NODES', nodes: [{ nodeType: 'note', position: { x: 0, y: 0 } }] },
  ]);
  assert.equal(res.results?.[0]?.applied, true);
  assert.equal(HuabuRfsClient.firstCreatedNodeId(res), 'n9');
});
