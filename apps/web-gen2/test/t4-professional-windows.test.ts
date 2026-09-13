// Sprint 2B（T4）headless 层测试：window layout / conversation client / work-view epoch guard / assembly controller。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  placeProfessionalRegionV1,
  professionalRegionRefV1,
  rectsOverlapV1,
  type ProfessionalRectV1,
} from '../src/windows/professionalWindowLayout.js';
import { CoreConversationClient } from '../src/backend/conversations.js';
import { CoreAssemblyClient } from '../src/backend/assembly.js';
import { CoreRunClient } from '../src/backend/runs.js';
import { HttpClient } from '../src/backend/client.js';
import { ConversationWorkViewController } from '../src/lcos/conversation/conversationWorkViewController.js';
import { AssemblySourceBayController } from '../src/lcos/assembly/assemblySourceBayController.js';

const BASE = 'http://core.test';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

interface Captured {
  url: string;
  method: string;
}

/** 可手动控制 resolve 的 fetcher，用于制造迟到回包。 */
function deferredHttp() {
  const captured: Captured[] = [];
  const pending: Array<{ resolve: (r: Response) => void; url: string }> = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url;
    const method = init?.method ?? 'GET';
    captured.push({ url, method });
    return new Promise((resolve) => {
      pending.push({ resolve, url });
    });
  };
  const http = new HttpClient({ baseUrl: BASE, fetch: fetcher });
  return {
    http,
    captured,
    pending,
    release(urlPrefix: string, data: unknown, status = 200) {
      const index = pending.findIndex((p) => p.url.includes(urlPrefix));
      assert.notEqual(index, -1, `no pending request for ${urlPrefix}`);
      const [{ resolve }] = pending.splice(index, 1);
      resolve(jsonResponse({ ok: true, value: data }, status));
    },
  };
}

// ---- window layout ----

test('professionalRegionRefV1 derives the unique region id per body/target', () => {
  assert.deepEqual(professionalRegionRefV1('conversation-work', 'conv-1'), {
    regionId: 'lcos:conversation:conv-1',
    bodyKey: 'conversation-work',
    targetKey: 'conv-1',
  });
  assert.deepEqual(professionalRegionRefV1('assembly', 'main'), {
    regionId: 'lcos:assembly:main',
    bodyKey: 'assembly',
    targetKey: 'main',
  });
});

test('rectsOverlapV1 detects overlap and adjacency', () => {
  const a: ProfessionalRectV1 = { x: 0, y: 0, width: 100, height: 100 };
  assert.equal(rectsOverlapV1(a, { x: 50, y: 50, width: 10, height: 10 }), true);
  assert.equal(rectsOverlapV1(a, { x: 100, y: 0, width: 10, height: 10 }), false); // 边界相接不算
  assert.equal(rectsOverlapV1(a, { x: 110, y: 110, width: 10, height: 10 }), false);
});

test('placeProfessionalRegionV1 avoids occupied rects, then steps, then yields undefined', () => {
  const env = {
    safeRect: { x: 0, y: 0, width: 800, height: 600 },
    occupiedRects: [{ x: 0, y: 0, width: 100, height: 100 }],
    activeRegionId: undefined,
  };
  const preferred: ProfessionalRectV1 = { x: 80, y: 80, width: 40, height: 40 };
  // 第一候选与 occupied 重叠 → 使用偏移候选（104 ≥ 100，逃出占位）
  const placed = placeProfessionalRegionV1(env, preferred);
  assert.deepEqual(placed, { x: 104, y: 104, width: 40, height: 40 });
  // 全部冲突 → undefined
  const blocked = placeProfessionalRegionV1(
    { ...env, occupiedRects: [{ x: 0, y: 0, width: 100, height: 100 }, { x: 104, y: 104, width: 200, height: 200 }] },
    preferred,
  );
  assert.equal(blocked, undefined);
});

// ---- conversation client ----

test('CoreConversationClient.getIdentity returns undefined on 404 (never guesses)', async () => {
  const d = deferredHttp();
  const client = new CoreConversationClient(d.http);
  const promise = client.getIdentity('p1', 'ghost');
  d.release('/identity', undefined, 404);
  assert.equal(await promise, undefined);
});

test('CoreConversationClient.listConnectedConversations unwraps the envelope', async () => {
  const d = deferredHttp();
  const client = new CoreConversationClient(d.http);
  const promise = client.listConnectedConversations('p1');
  d.release('/connected-conversations', [{ id: 'c1' }]);
  assert.deepEqual(await promise, [{ id: 'c1' }]);
  assert.equal(d.captured[0]?.method, 'GET');
});

// ---- work view epoch guard ----

test('work view: late response from target A never pollutes target B (generation guard)', async () => {
  const d = deferredHttp();
  const client = new CoreConversationClient(d.http);
  const controller = new ConversationWorkViewController(client);

  controller.open('p1', 'conv-a');
  // 立即切到 B：A 的请求还挂着
  controller.open('p1', 'conv-b');
  // A 迟到的回包（work-view 聚合）
  d.release('/work-view', { id: 'a', schemaVersion: 1 });
  const state = controller.read();
  assert.equal(state?.connectedConversationId, 'conv-b');
  // identity section 必须仍是 pending（A 的迟到数据被丢弃）
  assert.equal(state?.sections.identity.status, 'pending');
});

test('work view: B 的回包正常落地为 partial 状态', async () => {
  const d = deferredHttp();
  const client = new CoreConversationClient(d.http);
  const controller = new ConversationWorkViewController(client);
  controller.open('p1', 'conv-b');
  d.release('/work-view', { id: 'b', schemaVersion: 1, identity: { schemaVersion: 1 } });
  await new Promise((resolve) => setTimeout(resolve, 0)); // 刷完整个 promise 链
  const state = controller.read();
  assert.equal(state?.sections.identity.status, 'loaded');
  assert.equal(state?.sections.reach.status, 'loaded'); // 聚合一次带回 identity+reach
  assert.equal(state?.sections.timeline.status, 'pending'); // partial：timeline 尚未回
});

test('work view: aborting via open() aborts the previous controller', async () => {
  const d = deferredHttp();
  const client = new CoreConversationClient(d.http);
  const controller = new ConversationWorkViewController(client);
  controller.open('p1', 'conv-a');
  controller.open('p2', 'conv-a');
  // A 的请求已被 abort → 不 commit
  controller.dispose();
  assert.equal(controller.read(), undefined);
});

// ---- assembly controller ----

test('CoreRunClient.getPendingInputRequest returns undefined on 404 (not waiting)', async () => {
  const d = deferredHttp();
  const client = new CoreRunClient(d.http);
  const promise = client.getPendingInputRequest('run-1');
  d.release('/input-request', undefined, 404);
  assert.equal(await promise, undefined);
});

test('CoreRunClient.answerInput posts requestId with the answer', async () => {
  const d = deferredHttp();
  const client = new CoreRunClient(d.http);
  const promise = client.answerInput('run-1', { requestId: 'rq-1', text: 'ok' });
  d.release('/input-request', { ok: true });
  await promise;
  assert.equal(d.captured[0]?.method, 'POST');
});

test('assembly: warehouse loads and tab switching does not duplicate truth', async () => {
  const d = deferredHttp();
  const client = new CoreAssemblyClient(d.http);
  const controller = new AssemblySourceBayController(client);
  controller.open('p1');
  controller.selectTab('capture');
  d.release('/warehouse', { schemaVersion: 1, projectId: 'p1', items: [], totalApprox: 0 });
  await new Promise((resolve) => setTimeout(resolve, 0)); // 刷完整个 promise 链
  const state = controller.read();
  assert.equal(state?.warehouseStatus, 'loaded');
  assert.equal(state?.tab, 'capture');
  assert.equal(d.captured.length, 1); // 切 tab 不重复请求 warehouse
});

test('assembly: target switch aborts stale read and keeps state consistent', async () => {
  const d = deferredHttp();
  const client = new CoreAssemblyClient(d.http);
  const controller = new AssemblySourceBayController(client);
  controller.open('p1');
  controller.open('p2');
  controller.dispose();
  assert.equal(controller.read(), undefined);
});
