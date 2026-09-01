#!/usr/bin/env node
// LCOS Gen2 G0 RFS smoke — the single entrypoint for `npm run g0:smoke`.
//
// Proves LCOS Gen2 RFS adapter <-> real Huabu, independent of LCOS Core.
// It speaks the exact protocol v2 contract surface the `web-gen2`
// HuabuRfsClient uses (capabilities/query/execute, {type,result} envelope,
// results[].applied, results[].nodes[].nodeId, results[].edges[].edgeId).
//
// Env:
//   HUABU_RFS_URL  full RFS base incl canvas, e.g. http://127.0.0.1:3001/api/rfs/canvas-xxx
//   AGENTLET_TOKEN Bearer token accepted by the Huabu RFS gate.
//
// Any step failing exits non-zero. Uses a unique disposable label per node and
// cleans up in `finally`.

const RFS_URL = process.env.HUABU_RFS_URL;
const TOKEN = process.env.AGENTLET_TOKEN;

if (!RFS_URL) {
  console.error('g0:smoke: HUABU_RFS_URL is required (e.g. http://127.0.0.1:3001/api/rfs/canvas-xxx)');
  process.exit(2);
}

const REQUIRED_QUERIES = ['GET_SPACE_OUTLINE', 'INSPECT_NODES', 'INSPECT_EDGES'];
const REQUIRED_COMMANDS = ['CREATE_NODES', 'DELETE_NODES', 'SET_NODE_GEOMETRY', 'CONNECT_NODES', 'DISCONNECT_EDGES'];

let createdNodeIds = [];

function fail(msg) {
  console.error(`\n✗ g0:smoke failed: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function request(method, path, body) {
  const res = await fetch(`${RFS_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN ?? ''}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    fail(`${method} ${path} -> HTTP ${res.status} ${text || ''}`);
  }
  return data;
}

function check(cond, msg) {
  if (!cond) fail(msg);
}

function step(name) {
  process.stdout.write(`  → ${name} ... `);
  const t0 = Date.now();
  return (extra = '') => {
    process.stdout.write(`ok${extra ? ` (${extra})` : ''} (${Date.now() - t0}ms)\n`);
  };
}

async function run() {
  // 1-3) capabilities + protocol + read/write + required types
  const s1 = step('capabilities');
  const caps = await request('GET', '/capabilities');
  check(caps && caps.protocolVersion === 2, `expected protocolVersion=2, got ${caps?.protocolVersion}`);
  check(caps.permissions?.read === true && caps.permissions?.write === true, 'capabilities should allow read+write');
  const qtypes = caps.queryTypes ?? [];
  const ctypes = caps.commandTypes ?? [];
  for (const q of REQUIRED_QUERIES) check(qtypes.includes(q), `capabilities missing query ${q}`);
  for (const c of REQUIRED_COMMANDS) check(ctypes.includes(c), `capabilities missing command ${c}`);
  s1(`protocolVersion=2, queries=${qtypes.length}, commands=${ctypes.length}`);

  // 4) GET_SPACE_OUTLINE
  const s2 = step('GET_SPACE_OUTLINE');
  const outline = await request('POST', '/query', { type: 'GET_SPACE_OUTLINE' });
  check(outline?.type === 'GET_SPACE_OUTLINE' && outline?.result, 'GET_SPACE_OUTLINE should return {type,result} envelope');
  s2(`nodes=${outline.result.nodes.length}`);

  // 5) CREATE disposable note A
  const labelA = `lcos-g0-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s3 = step('CREATE_NODES A');
  const createA = await request('POST', '/execute', {
    commands: [
      {
        type: 'CREATE_NODES',
        nodes: [{ nodeType: 'note', data: { label: labelA }, position: { x: 0, y: 0 }, size: { width: 280, height: 220 } }],
      },
    ],
  });
  const nodeA = createA?.results?.[0]?.nodes?.[0]?.nodeId;
  check(createA?.results?.[0]?.applied === true, `CREATE_NODES A not applied: ${JSON.stringify(createA?.results?.[0])}`);
  check(typeof nodeA === 'string' && nodeA.length > 0, 'CREATE_NODES A did not return results[0].nodes[0].nodeId');
  createdNodeIds.push(nodeA);
  s3(nodeA);

  // 6) INSPECT_NODES verify A exists
  const s4 = step('INSPECT_NODES A');
  const inspectA = await request('POST', '/query', { type: 'INSPECT_NODES', ids: [nodeA] });
  check(inspectA?.type === 'INSPECT_NODES', 'INSPECT_NODES should return {type,result} envelope');
  check(inspectA?.result?.nodes?.some((n) => n.id === nodeA), `INSPECT_NODES did not find ${nodeA}`);
  s4(`count=${inspectA.result.count}`);

  // 7) SET_NODE_GEOMETRY A
  const s5 = step('SET_NODE_GEOMETRY A');
  const setGeo = await request('POST', '/execute', {
    commands: [{ type: 'SET_NODE_GEOMETRY', items: [{ nodeId: nodeA, position: { x: 120, y: 80 } }] }],
  });
  check(setGeo?.results?.[0]?.applied === true, `SET_NODE_GEOMETRY not applied: ${JSON.stringify(setGeo?.results?.[0])}`);
  s5();

  // 8) INSPECT verify position
  const s6 = step('INSPECT position A');
  const inspectA2 = await request('POST', '/query', { type: 'INSPECT_NODES', ids: [nodeA] });
  const node = inspectA2?.result?.nodes?.find((n) => n.id === nodeA);
  check(node && node.position?.x === 120 && node.position?.y === 80, `position not persisted for ${nodeA}: ${JSON.stringify(node?.position)}`);
  s6(`x=${node.position.x},y=${node.position.y}`);

  // 9) CREATE disposable note B
  const labelB = `lcos-g0-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s7 = step('CREATE_NODES B');
  const createB = await request('POST', '/execute', {
    commands: [{ type: 'CREATE_NODES', nodes: [{ nodeType: 'note', data: { label: labelB }, position: { x: 320, y: 80 }, size: { width: 280, height: 220 } }] }],
  });
  const nodeB = createB?.results?.[0]?.nodes?.[0]?.nodeId;
  check(createB?.results?.[0]?.applied === true && typeof nodeB === 'string', 'CREATE_NODES B did not return a nodeId');
  createdNodeIds.push(nodeB);
  s7(nodeB);

  // 10) CONNECT A->B
  const s8 = step('CONNECT_NODES A->B');
  const connect = await request('POST', '/execute', {
    commands: [{ type: 'CONNECT_NODES', edges: [{ source: nodeA, target: nodeB, style: { lineType: 'bezier', direction: 'forward', label: 'lcos-g0-smoke' } }] }],
  });
  const edgeId = connect?.results?.[0]?.edges?.[0]?.edgeId;
  check(connect?.results?.[0]?.applied === true && typeof edgeId === 'string', `CONNECT_NODES did not return an edgeId: ${JSON.stringify(connect?.results?.[0])}`);
  s8(edgeId);

  // 11) INSPECT_EDGES verify real edge
  const s9 = step('INSPECT_EDGES');
  const inspectEdges = await request('POST', '/query', { type: 'INSPECT_EDGES', connectedTo: nodeA });
  check(inspectEdges?.type === 'INSPECT_EDGES', 'INSPECT_EDGES should return {type,result} envelope');
  check(inspectEdges?.result?.edges?.some((e) => e.id === edgeId), `INSPECT_EDGES did not find edge ${edgeId}`);
  s9(`edges=${inspectEdges.result.edges.length}`);

  // 12) DISCONNECT edge
  const s10 = step('DISCONNECT_EDGES');
  const disconnect = await request('POST', '/execute', { commands: [{ type: 'DISCONNECT_EDGES', edges: [edgeId] }] });
  check(disconnect?.results?.[0]?.applied === true, `DISCONNECT_EDGES not applied: ${JSON.stringify(disconnect?.results?.[0])}`);
  s10();

  // 13) DELETE A/B
  const s11 = step('DELETE_NODES A/B');
  const del = await request('POST', '/execute', { commands: [{ type: 'DELETE_NODES', nodeIds: [nodeA, nodeB] }] });
  check(del?.results?.[0]?.applied === true, `DELETE_NODES not applied: ${JSON.stringify(del?.results?.[0])}`);
  createdNodeIds = createdNodeIds.filter((id) => id !== nodeA && id !== nodeB);
  s11();

  // 14) final inspect verifies cleanup
  const s12 = step('INSPECT cleanup');
  const inspectFinal = await request('POST', '/query', { type: 'INSPECT_NODES', ids: [nodeA, nodeB] });
  check(inspectFinal?.type === 'INSPECT_NODES', 'final INSPECT_NODES should return {type,result} envelope');
  const remaining = inspectFinal?.result?.nodes?.filter((n) => n.id === nodeA || n.id === nodeB) ?? [];
  check(remaining.length === 0, `cleanup failed: still present ${remaining.map((n) => n.id).join(',')}`);
  s12('clean');

  console.log('\n✓ g0:smoke passed: real Huabu RFS contract validated.');
}

run().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
}).finally(async () => {
  // best-effort cleanup
  if (createdNodeIds.length > 0) {
    try {
      await request('POST', '/execute', { commands: [{ type: 'DELETE_NODES', nodeIds: createdNodeIds }] });
      console.error(`  cleanup: deleted ${createdNodeIds.join(', ')}`);
    } catch {
      console.error(`  cleanup: could not delete ${createdNodeIds.join(', ')}`);
    }
  }
});
