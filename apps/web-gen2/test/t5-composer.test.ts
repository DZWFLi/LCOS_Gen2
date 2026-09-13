// Sprint P0-03（T5/T3/T6 consumer）headless 测试：composer view state mapper + composer controller。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CommandDraftV1, ComposerSubmitProjectionV1, ContinuationRecoveryProjectionV1 } from '@local-creative-os/contracts';
import { composerViewStateV1, type ComposerSubmitOutcomeV1 } from '../src/composer/composerSubmitMapper.js';
import { ComposerController, type ComposerControllerStateV1 } from '../src/composer/composerController.js';
import type { CreateRunInputV1 } from '../src/backend/runs.js';

const NOW = '2026-09-12T00:00:00.000Z';

function projection(overrides: Partial<ComposerSubmitProjectionV1> = {}): ComposerSubmitProjectionV1 {
  return {
    schemaVersion: 1,
    projectId: 'p-1',
    composerAnchor: 'main-composer',
    draftRevision: NOW,
    receiverId: 'conv-1',
    submissionKind: 'run',
    ownerRef: { kind: 'connected_conversation', id: 'conv-1' },
    acknowledgement: 'unconfirmed',
    allowedActions: ['submit_run', 'refresh'],
    ...overrides,
  };
}

// ---- T5 mapper ----

test('composerViewStateV1 映射（13 态中本 Sprint 可产出子集）', () => {
  assert.equal(composerViewStateV1({ projection: null, submitting: false, outcome: 'none', coreReachable: true, resolving: false, reconciling: false, keyboardFocused: false }), 'empty');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: false, outcome: 'none', coreReachable: true, resolving: false, reconciling: false, keyboardFocused: false }), 'editing');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: true, outcome: 'none', coreReachable: true, resolving: false, reconciling: false, keyboardFocused: false }), 'sending');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: false, outcome: 'acknowledged', coreReachable: true, resolving: false, reconciling: false, keyboardFocused: false }), 'ready');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: false, outcome: 'rejected', coreReachable: true, resolving: false, reconciling: false, keyboardFocused: false }), 'error');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: false, outcome: 'unconfirmed', coreReachable: true, resolving: false, reconciling: false, keyboardFocused: false }), 'unknown');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: false, outcome: 'unconfirmed', coreReachable: true, resolving: false, reconciling: true, keyboardFocused: false }), 'reconciling');
  assert.equal(composerViewStateV1({ projection: projection({ receiverId: null, ownerRef: null, allowedActions: ['choose_receiver', 'refresh'] }), submitting: false, outcome: 'none', coreReachable: true, resolving: false, reconciling: false, keyboardFocused: false }), 'blocked');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: false, outcome: 'none', coreReachable: false, resolving: false, reconciling: false, keyboardFocused: false }), 'offline');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: false, outcome: 'none', coreReachable: true, resolving: true, reconciling: false, keyboardFocused: false }), 'resolving');
  assert.equal(composerViewStateV1({ projection: projection(), submitting: false, outcome: 'none', coreReachable: true, resolving: false, reconciling: false, keyboardFocused: true }), 'keyboard_focus');
});

// ---- T3/T6 controller ----

const DRAFT: CommandDraftV1 = {
  schemaVersion: 1, projectId: 'p-1', workspaceId: null, composerAnchor: 'main-composer',
  surfaceKind: 'main', surfaceId: null, prompt: '分析当前资料。',
  contextViewIds: ['view-a'], selectionViewIds: [], receiverId: 'conv-1', provider: 'codex',
  createAsNewNode: false, intent: 'analyze', resultPolicy: 'reply_only', updatedAt: NOW,
};

function fakeClients(opts: {
  draft?: CommandDraftV1 | null;
  submitProjection?: ComposerSubmitProjectionV1 | null;
  runError?: { status?: number } & Error;
  continuationError?: { status?: number } & Error;
} = {}) {
  const createdRuns: CreateRunInputV1[] = [];
  const submittedOps: Array<{ operationId: string; connectedConversationId: string }> = [];
  let projectionValue = opts.submitProjection === undefined ? projection() : opts.submitProjection;
  const drafts = {
    getDraft: async () => opts.draft === undefined ? DRAFT : opts.draft,
    getComposerSubmitProjection: async () => projectionValue,
    saveDraft: async () => DRAFT,
    deleteDraft: async () => ({ deleted: true }),
  };
  const runs = {
    createRun: async (projectId: string, input: CreateRunInputV1) => {
      if (opts.runError) throw opts.runError;
      createdRuns.push(input);
      projectionValue = projection({ acknowledgement: 'acknowledged' });
    },
    getPendingInputRequest: async () => undefined,
    answerInput: async () => undefined,
  };
  const continuations = {
    submit: async (projectId: string, input: { operationId: string; connectedConversationId: string }) => {
      if (opts.continuationError) throw opts.continuationError;
      submittedOps.push(input);
      projectionValue = projection({ submissionKind: 'continuation', allowedActions: ['submit_continuation', 'open_recovery', 'refresh'] });
      return {} as ContinuationRecoveryProjectionV1;
    },
    list: async () => [],
    executeRecoveryAction: async () => { throw new Error('unused'); },
    get: async () => undefined,
  };
  return { drafts, runs, continuations, createdRuns, submittedOps };
}

async function openedController(clients: ReturnType<typeof fakeClients>): Promise<ComposerController> {
  const controller = new ComposerController(clients as never);
  controller.open('p-1', 'main-composer', null);
  // 等待 load 完成（draft + projection）
  for (let i = 0; i < 50 && controller.read()?.draft === null; i += 1) await new Promise((r) => setTimeout(r, 5));
  return controller;
}

test('submit_run：提交内容含选定引用（view/artifact），成功后回读 acknowledged', async () => {
  const clients = fakeClients();
  const controller = await openedController(clients);
  const before = controller.read() as ComposerControllerStateV1;
  assert.equal(before.draft?.receiverId, 'conv-1');

  const state = await controller.submit('submit_run', [
    { entityType: 'view', entityId: 'view-a' },
    { entityType: 'artifact', entityId: 'artifact-1' },
    { entityType: 'scope', entityId: 'scope-1' }, // 全类型映射：scope
    { entityType: 'workspace', entityId: 'ws-1' },
    { entityType: 'conversation', entityId: 'conv-sess-1' },
    { entityType: 'component', entityId: 'comp-1' },
    { entityType: 'note', entityId: 'note-1' }, // note 不进 OrderedRunReference（F6B 裁决）
  ]);
  assert.equal(state.outcome, 'acknowledged');
  assert.equal(state.projection?.acknowledgement, 'acknowledged');
  assert.equal(clients.createdRuns.length, 1);
  const input = clients.createdRuns[0]!;
  assert.equal(input.instruction, '分析当前资料。');
  assert.equal(input.receiverRef?.connectedConversationId, 'conv-1');
  assert.equal(input.orderedReferences?.length, 6); // note 跳过
  assert.deepEqual(input.orderedReferences, [
    { ref: { type: 'view', viewId: 'view-a' }, order: 0 },
    { ref: { type: 'artifact', artifactId: 'artifact-1' }, order: 1 },
    { ref: { type: 'scope', scopeId: 'scope-1' }, order: 2 },
    { ref: { type: 'workspace', workspaceId: 'ws-1' }, order: 3 },
    { ref: { type: 'conversation', conversationSessionId: 'conv-sess-1' }, order: 4 },
    { ref: { type: 'component', componentId: 'comp-1' }, order: 5 },
  ]);
});

test('resetOutcome：提交确认后回到可编辑（无需重载），receipt 已在 Core 持久化', async () => {
  const clients = fakeClients();
  const controller = await openedController(clients);
  const state = await controller.submit('submit_run', []);
  assert.equal(state.outcome, 'acknowledged');
  const reset = controller.resetOutcome();
  assert.equal(reset.outcome, 'none');
  assert.equal(reset.draft?.receiverId, 'conv-1'); // 草稿保留
});

test('submit_continuation：走 continuation submit（新 operation），回读 continuation kind', async () => {
  const clients = fakeClients({ submitProjection: projection({ submissionKind: 'continuation', allowedActions: ['submit_continuation', 'open_recovery', 'refresh'] }) });
  const controller = await openedController(clients);
  const state = await controller.submit('submit_continuation', []);
  assert.equal(state.outcome, 'acknowledged');
  assert.equal(clients.submittedOps.length, 1);
  assert.equal(clients.submittedOps[0]!.connectedConversationId, 'conv-1');
  assert.ok(clients.submittedOps[0]!.operationId.startsWith('cont-'));
  assert.equal(state.projection?.submissionKind, 'continuation');
});

test('4xx 拒绝 → rejected；不允许的 action → 抛错不调 provider', async () => {
  const clients = fakeClients({ runError: Object.assign(new Error('revise requires target'), { status: 400, code: 'INVALID_ARGUMENT' }) });
  const controller = await openedController(clients);
  const state = await controller.submit('submit_run', []);
  assert.equal(state.outcome, 'rejected');
  assert.equal(state.errorCode, 'INVALID_ARGUMENT');

  await assert.rejects(() => controller.submit('open_recovery', []), /not a submit action/);
});

test('timeout 未知 → unconfirmed，禁止重复提交，refresh 后可再试', async () => {
  const clients = fakeClients({ runError: Object.assign(new Error('network timeout'), { status: 0 }) });
  const controller = await openedController(clients);
  const first = await controller.submit('submit_run', []);
  assert.equal(first.outcome, 'unconfirmed');
  await assert.rejects(() => controller.submit('submit_run', []), /unconfirmed; refresh/);
  const refreshed = await controller.refresh();
  assert.equal(refreshed.outcome, 'unconfirmed'); // 无 receipt，仍 unknown（诚实）
});

test('draft 无 receiver 时 submit 被拒绝（不伪造提交）', async () => {
  const clients = fakeClients({ draft: { ...DRAFT, receiverId: null } });
  const controller = await openedController(clients);
  await assert.rejects(() => controller.submit('submit_run', []), /receiver/);
  assert.equal(clients.createdRuns.length, 0);
});
