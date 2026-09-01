#!/usr/bin/env node
// G0.8 real dual-system E2E: Core artifact -> Huabu node -> Core relation ->
// Huabu edge -> RESTART -> binding/node/edge all still consistent.
// Requires a running Local Core (LCOS_CORE_URL/LCOS_CORE_TOKEN) and a running
// Huabu RFS headless server (HUABU_RFS_URL/HUABU_RFS_TOKEN/CANVAS_ID). PROJECT_ID
// is optional (defaults to the first project).

import { HttpClient } from '../apps/web-gen2/src/backend/client.js';
import { CoreProjectClient } from '../apps/web-gen2/src/backend/projects.js';
import { CoreRelationClient } from '../apps/web-gen2/src/backend/relations.js';
import { createProjectionBindingRegistry } from '../apps/web-gen2/src/backend/sqliteBindingStore.js';
import { HuabuRfsClient } from '../apps/web-gen2/src/spatial/huabuRfsClient.js';
import { ProjectToSpaceProjection } from '../apps/web-gen2/src/spatial/projectToSpaceProjection.js';
import { RelationProjection } from '../apps/web-gen2/src/spatial/relationProjection.js';

const CORE_URL = process.env.LCOS_CORE_URL ?? 'http://127.0.0.1:43130';
const CORE_TOKEN = process.env.LCOS_CORE_TOKEN ?? 'g08-smoke-token';
const RFS_URL = process.env.HUABU_RFS_URL ?? 'http://127.0.0.1:43310';
const RFS_TOKEN = process.env.HUABU_RFS_TOKEN ?? 'g08-smoke-token';
const CANVAS_ID = process.env.CANVAS_ID ?? 'smoke-canvas-a';

function fail(msg) { console.error(`✗ ${msg}`); process.exitCode = 1; }
function ok(msg) { console.log(`✓ ${msg}`); }

function coreHttp() { return new HttpClient({ baseUrl: CORE_URL, token: CORE_TOKEN }); }
function rfsClient() { return new HuabuRfsClient({ canvasId: CANVAS_ID, baseUrl: RFS_URL, bearerToken: RFS_TOKEN }); }

async function pickTwoArtifacts(projectId) {
  const projects = new CoreProjectClient(coreHttp());
  const graph = await projects.getProjectGraph(projectId);
  if (!graph) throw new Error('no graph');
  const artifacts = Array.isArray(graph.artifacts) ? graph.artifacts : [];
  const ids = artifacts
    .map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' && 'id' in a ? String(a.id) : undefined))
    .filter((id) => typeof id === 'string');
  if (ids.length < 2) throw new Error(`need >=2 artifacts, got ${ids.length}`);
  return { a1: ids[0], a2: ids[1] };
}

async function main() {
  const projects = new CoreProjectClient(coreHttp());
  const projectId = process.env.PROJECT_ID ?? (await projects.listProjects())[0]?.id;
  if (!projectId) throw new Error('no project');
  ok(`project=${projectId} canvas=${CANVAS_ID}`);

  const { a1, a2 } = await pickTwoArtifacts(projectId);
  ok(`artifacts=${a1} -> ${a2}`);

  // ---------- Phase 1: Core artifact -> Huabu node -> Core relation -> Huabu edge ----------
  const reg1 = createProjectionBindingRegistry(coreHttp(), projectId);
  const nodeProjector1 = new ProjectToSpaceProjection(rfsClient(), reg1);
  const relationProjector1 = new RelationProjection(rfsClient(), { async createRelation() { return { id: 'unused' }; }, async deleteRelation() {} }, reg1, projectId);

  const nodeBindings = await nodeProjector1.projectArtifacts([
    { projectId, artifactId: a1, kind: 'text', title: a1 },
    { projectId, artifactId: a2, kind: 'text', title: a2 },
  ]);
  const nodeA = nodeBindings[0].spatialId;
  const nodeB = nodeBindings[1].spatialId;
  ok(`projected nodes ${nodeA} ${nodeB}`);

  const relations = new CoreRelationClient(coreHttp());
  const created = await relations.createRelation(projectId, {
    sourceEntityType: 'artifact', sourceEntityId: a1,
    targetEntityType: 'artifact', targetEntityId: a2, kind: 'references',
  });
  const relId = created.relation.id;
  ok(`created Core relation ${relId} (changeSet=${created.changeSetId})`);

  await relationProjector1.reconcileRelationEdge({ id: relId, kind: 'references', from: { entityType: 'artifact', entityId: a1 }, to: { entityType: 'artifact', entityId: a2 } }, nodeA, nodeB);
  const edgeB1 = await reg1.findEdge(projectId, CANVAS_ID, relId);
  if (!edgeB1) throw new Error('phase1: relation edge binding missing');
  ok(`projected Huabu edge ${edgeB1.spatialId}`);

  const phase1Count = (await reg1.list()).length;
  ok(`phase1 persisted bindings in Core SQLite=${phase1Count}`);
  console.log('--- RESTART: instantiate fresh clients/registry/projectors ---');

  // ---------- Phase 2: fresh clients read Core SQLite + Huabu, verify consistency ----------
  const reg2 = createProjectionBindingRegistry(coreHttp(), projectId);   // loads from Core SQLite
  const nodeProjector2 = new ProjectToSpaceProjection(rfsClient(), reg2);
  const relationProjector2 = new RelationProjection(rfsClient(), { async createRelation() { return { id: 'unused' }; }, async deleteRelation() {} }, reg2, projectId);

  const nodeBindings2 = await nodeProjector2.projectArtifacts([
    { projectId, artifactId: a1, kind: 'text', title: a1 },
    { projectId, artifactId: a2, kind: 'text', title: a2 },
  ]);
  if (nodeBindings2[0].spatialId !== nodeA || nodeBindings2[1].spatialId !== nodeB) throw new Error('phase2: node ids changed after restart (binding lost or new node created)');
  ok('phase2: node bindings reused after restart (no duplicate nodes)');

  const relations2 = new CoreRelationClient(coreHttp());
  const relAfter = (await relations2.listRelations(projectId)).find((r) => String(r.id) === String(relId));
  if (!relAfter) throw new Error('phase2: Core relation was not persisted');
  await relationProjector2.reconcileRelationEdge({ id: relAfter.id, kind: 'references', from: { entityType: 'artifact', entityId: a1 }, to: { entityType: 'artifact', entityId: a2 } }, nodeA, nodeB);
  const edgeB2 = await reg2.findEdge(projectId, CANVAS_ID, relId);
  if (!edgeB2 || edgeB2.spatialId !== edgeB1.spatialId) throw new Error('phase2: relation edge binding lost/changed after restart');
  ok('phase2: relation edge binding reused after restart (same edgeId)');

  const bindings2 = await reg2.list();
  const nodeBindings2Expected = bindings2.filter((b) => b.spatialKind === 'node' && b.entityType === 'artifact').length;
  if (nodeBindings2Expected !== 2) throw new Error(`phase2: expected 2 artifact node bindings, got ${nodeBindings2Expected}`);
  ok(`phase2: Core SQLite holds ${bindings2.length} bindings (persistent, not memory)`);

  // Verify Huabu actually still has the nodes + edge.
  const rfs2 = rfsClient();
  const nodes = await rfs2.query({ type: 'INSPECT_NODES', ids: [nodeA, nodeB] });
  if (nodes.type !== 'INSPECT_NODES' || nodes.result.nodes.length !== 2) throw new Error('phase2: Huabu nodes missing');
  const edges = await rfs2.query({ type: 'INSPECT_EDGES', ids: [edgeB1.spatialId] });
  if (edges.type !== 'INSPECT_EDGES' || edges.result.edges.length !== 1) throw new Error('phase2: Huabu edge missing');
  ok('phase2: Huabu nodes + edge still present');

  console.log('=== G0.8 FULL-CLOSURE SMOKE PASSED ===');
}

main().catch((err) => { fail(err instanceof Error ? err.stack ?? err.message : String(err)); });
