#!/usr/bin/env node
// LCOS Gen2 G0.5 — read-only Local Core client smoke.
// Uses the real web-gen2 Core clients against a running Local Core.
// Only READ operations. Does NOT mutate (no PUT/DELETE relations, no create).
//
// Env:
//   LCOS_CORE_URL  e.g. http://127.0.0.1:43121  (default)
//   LCOS_CORE_TOKEN optional Bearer token (omit if Core has no apiToken)
//
// Any step failing exits non-zero.

const BASE = process.env.LCOS_CORE_URL ?? 'http://127.0.0.1:43121';
const TOKEN = process.env.LCOS_CORE_TOKEN;

import { HttpClient } from '../apps/web-gen2/src/backend/client.js';
import { CoreProjectClient } from '../apps/web-gen2/src/backend/projects.js';
import { CoreArtifactClient } from '../apps/web-gen2/src/backend/artifacts.js';
import { CoreRelationClient } from '../apps/web-gen2/src/backend/relations.js';
import { CoreSearchClient } from '../apps/web-gen2/src/backend/search.js';

const http = new HttpClient({ baseUrl: BASE, token: TOKEN });
const projects = new CoreProjectClient(http);
const artifacts = new CoreArtifactClient(http);
const relations = new CoreRelationClient(http);
const search = new CoreSearchClient(http);

function step(name) {
  process.stdout.write(`  → ${name} ... `);
  const t0 = Date.now();
  return (extra = '') => process.stdout.write(`ok${extra ? ` (${extra})` : ''} (${Date.now() - t0}ms)\n`);
}

function check(cond, msg) {
  if (!cond) {
    console.error(`\n✗ g0-core-client-smoke failed: ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
  }
}

async function main() {
  // 1) GET /projects
  const s1 = step('GET /projects');
  const list = await projects.listProjects();
  check(Array.isArray(list), 'listProjects must return an array');
  check(list.length > 0, 'no projects present; seed at least one project before smoke');
  s1(`projects=${list.length}`);

  // 2) pick a real project
  const projectId = list[0].id;
  check(typeof projectId === 'string' && projectId.length > 0, 'project id must be a string');
  const s2 = step('GET /projects/:id/graph');
  const graph = await projects.getProjectGraph(projectId);
  check(graph !== undefined, 'project graph must be present');
  const artifactNodes = Array.isArray(graph.artifacts) ? graph.artifacts : [];
  const relationsNodes = Array.isArray(graph.relations) ? graph.relations : [];
  s2(`artifacts=${artifactNodes.length} relations=${relationsNodes.length}`);

  // 3) artifact detail
  let artifactId;
  if (artifactNodes.length > 0) {
    const first = artifactNodes[0];
    artifactId = typeof first === 'string' ? first : (first && 'id' in first ? first.id : undefined);
  }
  if (artifactId) {
    const s3 = step('GET /artifacts/:id');
    const detail = await artifacts.getArtifactDetail(artifactId);
    check(detail.artifact !== undefined, 'artifact detail must include artifact');
    check(Array.isArray(detail.revisions), 'artifact detail must include revisions');
    s3(`${detail.artifact.title ?? artifactId} revisions=${detail.revisions.length}`);
  } else {
    process.stdout.write(`  → GET /artifacts/:id ... skipped (no artifact in graph)\n`);
  }

  // 4) relations list
  const s4 = step('GET /projects/:id/relations');
  const rel = await relations.listRelations(projectId);
  check(Array.isArray(rel), 'relations must be an array');
  s4(`relations=${rel.length}`);

  // 5) project search (read-only)
  const titleFragment = artifactId ? undefined : 'Untitled';
  const query = titleFragment ?? 'a';
  const s5 = step('GET /projects/:id/search');
  const hits = await search.searchProject(projectId, { query });
  check(hits !== undefined, 'search must return SearchResultVNext');
  s5(`query="${query}"`);

  console.log('\n✓ g0-core-client-smoke passed (read-only): Core typed HTTP boundary validated against real Local Core.');
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
