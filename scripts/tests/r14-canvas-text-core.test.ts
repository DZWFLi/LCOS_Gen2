import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteMetadataRepository } from '../../apps/local-core/src/metadata-repository.ts';
import { createMvpSampleSnapshot } from '../../apps/local-core/src/mvp-sample-project.ts';
import { PresentationApplicationService } from '../../apps/local-core/src/presentation-application-service.ts';
import { CurationCommandService } from '../../apps/local-core/src/curation-command-service.ts';
import { SessionReadSet } from '../../apps/local-core/src/session-read-set.ts';
import { readCanvasText, saveCanvasText, type CanvasTextWrite } from '../../apps/local-core/src/canvas-text-service.ts';
import { handleCurationRoute } from '../../apps/local-core/src/routes/curation.ts';

async function run(fn: (f: any) => unknown) {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-r14-text-'));
  const dbPath = join(dir, 'core.sqlite');
  let db = new SqliteMetadataRepository(dbPath);
  const sample = createMvpSampleSnapshot(join(dir, 'project'), '2026-10-02T00:00:00Z');
  db.save(sample);
  const p = String(sample.project.id), site = { ...sample.workspaces[0]!, canvasId: 'native-canvas' };
  db.upsertWorkspace(site);
  const address = { canvasId: site.canvasId, spatialId: 'native-text-node' };
  const command = () => new CurationCommandService({ repository: db, presentations: new PresentationApplicationService(db, db) });
  const f = { p, site, sample, address, db: () => db,
    save: (body = '# 正文\n\n**粗体**与链接', patch: Partial<CanvasTextWrite> = {}) => saveCanvasText(db, p, { ...address, expectedRevisionId: null, body, ...patch }),
    read: () => readCanvasText(db, p, address),
    reopen: () => { db.close(); db = new SqliteMetadataRepository(dbPath); },
    route: async (body: unknown, method = 'PUT', query = '') => {
      let status = 0, value: any;
      const pathname = `/projects/${p}/curation/canvas-text`;
      const handled = await handleCurationRoute({ method, pathname, url: new URL(pathname + query, 'http://core'),
        request: {} as never, response: {} as never, controller: new AbortController(), metadata: db,
        curationCommand: command(), sessionReadSet: new SessionReadSet(), curation: undefined, search: undefined,
        helpers: { readJsonBody: async () => body, isRecord: (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v),
          sendJson: (_r: unknown, code: number, json: unknown) => { status = code; value = json; },
          failure: (code: string, message: string) => ({ ok: false, error: { code, message } }) } as never } as never);
      assert.equal(handled, true); return { status, value };
    } };
  try { await fn(f); } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
}

test('R14 Core: fresh native node starts with no binding, not a fake artifact', () => run(async f => {
  assert.equal(await f.read(), null);
}));
test('R14 Core: first save persists real Markdown and claims the same native node in one composite', () => run(async f => {
  const before = f.db().getArtifacts(f.p).length;
  const saved = await f.save();
  assert.equal(saved.spatialId, f.address.spatialId);
  assert.equal(f.db().getArtifacts(f.p).length, before + 1);
  assert.equal(f.db().findProjectionBinding(f.p, f.address.canvasId, 'node', 'artifact', saved.artifactId).spatialId, f.address.spatialId);
  assert.equal(await readFile(f.db().getFileRecord(saved.fileRecordId).observedPath, 'utf8'), saved.body);
  assert(f.db().get(f.p).workspaceMemberships.some((member: any) => member.workspaceId === f.site.id && member.artifactViewId === saved.viewId));
}));
test('R14 Core: lost create reply retries the same node without duplicate material or revision', () => run(async f => {
  const first = await f.save('初稿'); const second = await f.save('初稿');
  assert.deepEqual(second, first);
  assert.equal(f.db().getArtifactRevisions(first.artifactId).length, 1);
}));
test('R14 Core: concurrent same-body adoption commits one native binding and one material', () => run(async f => {
  const before = f.db().getArtifacts(f.p).length;
  const values = await Promise.all([f.save('同稿'), f.save('同稿')]);
  assert.equal(values[0].artifactId, values[1].artifactId);
  assert.equal(f.db().getArtifacts(f.p).length, before + 1);
}));
test('R14 Core: concurrent conflicting adoption never overwrites the winner', () => run(async f => {
  const values = await Promise.allSettled([f.save('第一稿'), f.save('另一稿')]);
  assert.equal(values.filter((v) => v.status === 'fulfilled').length, 1);
  assert.equal(values.filter((v) => v.status === 'rejected').length, 1);
}));
test('R14 Core: changed retry cannot reuse initial adoption as an update', () => run(async f => {
  const saved = await f.save('初稿'); await assert.rejects(() => f.save('替换稿'));
  assert.equal((await f.read()).revisionId, saved.revisionId);
}));
test('R14 Core: revision update keeps historical file, same artifact and native identity', () => run(async f => {
  const first = await f.save('初稿');
  const saved = await f.save('第二稿', { artifactId: first.artifactId, expectedRevisionId: first.revisionId });
  assert.equal(saved.artifactId, first.artifactId); assert.equal(saved.spatialId, first.spatialId);
  assert.notEqual(saved.revisionId, first.revisionId);
  const old = f.db().getArtifactRevision(first.revisionId);
  assert.equal(await readFile(f.db().getFileRecord(old.fileRecordId).observedPath, 'utf8'), '初稿');
}));
test('R14 Core: lost revision reply does not create another revision when checked/retried', () => run(async f => {
  const first = await f.save('初稿'); const input = { artifactId: first.artifactId, expectedRevisionId: first.revisionId };
  const saved = await f.save('第二稿', input); assert.deepEqual(await f.save('第二稿', input), saved);
  assert.equal(f.db().getArtifactRevisions(first.artifactId).length, 2);
}));
test('R14 Core: stale revision cannot overwrite later editing', () => run(async f => {
  const first = await f.save('初稿');
  await f.save('第二稿', { artifactId: first.artifactId, expectedRevisionId: first.revisionId });
  await assert.rejects(() => f.save('过期的改稿', { artifactId: first.artifactId, expectedRevisionId: first.revisionId }));
  assert.equal((await f.read()).body, '第二稿');
}));
test('R14 Core: empty body is a valid explicit edit, not a failed delete-text operation', () => run(async f => {
  const first = await f.save('先有内容');
  const empty = await f.save('', { artifactId: first.artifactId, expectedRevisionId: first.revisionId });
  assert.equal(empty.body, ''); assert.equal(f.db().getArtifact(empty.artifactId).archivedAt, undefined);
}));
test('R14 Core: same text but wrong artifact identity does not pass idempotent check', () => run(async f => {
  const first = await f.save('原文');
  await assert.rejects(() => f.save('原文', { artifactId: 'wrong', expectedRevisionId: first.revisionId }));
}));
test('R14 Core: lost binding is never repaired by silently creating a new artifact', () => run(async f => {
  const first = await f.save();
  f.db().deleteProjectionBinding(f.p, f.address.canvasId, 'node', 'artifact', first.artifactId);
  await assert.rejects(() => f.save('其他文字', { artifactId: first.artifactId, expectedRevisionId: first.revisionId }));
}));
test('R14 Core: a node bound to another entity is not available for text adoption', () => run(async f => {
  f.db().upsertProjectionBinding({ projectId: f.p, ...f.address, spatialKind: 'node', entityType: 'collection', entityId: 'collection-a' });
  const before = f.db().getArtifacts(f.p).length;
  await assert.rejects(() => f.save()); assert.equal(f.db().getArtifacts(f.p).length, before);
}));
test('R14 Core: missing/ambiguous worksite rejects without guessing scope', () => run(async f => {
  await assert.rejects(() => f.save('x', { canvasId: 'unknown' }));
  f.db().upsertWorkspace({ ...f.site, id: 'other-site' });
  await assert.rejects(() => f.save());
}));
test('R14 Core: actual database close/reopen retains body, revision and native binding', () => run(async f => {
  const saved = await f.save(); f.reopen(); assert.deepEqual(await f.read(), saved);
}));
test('R14 Core: missing file is an error, never converted to an empty draft', () => run(async f => {
  const saved = await f.save(); await unlink(f.db().getFileRecord(saved.fileRecordId).observedPath);
  await assert.rejects(() => f.read());
}));
test('R14 route: incomplete unconditional write is rejected before registration', () => run(async f => {
  const before = f.db().getArtifacts(f.p).length;
  const response = await f.route({ ...f.address, body: 'x' });
  assert.equal(response.status, 409); assert.equal(f.db().getArtifacts(f.p).length, before);
}));
test('R14 route: actual PUT registration then GET returns exact committed body and node', () => run(async f => {
  const response = await f.route({ ...f.address, body: '# 标题\n\n正文', expectedRevisionId: null });
  assert.equal(response.status, 200);
  const get = await f.route(null, 'GET', `?canvasId=${f.address.canvasId}&spatialId=${f.address.spatialId}`);
  assert.equal(get.status, 200); assert.deepEqual(get.value.value, response.value.value);
}));

test('R14 Core: concurrent revisions keep one winner and clean the rejected new file', () => run(async f => {
  const first = await f.save('共同基稿');
  const input = { artifactId: first.artifactId, expectedRevisionId: first.revisionId };
  const replies = await Promise.allSettled([f.save('编辑甲', input), f.save('编辑乙', input)]);
  assert.equal(replies.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(replies.filter(r => r.status === 'rejected').length, 1);
  assert.equal(f.db().getArtifactRevisions(first.artifactId).length, 2);
  const current = await f.read();
  const path = f.db().getFileRecord(current.fileRecordId).observedPath;
  const files = await readdir(join(path, '..'));
  assert.equal(files.filter(name => name.endsWith('.md')).length, 2);
}));
test('R14 Core: transaction rejects a moved native binding before committing a revision', () => run(async f => {
  const first = await f.save('原文');
  const original = f.db().commitManagedTextRevision.bind(f.db());
  f.db().commitManagedTextRevision = (input) => {
    f.db().deleteProjectionBinding(f.p, f.address.canvasId, 'node', 'artifact', first.artifactId);
    return original(input);
  };
  await assert.rejects(() => f.save('不该保存', { artifactId: first.artifactId, expectedRevisionId: first.revisionId }));
  assert.equal(f.db().getArtifact(first.artifactId).currentRevisionId, first.revisionId);
  assert.equal(f.db().getArtifactRevisions(first.artifactId).length, 1);
}));
test('R14 route: agent session fields are not accepted by the direct canvas edit path', () => run(async f => {
  const response = await f.route({ ...f.address, body: 'x', expectedRevisionId: null, sessionId: 'agent-a' });
  assert.equal(response.status, 409);
  assert.equal(await f.read(), null);
}));
