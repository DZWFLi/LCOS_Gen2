// Wave 10（T4/T6 consumer）headless 测试：Artifact Return 复核通道
// （GET /projects/:pid/runs 的 returns/capabilities + POST /artifact-returns/:id/{accept,reject,retry}）。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HttpClient } from '../src/backend/client.js';
import { CoreRunClient } from '../src/backend/runs.js';

import type { RunReview } from '@local-creative-os/contracts';

type Captured = { url: string; method: string; body: unknown };

function clientWith(response: unknown, captured: Captured[]): CoreRunClient {
  const http = new HttpClient({
    baseUrl: 'http://core.test',
    token: 't',
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return new Response(JSON.stringify({ ok: true, value: response }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return new CoreRunClient(http);
}

const REVIEW: RunReview = {
  run: {
    id: 'run-1',
    projectId: 'p1',
    workspaceId: 'w1',
    instruction: '整理定位说明',
    outputIntent: 'revise',
    provider: 'codex',
    status: 'review',
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
  },
  dispatch: { runId: 'run-1', status: 'bound' },
  returns: [
    {
      id: 'ret-1',
      runId: 'run-1',
      targetArtifactId: 'artifact-positioning',
      baseRevisionId: 'revision-positioning-initial',
      returnedFileId: 'file-1',
      contentHash: 'hash-1',
      canonicalPath: 'drafts/positioning.md',
      action: 'update',
      status: 'pending_review',
      createdAt: '2026-09-13T00:00:00.000Z',
      updatedAt: '2026-09-13T00:00:00.000Z',
    },
  ],
  draftRevisions: [],
  presentationPhase: 'review',
  capabilities: {
    schemaVersion: 1,
    accept: { enabled: true },
    reject: { enabled: true },
    retry: { enabled: true },
  },
} as unknown as RunReview;

test('listRunReviews 读 /projects/:pid/runs 并保留 returns/capabilities', async () => {
  const captured: Captured[] = [];
  const client = clientWith([REVIEW], captured);
  const value = await client.listRunReviews('p 1');
  assert.equal(captured[0]?.url, 'http://core.test/projects/p%201/runs');
  assert.equal(captured[0]?.method, 'GET');
  assert.equal(value.length, 1);
  assert.equal(value[0]?.returns[0]?.status, 'pending_review');
  assert.equal(value[0]?.capabilities.accept.enabled, true);
});

test('acceptArtifactReturn 只带 expectedBaseRevisionId（防覆盖他人 Current）', async () => {
  const captured: Captured[] = [];
  const client = clientWith({ artifactReturn: { id: 'ret-1' }, currentRevision: { id: 'rev-9' }, run: { id: 'run-1' } }, captured);
  await client.acceptArtifactReturn('ret-1', { expectedBaseRevisionId: 'revision-positioning-initial' });
  assert.equal(captured[0]?.url, 'http://core.test/artifact-returns/ret-1/accept');
  assert.equal(captured[0]?.method, 'POST');
  assert.deepEqual(captured[0]?.body, { expectedBaseRevisionId: 'revision-positioning-initial' });
});

test('rejectArtifactReturn / retryArtifactReturn 打同一 return 的判定位', async () => {
  const captured: Captured[] = [];
  const client = clientWith({ ok: true }, captured);
  await client.rejectArtifactReturn('ret-1');
  await client.retryArtifactReturn('ret-1');
  await client.retryArtifactReturn('ret-1', { instruction: '更强调证据' });
  assert.equal(captured[0]?.url, 'http://core.test/artifact-returns/ret-1/reject');
  assert.equal(captured[1]?.url, 'http://core.test/artifact-returns/ret-1/retry');
  assert.deepEqual(captured[1]?.body, {});
  assert.deepEqual(captured[2]?.body, { instruction: '更强调证据' });
});
