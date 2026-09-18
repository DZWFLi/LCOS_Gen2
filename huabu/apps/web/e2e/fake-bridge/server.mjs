// DEV-ONLY fake Light Bridge — the T7 provider transport double for the hermetic browser
// acceptance stack. NOT production capability (real transport is EXTERNAL_GAP).
//
// It mirrors the REST surface consumed by apps/local-core/src/bridge-rest-client.ts:
//   POST /v1/tasks                        → { task: identity }
//   GET  /v1/tasks/by-run/:runId          → { task: identity }
//   GET  /v1/tasks/:taskId                → { task: identity, result? }
//   POST /v1/tasks/:taskId/input-response → {}
//   POST /v1/tasks/:taskId/finalize       → {}
//   POST /v1/tasks/:taskId/cancel         → { task: { status: 'cancelled' } }
//   GET  /v1/capabilities                 → { bridgeVersion, primaryContractVersion, providers }
//
// The result scenario is derived from the task envelope's `instructions` marker so the
// harness needs no side channel and the Core still drives a real dispatch/ingest cycle:
//   __E2E_WAITING_INPUT__ → providerStatus waiting_input + inputRequest  (Waiting Input 正路径)
//   __E2E_REVIEW__        → providerStatus review + one created file     (Artifact Return 正路径)
//   otherwise             → still running (no result yet)

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const port = Number(process.env.FAKE_BRIDGE_PORT ?? 43123);
const tasks = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
}

function identity(taskId, envelope, status) {
  return {
    taskId,
    lcosRunId: String(envelope?.lcosRunId ?? ''),
    status,
    requestFingerprint: String(envelope?.requestFingerprint ?? 'fake-bridge'),
    contractVersion: 'bridge-task-v1',
    externalSessionId: `fake-session-${taskId}`,
  };
}

function taskIdFor(runId) {
  return `fake-task-${runId}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && url.pathname === '/v1/capabilities') {
    return json(res, 200, {
      bridgeVersion: 'fake-e2e-1',
      primaryContractVersion: 'bridge-task-v1',
      providers: [{
        provider: 'codex',
        executionMode: 'fake',
        taskTypes: ['draft'],
        outputIntents: ['create', 'revise', 'analyze'],
        contractVersions: ['bridge-task-v1', 'bridge-result-v0', 'bridge-result-v1'],
        sessionBinding: true,
        completionHook: true,
      }],
    });
  }

  if (req.method === 'POST' && url.pathname === '/v1/tasks') {
    const envelope = await readBody(req);
    const taskId = taskIdFor(String(envelope.lcosRunId ?? ''));
    const instructions = String(envelope.instructions ?? '');
    let status = 'running';
    let result;
    if (instructions.includes('__E2E_WAITING_INPUT__')) {
      status = 'waiting_input';
      result = {
        contractVersion: 'bridge-result-v0',
        providerStatus: 'waiting_input',
        shortSummary: '需要你补充一点信息',
        inputRequest: {
          requestId: `req-${String(envelope.lcosRunId ?? '').slice(0, 60)}`,
          question: '请选择本轮的目标节奏？（e2e fixture）',
          options: ['快速', '稳妥'],
          allowFreeText: true,
        },
        changedFiles: [],
      };
    } else if (instructions.includes('__E2E_REVIEW__')) {
      const outputRoot = String(envelope.outputRoot ?? '');
      const expected = Array.isArray(envelope.expectedOutputs) ? envelope.expectedOutputs[0] : undefined;
      const target = String(expected?.absolutePath ?? join(outputRoot, 'e2e-result.md'));
      mkdirSync(outputRoot, { recursive: true });
      writeFileSync(target, `# E2E 产出\n\n由 fake bridge 写入的待复核产出（${String(envelope.lcosRunId ?? '')}）。\n`, 'utf8');
      status = 'review';
      result = {
        contractVersion: 'bridge-result-v0',
        providerStatus: 'review',
        shortSummary: '已产出待复核草稿',
        changedFiles: [{ path: target, action: 'created', role: 'result', mediaType: 'text/markdown' }],
      };
    }
    tasks.set(taskId, { envelope, status, result });
    return json(res, 200, { task: identity(taskId, envelope, status) });
  }

  if (req.method === 'GET' && parts[0] === 'v1' && parts[1] === 'tasks' && parts[2] === 'by-run') {
    const runId = decodeURIComponent(parts[3] ?? '');
    const entry = tasks.get(taskIdFor(runId));
    if (entry === undefined) {
      return json(res, 404, { ok: false, error: { code: 'TASK_NOT_FOUND', message: 'fake bridge: unknown run' } });
    }
    return json(res, 200, { task: identity(taskIdFor(runId), entry.envelope, entry.status) });
  }

  if (parts[0] === 'v1' && parts[1] === 'tasks' && parts[2] !== undefined) {
    const taskId = decodeURIComponent(parts[2]);
    const action = parts[3];
    const entry = tasks.get(taskId);
    if (req.method === 'POST' && action === 'input-response') {
      await readBody(req);
      if (entry !== undefined) { entry.status = 'running'; entry.result = undefined; }
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && action === 'finalize') {
      await readBody(req);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && action === 'cancel') {
      if (entry !== undefined) entry.status = 'cancelled';
      return json(res, 200, { task: identity(taskId, entry?.envelope ?? {}, 'cancelled') });
    }
    if (req.method === 'GET') {
      if (entry === undefined) {
        return json(res, 404, { ok: false, error: { code: 'TASK_NOT_FOUND', message: 'fake bridge: unknown task' } });
      }
      const task = { ...identity(taskId, entry.envelope, entry.status) };
      if (entry.result !== undefined
        && ['review', 'waiting_input', 'failed', 'cancelled', 'timeout'].includes(entry.status)) {
        task.result = entry.result;
      }
      return json(res, 200, { task });
    }
  }

  return json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `fake bridge: unknown route ${req.method} ${url.pathname}` } });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`[fake-bridge] listening on http://127.0.0.1:${port}\n`);
});