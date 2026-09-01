#!/usr/bin/env node
// G0.8a real dual-system E2E: Core artifact -> Huabu node -> Core relation ->
// Huabu edge -> RESTART -> binding/node/edge all still consistent.
// Requires:
//   - a running Local Core (LCOS_CORE_URL/LCOS_CORE_TOKEN)
//   - a running Huabu RFS headless server (HUABU_RFS_URL/HUABU_RFS_TOKEN/CANVAS_ID)
//   - PROJECT_ID pointing at a DISPOSABLE fixture project (never a real one)
// The script cleans up everything it creates (relation/edge/node/binding) in a
// finally block, so it never leaves test residue behind.

import { HttpClient } from '../apps/web-gen2/src/backend/client.js';
import { CoreProjectClient } from '../apps/web-gen2/src/backend/projects.js';
import { CoreRelationClient } from '../apps/web-gen2/src/backend/relations.js';
import { createProjectionBindingRegistry } from '../apps/web-gen2/src/backend/sqliteBindingStore.js';
import { HuabuRfsClient } from '../apps/web-gen2/src/spatial/huabuRfsClient.js';
import { ProjectToSpaceProjection } from '../apps/web-gen2/src/spatial/projectToSpaceProjection.js';
import { RelationProjection } from '../apps/web-gen2/src/spatial/relationProjection.js';

const CORE_URL = process.env.LCOS_CORE_URL ?? 'http://127.0.0.1:43130';
const CORE_TOKEN = process.env.LCOS_CORE_TOKEN ?? 'g08a-smoke-token';
const RFS_URL = process.env.HUABU_RFS_URL ?? 'http://127.0.0.1:43310';
const RFS_TOKEN = process.env.HUABU_RFS_TOKEN ?? 'g08a-smoke-token';
const CANVAS_ID = process.env.CANVAS_ID ?? 'disposable-canvas-b';
const PROJECT_ID = process.env.PROJECT_ID;

function coreHttp() { return new HttpClient({ baseUrl: CORE_URL, token: CORE_TOKEN }); }
function rfsClient() { return new HuabuRfsClient({ canvasId: CANVAS_ID, baseUrl: RFS_URL, bearerToken: RFS_TOKEN }); }

let relId;
let nodeA;
let nodeB;
let edgeId;
const bindingKeys = [];

async function main() {
  if (!PROJECT_ID) throw new Error('PROJECT_ID is required — point it at a DISPOSABLE fixture project.');
  const projects = new CoreProjectClient(coreHttp());
  const project = (await projects.listProjects()).find((p) => p.id === PROJECT_ID);
  if (!project) throw new Error(`PROJECT_ID ${PROJECT_ID} not found`);
  if (process.env.REQUIRE_DISPOSABLE === '1') {
    const target = String(project.id ?? project.name ?? '').toLowerCase();
    if (!target.includes('disposable')) {
      throw new Error(`PROJECT_ID ${PROJECT_ID} is not disposable (id="${project.id}" name="${project.name}"). Refusing to write to a real project.`);
    }
  }
  console.log(`✔ fixture=${project.name} (${PROJECT_ID}) canvas=${CANVAS_ID}`);

  const graph = await projects.getProjectGraph(PROJECT_ID);
  if (!graph) throw new Error('no graph');
  const artifacts = Array.isArray(graph.artifacts) ? graph.artifacts : [];
  const ids = artifacts
    .map((a) => (a && typeof a === 'object' && 'id' in a ? String(a.id) : undefined))
    .filter((id) => typeof id === 'string');
  if (ids.length < 2) throw new Error(`need >=2 artifacts, got ${ids.length}`);
  const a1 = ids[0];
  const a2 = ids[1];
  console.log(`✔ artifacts=${a1} -> ${a2}`);

  // ---------- Phase 1: Core artifact -> Huabu node -> Core relation -> Huabu edge ----------
  const reg1 = createProjectionBindingRegistry(coreHttp(), PROJECT_ID);
  const nodeProjector1 = new ProjectToSpaceProjection(rfsClient(), reg1);
  const relationProjector1 = new RelationProjection(rfsClient(), { async createRelation() { return { id: 'unused' }; }, async deleteRelation() {} }, reg1, PROJECT_ID);

  const nodeBindings = await nodeProjector1.projectArtifacts([
    { projectId: PROJECT_ID, artifactId: a1, kind: 'text', title: a1 },
    { projectId: PROJECT_ID, artifactId: a2, kind: 'image', title: a2 },
  ]);
  nodeA = nodeBindings[0].spatialId;
  nodeB = nodeBindings[1].spatialId;
  bindingKeys.push(`${nodeA}|${a1}`, `${nodeB}|${a2}`);
  console.log(`✔ projected nodes ${nodeA} ${nodeB}`);

  const relations = new CoreRelationClient(coreHttp());
  const created = await relations.createRelation(PROJECT_ID, {
    sourceEntityType: 'artifact', sourceEntityId: a1,
    targetEntityType: 'artifact', targetEntityId: a2, kind: 'references',
  });
  relId = created.relation.id;
  console.log(`✔ created Core relation ${relId} (changeSet=${created.changeSetId})`);

  await relationProjector1.reconcileRelationEdge({ id: relId, kind: 'references', from: { entityType: 'artifact', entityId: a1 }, to: { entityType: 'artifact', entityId: a2 } }, nodeA, nodeB);
  const edgeB1 = await reg1.findEdge(PROJECT_ID, CANVAS_ID, relId);
  if (!edgeB1) throw new Error('phase1: relation edge binding missing');
  edgeId = edgeB1.spatialId;
  bindingKeys.push(`${edgeId}|${relId}`);
  console.log(`✔ projected Huabu edge ${edgeId}`);

  const phase1Count = (await reg1.list()).length;
  console.log(`✔ phase1 persisted bindings in Core SQLite=${phase1Count}`);
  console.log('--- RESTART: instantiate fresh clients/registry/projectors ---');

  // ---------- Phase 2: fresh clients read Core SQLite + Huabu, verify consistency ----------
  const reg2 = createProjectionBindingRegistry(coreHttp(), PROJECT_ID);
  const nodeProjector2 = new ProjectToSpaceProjection(rfsClient(), reg2);
  const relationProjector2 = new RelationProjection(rfsClient(), { async createRelation() { return { id: 'unused' }; }, async deleteRelation() {} }, reg2, PROJECT_ID);

  const nodeBindings2 = await nodeProjector2.projectArtifacts([
    { projectId: PROJECT_ID, artifactId: a1, kind: 'text', title: a1 },
    { projectId: PROJECT_ID, artifactId: a2, kind: 'image', title: a2 },
  ]);
  if (nodeBindings2[0].spatialId !== nodeA || nodeBindings2[1].spatialId !== nodeB) throw new Error('phase2: node ids changed after restart (binding lost or new node created)');
  console.log('✔ phase2: node bindings reused after restart (no duplicate nodes)');

  const relations2 = new CoreRelationClient(coreHttp());
  const relAfter = (await relations2.listRelations(PROJECT_ID)).find((r) => String(r.id) === String(relId));
  if (!relAfter) throw new Error('phase2: Core relation was not persisted');
  await relationProjector2.reconcileRelationEdge({ id: relAfter.id, kind: 'references', from: { entityType: 'artifact', entityId: a1 }, to: { entityType: 'artifact', entityId: a2 } }, nodeA, nodeB);
  const edgeB2 = await reg2.findEdge(PROJECT_ID, CANVAS_ID, relId);
  if (!edgeB2 || edgeB2.spatialId !== edgeId) throw new Error('phase2: relation edge binding lost/changed after restart');
  console.log('✔ phase2: relation edge binding reused after restart (same edgeId)');

  const bindings2 = await reg2.list();
  const nodeBindings2Expected = bindings2.filter((b) => b.spatialKind === 'node' && b.entityType === 'artifact').length;
  if (nodeBindings2Expected !== 2) throw new Error(`phase2: expected 2 artifact node bindings, got ${nodeBindings2Expected}`);
  console.log(`✔ phase2: Core SQLite holds ${bindings2.length} bindings (persistent, not memory)`);

  const rfs2 = rfsClient();
  const nodes = await rfs2.query({ type: 'INSPECT_NODES', ids: [nodeA, nodeB] });
  if (nodes.type !== 'INSPECT_NODES' || nodes.result.nodes.length !== 2) throw new Error('phase2: Huabu nodes missing');
  const edges = await rfs2.query({ type: 'INSPECT_EDGES', ids: [edgeId] });
  if (edges.type !== 'INSPECT_EDGES' || edges.result.edges.length !== 1) throw new Error('phase2: Huabu edge missing');
  console.log('✔ phase2: Huabu nodes + edge still present');

  console.log('=== G0.8a FULL-CLOSURE SMOKE PASSED ===');
}

async function cleanup() {
  try {
    const reg = createProjectionBindingRegistry(coreHttp(), PROJECT_ID);
    const rfs = rfsClient();
    if (edgeId) await rfs.execute([{ type: 'DISCONNECT_EDGES', edges: [edgeId] }]);
    if (nodeA || nodeB) await rfs.execute([{ type: 'DELETE_NODES', nodeIds: [nodeA, nodeB].filter(Boolean) }]);
    for (const key of bindingKeys) {
      const [spatialId, entityId] = key.split('|');
      if (spatialId.startsWith('node-')) await reg.unbindByEntity(PROJECT_ID, CANVAS_ID, 'node', 'artifact', entityId);
      else await reg.unbindByEntity(PROJECT_ID, CANVAS_ID, 'edge', 'relation', entityId);
    }
    if (relId) await new CoreRelationClient(coreHttp()).deleteRelation(PROJECT_ID, relId);
    console.log('✔ cleanup: disconnected edge, deleted nodes, removed bindings, deleted relation');
  } catch (err) {
    console.error(`✗ cleanup issue: ${err instanceof Error ? err.message : String(err)}`);
  }
}

main()
  .catch((err) => { console.error(`✗ ${err instanceof Error ? err.stack ?? err.message : String(err)}`); process.exitCode = 1; })
  .finally(async () => { await cleanup(); });
