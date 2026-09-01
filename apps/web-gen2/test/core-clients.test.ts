import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Relation } from '@local-creative-os/domain';
import type { ProjectGraphSnapshot, SearchResultVNext } from '@local-creative-os/contracts';
import { HttpClient } from '../src/backend/client.js';
import { CoreApiError, coreRequest, unwrapCoreValue, toCoreApiError } from '../src/backend/coreTypes.js';
import { CoreProjectClient } from '../src/backend/projects.js';
import { CoreArtifactClient } from '../src/backend/artifacts.js';
import { CoreRelationClient } from '../src/backend/relations.js';
import { CoreSearchClient } from '../src/backend/search.js';

const BASE = 'http://core.test';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Captured {
  url: string;
  method: string;
  body?: unknown;
}

function makeHttp(router: (req: Captured) => Response): HttpClient {
  const captured: Captured[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init?.method ?? 'GET';
    const text = init?.body?.toString() ?? '';
    const body = text ? JSON.parse(text) : undefined;
    captured.push({ url, method, body });
    return router({ url, method, body });
  };
  const http = new HttpClient({ baseUrl: BASE, fetch: fetcher });
  return Object.assign(http, { _captured: captured });
}

function capturedOf(http: HttpClient): Captured[] {
  return (http as unknown as { _captured: Captured[] })._captured ?? [];
}

function relation(overrides: Partial<Relation> = {}): Relation {
  return {
    id: 'rel-1',
    projectId: 'p1',
    sourceEntityType: 'artifact',
    sourceEntityId: 'a1',
    targetEntityType: 'note',
    targetEntityId: 'n1',
    kind: 'references',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as Relation;
}

// ---- §10 Core envelope ----

test('core envelope: ok true unwraps value', async () => {
  assert.deepEqual(unwrapCoreValue({ ok: true, value: { a: 1 } }), { a: 1 });
});

test('core envelope: ok false throws CoreApiError', async () => {
  const env = { ok: false as const, error: { code: 'BAD', message: 'nope' } };
  assert.throws(() => unwrapCoreValue(env), CoreApiError);
  try {
    unwrapCoreValue(env);
    assert.fail('should throw');
  } catch (err) {
    assert.ok(err instanceof CoreApiError);
    assert.equal(err.code, 'BAD');
    assert.equal(err.message, 'nope');
  }
});

test('core envelope: 404 -> CoreApiError(NOT_FOUND)', async () => {
  const http = makeHttp(() => jsonResponse({ ok: false, error: { code: 'NOT_FOUND', message: 'Artifact not found.' } }, 404));
  await assert.rejects(() => coreRequest(http, 'GET', '/artifacts/xyz'), (err: unknown) => {
    assert.ok(err instanceof CoreApiError);
    assert.equal(err.code, 'NOT_FOUND');
    assert.equal(err.status, 404);
    return true;
  });
});

test('core envelope: 409 -> CoreApiError(CONFLICT)', async () => {
  const http = makeHttp(() => jsonResponse({ ok: false, error: { code: 'CONFLICT', message: 'stale graph' } }, 409));
  await assert.rejects(() => coreRequest(http, 'GET', '/projects/p1/graph'), (err: unknown) => {
    assert.ok(err instanceof CoreApiError);
    assert.equal(err.code, 'CONFLICT');
    return true;
  });
});

test('core envelope: 503 -> CoreApiError(UNAVAILABLE)', async () => {
  const http = makeHttp(() => jsonResponse({ ok: false, error: { code: 'UNAVAILABLE', message: 'service down' } }, 503));
  await assert.rejects(() => coreRequest(http, 'GET', '/projects'), (err: unknown) => {
    assert.ok(err instanceof CoreApiError);
    assert.equal(err.code, 'UNAVAILABLE');
    return true;
  });
});

test('toCoreApiError: passthrough + wraps plain errors', () => {
  const existing = new CoreApiError('X', 'y', 1);
  assert.equal(toCoreApiError(existing), existing);
  assert.equal(toCoreApiError(new Error('boom')).code, 'INTERNAL');
});

// ---- §10 projects ----

test('projects.listProjects: maps ProjectListItem, not full Project', async () => {
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/projects`);
    assert.equal(req.method, 'GET');
    return jsonResponse({ ok: true, value: [{ id: 'p1', name: 'Demo', rootPath: '/tmp/demo' }] });
  });
  const items = await new CoreProjectClient(http).listProjects();
  assert.equal(items.length, 1);
  assert.deepEqual(Object.keys(items[0] ?? {}).sort(), ['id', 'name', 'rootPath']);
  assert.equal('graphVersion' in (items[0] as object), false);
});

test('projects.getProjectGraph: returns snapshot (incl legacy fields read-only)', async () => {
  const snapshot = { projectId: 'p1', graphVersion: 3, artifacts: [], relations: [], views: [] } as unknown as ProjectGraphSnapshot;
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/projects/p1/graph`);
    return jsonResponse({ ok: true, value: snapshot });
  });
  const value = await new CoreProjectClient(http).getProjectGraph('p1');
  assert.deepEqual(value, snapshot);
});

// ---- §10 artifacts ----

test('artifacts.getArtifactDetail: returns detail projection', async () => {
  const detail = {
    artifact: { id: 'a1', projectId: 'p1', title: 'Doc', kind: 'text' },
    currentRevisionId: 'rev1',
    revisions: [{ id: 'rev1', status: 'current', source: 'chat', createdAt: '2026' }],
  };
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/artifacts/a1`);
    return jsonResponse({ ok: true, value: detail });
  });
  const value = await new CoreArtifactClient(http).getArtifactDetail('a1');
  assert.equal(value.currentRevisionId, 'rev1');
  assert.equal(value.revisions[0]?.id, 'rev1');
});

test('artifacts.listArtifactRevisions: returns revisions array', async () => {
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/artifacts/a1/revisions`);
    return jsonResponse({ ok: true, value: [{ id: 'rev1', status: 'current' }] });
  });
  const revs = await new CoreArtifactClient(http).listArtifactRevisions('a1');
  assert.equal(revs[0]?.id, 'rev1');
});

test('artifacts.searchArtifactTitles: encodes q and never behaves as listAll', async () => {
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/projects/p1/artifacts/search?q=hello%20world`);
    return jsonResponse({ ok: true, value: [{ id: 'a1', title: 'Hello World' }] });
  });
  const found = await new CoreArtifactClient(http).searchArtifactTitles('p1', 'hello world');
  assert.equal(found[0]?.id, 'a1');
});

test('artifacts.searchArtifactTitles: empty q returns first 50 (title search, not listAll)', async () => {
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/projects/p1/artifacts/search?q=`);
    return jsonResponse({ ok: true, value: [{ id: 'x', title: 'X' }] });
  });
  const found = await new CoreArtifactClient(http).searchArtifactTitles('p1', '');
  assert.equal(found.length, 1);
});

// ---- §10 relations ----

test('relations.listRelations: returns Relation[]', async () => {
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/projects/p1/relations`);
    return jsonResponse({ ok: true, value: [relation({ id: 'rel-1' })] });
  });
  const rs = await new CoreRelationClient(http).listRelations('p1');
  assert.equal(rs[0]?.id, 'rel-1');
});

test('relations.getRelation: returns relation', async () => {
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/projects/p1/relations/rel-1`);
    return jsonResponse({ ok: true, value: relation() });
  });
  const r = await new CoreRelationClient(http).getRelation('p1', 'rel-1');
  assert.equal(r.kind, 'references');
});

test('relations.putRelation: sends full Relation envelope and returns changeSetId', async () => {
  const rel = relation();
  const http = makeHttp((req) => {
    assert.equal(req.method, 'PUT');
    assert.equal(req.url, `${BASE}/projects/p1/relations/rel-1`);
    const body = req.body as { relation: Relation };
    assert.equal(body.relation.id, 'rel-1');
    assert.equal(body.relation.sourceEntityType, 'artifact');
    return jsonResponse({ ok: true, value: rel, meta: { changeSetId: 'cs-1' } });
  });
  const result = await new CoreRelationClient(http).putRelation('p1', rel);
  assert.equal(result.relation.id, 'rel-1');
  assert.equal(result.changeSetId, 'cs-1');
});

test('relations.deleteRelation: callable with no body and returns changeSetId', async () => {
  const http = makeHttp((req) => {
    assert.equal(req.method, 'DELETE');
    assert.equal(req.url, `${BASE}/projects/p1/relations/rel-1`);
    assert.deepEqual(req.body, {});
    return jsonResponse({ ok: true, value: null, meta: { changeSetId: 'cs-2' } });
  });
  const result = await new CoreRelationClient(http).deleteRelation('p1', 'rel-1');
  assert.equal(result.changeSetId, 'cs-2');
});

test('relations: valid Core entity types (artifact/note/scope/view/workspace) round-trip', async () => {
  const http = makeHttp(() => jsonResponse({ ok: true, value: relation({ sourceEntityType: 'workspace', targetEntityType: 'scope' }) }));
  const r = await new CoreRelationClient(http).getRelation('p1', 'rel-1');
  assert.equal(r.sourceEntityType, 'workspace');
  assert.equal(r.targetEntityType, 'scope');
});

// ---- §10 search ----

test('search: builds q/limit/types/usedHereTarget and returns SearchResultVNext raw', async () => {
  const result = { hits: [{ entityId: 'a1', entityType: 'artifact', title: 'Doc', score: 1 }], query: 'doc' } as unknown as SearchResultVNext;
  const http = makeHttp((req) => {
    assert.equal(req.url, `${BASE}/projects/p1/search?q=hello%20world&limit=20&types=artifact%2Cnote&usedHereTarget=workspace%3Aw1`);
    return jsonResponse({ ok: true, value: result });
  });
  const value = await new CoreSearchClient(http).searchProject('p1', {
    query: 'hello world',
    limit: 20,
    types: ['artifact', 'note'],
    usedHereTarget: { kind: 'workspace', id: 'w1' },
  });
  assert.deepEqual(value, result);
});
