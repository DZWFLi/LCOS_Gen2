import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CoreCollaborationClient } from '../src/backend/collaboration.js';
import { HttpClient } from '../src/backend/client.js';

const BASE = 'http://core.test';

test('collaboration.delegate preserves canonical Run creation route', async () => {
  const captured: Array<{
    readonly url: string;
    readonly method: string;
    readonly body?: unknown;
  }> = [];

  const http = new HttpClient({
    baseUrl: BASE,
    fetch: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input.url;
      const method = init?.method ?? 'GET';
      const text = init?.body?.toString() ?? '';
      const body = text ? JSON.parse(text) : undefined;
      captured.push({ url, method, body });
      return new Response(
        JSON.stringify({ ok: true, value: { id: 'run-1' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });

  const collaboration = new CoreCollaborationClient(http);
  const result = await collaboration.delegate('project-1', {
    instruction: 'Inspect the current selection.',
    outputIntent: 'analyze',
    workspaceId: 'workspace-1',
  });

  assert.deepEqual(result, { id: 'run-1' });
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.url, `${BASE}/projects/project-1/runs`);
  assert.equal(captured[0]?.method, 'POST');
  assert.deepEqual(captured[0]?.body, {
    instruction: 'Inspect the current selection.',
    outputIntent: 'analyze',
    workspaceId: 'workspace-1',
  });
});
