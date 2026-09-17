import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CoreCollaborationClient } from '../src/backend/collaboration.js';
import { HttpClient } from '../src/backend/client.js';

const BASE = 'http://core.test';

interface CapturedCall {
  readonly url: string;
  readonly method: string;
  readonly body?: unknown;
}

/** 捕获式 fetch：按路由表应答，其余 404。 */
function stubHttp(routes: Record<string, { status?: number; value?: unknown }>): { http: HttpClient; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const http = new HttpClient({
    baseUrl: BASE,
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.url;
      const method = init?.method ?? 'GET';
      const text = init?.body?.toString() ?? '';
      const body = text ? JSON.parse(text) : undefined;
      calls.push({ url, method, body });
      const key = `${method} ${url}`;
      const route = routes[key];
      if (route === undefined) {
        return new Response(JSON.stringify({ ok: false, error: { message: 'not found' } }), { status: 404, headers: { 'content-type': 'application/json' } });
      }
      return new Response(
        JSON.stringify({ ok: true, value: route.value }),
        { status: route.status ?? 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  return { http, calls };
}

test('delegate 保持 canonical Run 路由，返回真实 receipt', async () => {
  const { http, calls } = stubHttp({ 'POST http://core.test/projects/project-1/runs': { value: { id: 'run-1' } } });
  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.delegate('project-1', {
    instruction: 'Inspect the current selection.',
    outputIntent: 'analyze',
    workspaceId: 'workspace-1',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.receipt.command, 'delegate');
    assert.equal(result.receipt.runId, 'run-1');
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, `${BASE}/projects/project-1/runs`);
  assert.deepEqual(calls[0]?.body, {
    instruction: 'Inspect the current selection.',
    outputIntent: 'analyze',
    workspaceId: 'workspace-1',
  });
});

test('delegate 409 → needs_recovery 产品错误（不泄 transport 细节）', async () => {
  const http = new HttpClient({
    baseUrl: BASE,
    fetch: async (): Promise<Response> => new Response(
      JSON.stringify({ message: 'STALE_REVISION' }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    ),
  });
  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.delegate('project-1', { instruction: 'x', outputIntent: 'analyze' });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'needs_recovery');
    assert.equal(result.error.retryable, true);
  }
});

test('readSession：200 返回投影；404 → undefined', async () => {
  const projection = { schemaVersion: 1, projectId: 'p-1', conversationId: 'c-1', userState: 'ready' };
  const { http } = stubHttp({ 'GET http://core.test/projects/p-1/connected-conversations/c-1/collaboration-session': { value: projection } });
  const collaboration = new CoreCollaborationClient(http);
  const found = await collaboration.readSession('p-1', 'c-1');
  assert.equal(found?.conversationId, 'c-1');
  const missing = await collaboration.readSession('p-1', 'ghost');
  assert.equal(missing, undefined);
});

test('readTimeline：limit 参数进 query', async () => {
  const { http, calls } = stubHttp({ 'GET http://core.test/projects/p-1/connected-conversations/c-1/collaboration-timeline?limit=10': { value: [] } });
  const collaboration = new CoreCollaborationClient(http);
  const items = await collaboration.readTimeline('p-1', 'c-1', { limit: 10 });
  assert.deepEqual(items, []);
  assert.equal(calls[0]?.url, `${BASE}/projects/p-1/connected-conversations/c-1/collaboration-timeline?limit=10`);
});

test('readPendingInput：合法 404 仍可折算为空，但 5xx 必须向上抛，不能伪装成“没有待回答”', async () => {
  const { http, calls } = stubHttp({
    'GET http://core.test/projects/p-1/connected-conversations/c-1/collaboration-session': {
      value: {
        schemaVersion: 1,
        projectId: 'p-1',
        conversationId: 'c-1',
        activity: { pendingInputId: 'req-1', activeRunId: 'run-1' },
      },
    },
    'GET http://core.test/runs/run-1/input-request': { status: 500 },
  });
  const collaboration = new CoreCollaborationClient(http);
  await assert.rejects(() => collaboration.readPendingInput('p-1', 'c-1'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, `${BASE}/runs/run-1/input-request`);
});

test('readReviews：下游读取失败必须向上抛，不能折算成空 review 列表', async () => {
  const { http, calls } = stubHttp({
    'GET http://core.test/projects/p-1/connected-conversations/c-1/work-view': {
      value: { runs: [{ runId: 'run-1' }] },
    },
    'GET http://core.test/projects/p-1/runs': { status: 500 },
  });
  const collaboration = new CoreCollaborationClient(http);
  await assert.rejects(() => collaboration.readReviews('p-1', 'c-1'));
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, `${BASE}/projects/p-1/runs`);
});

test('answerInput：pendingInputId 映射 requestId，走同一 Run 的 input-request 路由', async () => {
  const { http, calls } = stubHttp({ 'POST http://core.test/runs/run-9/input-request': { value: {} } });
  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.answerInput('p-1', 'run-9', { pendingInputId: 'req-9', answer: '按 A 继续', selectedOptions: ['A'] });
  assert.equal(result.ok, true);
  assert.equal(calls[0]?.url, `${BASE}/runs/run-9/input-request`);
  assert.deepEqual(calls[0]?.body, { requestId: 'req-9', text: '按 A 继续', selectedOptions: ['A'] });
});

test('approve(accept) 缺 expectedBaseRevisionId → 抛 TypeError（CAS 纪律）', async () => {
  const { http } = stubHttp({});
  const collaboration = new CoreCollaborationClient(http);
  await assert.rejects(
    () => collaboration.approve('p-1', { returnId: 'r-1', decision: 'accept' }),
    TypeError,
  );
});

test('approve(accept/reject) 走 artifact-returns 路由', async () => {
  const { http, calls } = stubHttp({
    'POST http://core.test/artifact-returns/r-1/accept': { value: {} },
    'POST http://core.test/artifact-returns/r-2/reject': { value: {} },
  });
  const collaboration = new CoreCollaborationClient(http);
  const accepted = await collaboration.approve('p-1', { returnId: 'r-1', decision: 'accept', expectedBaseRevisionId: 'rev-1' });
  assert.equal(accepted.ok, true);
  const rejected = await collaboration.approve('p-1', { returnId: 'r-2', decision: 'reject' });
  assert.equal(rejected.ok, true);
  assert.equal(calls[0]?.url, `${BASE}/artifact-returns/r-1/accept`);
  assert.deepEqual(calls[0]?.body, { expectedBaseRevisionId: 'rev-1' });
  assert.equal(calls[1]?.url, `${BASE}/artifact-returns/r-2/reject`);
});

test('cancel 走 /runs/:id/cancel', async () => {
  const { http, calls } = stubHttp({ 'POST http://core.test/runs/run-9/cancel': { value: {} } });
  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.cancel('p-1', { runId: 'run-9' });
  assert.equal(result.ok, true);
  assert.equal(calls[0]?.url, `${BASE}/runs/run-9/cancel`);
});

test('recover 走 conversation-continuations recovery-actions（action 透传）', async () => {
  const { http, calls } = stubHttp({ 'POST http://core.test/projects/p-1/conversation-continuations/op-1/recovery-actions': { value: {} } });
  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.recover('p-1', { continuationOperationId: 'op-1', action: 'reconcile', expectedRevision: 3 });
  assert.equal(result.ok, true);
  assert.equal(calls[0]?.url, `${BASE}/projects/p-1/conversation-continuations/op-1/recovery-actions`);
  assert.deepEqual(calls[0]?.body, { input: { action: 'reconcile', expectedRevision: 3 } });
});

test('resume：provider 从工程层会话查询回补，走 continuation submit（continue_existing）', async () => {
  const { http, calls } = stubHttp({
    'GET http://core.test/projects/p-1/connected-conversations': { value: [{ id: 'c-1', provider: 'codex' }] },
    'POST http://core.test/projects/p-1/conversation-continuations': { value: { created: true } },
  });
  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.resume('p-1', { conversationId: 'c-1' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  const submit = calls[1];
  assert.equal(submit?.url, `${BASE}/projects/p-1/conversation-continuations`);
  const body = submit?.body as { input: { mode: string; provider: string; connectedConversationId: string } };
  assert.equal(body.input.mode, 'continue_existing');
  assert.equal(body.input.provider, 'codex');
  assert.equal(body.input.connectedConversationId, 'c-1');
});

test('resume：会话不存在 → unavailable，不发起 submit', async () => {
  const { http, calls } = stubHttp({ 'GET http://core.test/projects/p-1/connected-conversations': { value: [] } });
  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.resume('p-1', { conversationId: 'ghost' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'unavailable');
  assert.equal(calls.length, 1);
});

test('handoff：完整 receiver 切换事务未接通前 fail-closed，不把 prepareHandoff 冒充完成态', async () => {
  const { http, calls } = stubHttp({});
  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.handoff('p-1', 'c-old', { conversationId: 'c-new' }, { surface: { kind: 'main', surfaceId: 'main' }, selectionEntityIds: ['e-1'] });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, 'unavailable');
    assert.match(result.error.userMessage, /Receiver/);
  }
  assert.equal(calls.length, 0);
});

test('send/fork 永远 fail-closed：不发任何 HTTP，不 fallback createRun', async () => {
  const { http, calls } = stubHttp({});
  const collaboration = new CoreCollaborationClient(http);
  const send = await collaboration.send('p-1', { conversationId: 'c-1', text: '你好' });
  const fork = await collaboration.fork('p-1', { conversationId: 'c-1' });
  assert.equal(send.ok, false);
  assert.equal(fork.ok, false);
  if (!send.ok) assert.equal(send.error.code, 'unavailable');
  if (!fork.ok) assert.equal(fork.error.code, 'unavailable');
  assert.equal(calls.length, 0);
});

test('subscribe：复用既有 /events SSE，run.changed → session.changed + timeline.appended', async () => {
  type Listener = (event: { data?: string }) => void;
  const listeners = new Map<string, Listener>();
  let closedAt: string | undefined;
  class FakeEventSource {
    readonly url: string;
    constructor(url: string) { this.url = url; }
    addEventListener(type: string, listener: Listener): void { listeners.set(type, listener); }
    close(): void { closedAt = this.url; }
  }
  const { http } = stubHttp({});
  const collaboration = new CoreCollaborationClient(http);
  const received: string[] = [];
  const unsubscribe = collaboration.subscribe('p-1', 'c-1', (event) => received.push(event.kind), {
    eventSourceFactory: (url) => new FakeEventSource(url) as unknown as EventSource,
  });
  assert.notEqual(unsubscribe, undefined);
  listeners.get('project-event')?.({ data: JSON.stringify({ ok: true, value: { type: 'run.changed' } }) });
  listeners.get('project-event')?.({ data: JSON.stringify({ ok: true, value: { type: 'continuity.changed' } }) });
  listeners.get('project-event')?.({ data: 'not-json' });
  assert.deepEqual(received, ['session.changed', 'timeline.appended', 'session.changed', 'capability.changed']);
  unsubscribe?.();
  assert.equal(closedAt, `${BASE}/projects/p-1/events`);
});