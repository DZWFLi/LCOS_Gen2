// Sprint P0-04（T5/T6 consumer）headless 测试：capture inbox mapper + controller。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { CaptureOperationProjectionV1 } from '@local-creative-os/contracts';
import { captureInboxViewStateV1, captureOperationActionLabelV1 } from '../src/lcos/capture/captureInboxMapper.js';
import { CaptureInboxController, type CaptureInboxControllerStateV1 } from '../src/lcos/capture/captureInboxController.js';

const NOW = '2026-09-12T00:00:00.000Z';

function op(overrides: Partial<CaptureOperationProjectionV1> = {}): CaptureOperationProjectionV1 {
  return {
    schemaVersion: 1, operationId: 'op-c-1', kind: 'web_page', capturedAt: NOW,
    stagingItemIds: ['capture-1'], materializationRefs: [],
    targetResolution: { status: 'unresolved', projectId: null },
    outcome: 'unconfirmed', allowedActions: ['apply', 'reconcile'],
    ...overrides,
  };
}

function fakeClient(opts: { applyError?: { status?: number } & Error } = {}) {
  let ops: CaptureOperationProjectionV1[] = [op()];
  const materialized: Array<{ projectId: string; captureIds: string[] }> = [];
  return {
    captures: {
      listOperations: async () => ops,
      materialize: async (projectId: string, captureIds: string[]) => {
        if (opts.applyError) throw opts.applyError;
        materialized.push({ projectId, captureIds: [...captureIds] });
        // apply 后回链 → resolved 到当前 project
        ops = [op({ stagingItemIds: captureIds, materializationRefs: [{ artifactId: 'a-1', viewId: 'v-1' }], targetResolution: { status: 'resolved', projectId }, outcome: 'confirmed', allowedActions: ['locate', 'reconcile'] })];
        return { schemaVersion: 1, projectId, batchId: 'b-1', imported: 1, items: [{ captureId: 'capture-1', artifactId: 'a-1', viewId: 'v-1' }] };
      },
    },
    materialized,
  };
}

async function openedController(clients: ReturnType<typeof fakeClient>): Promise<CaptureInboxController> {
  const controller = new CaptureInboxController(clients.captures as never);
  controller.open('p-1');
  for (let i = 0; i < 50 && controller.read()?.status === 'loading'; i += 1) await new Promise((r) => setTimeout(r, 5));
  return controller;
}

test('captureInboxViewStateV1 映射', () => {
  assert.equal(captureInboxViewStateV1({ operations: null, applying: false, appliedThisSession: false, readError: false }), 'loading');
  assert.equal(captureInboxViewStateV1({ operations: [], applying: false, appliedThisSession: false, readError: false }), 'empty');
  assert.equal(captureInboxViewStateV1({ operations: [op()], applying: false, appliedThisSession: false, readError: false }), 'staged');
  assert.equal(captureInboxViewStateV1({ operations: [op({ outcome: 'confirmed' })], applying: false, appliedThisSession: false, readError: false }), 'resolved');
  assert.equal(captureInboxViewStateV1({ operations: [op()], applying: true, appliedThisSession: false, readError: false }), 'receiving');
  assert.equal(captureInboxViewStateV1({ operations: [op({ outcome: 'confirmed' })], applying: false, appliedThisSession: true, readError: false }), 'applied');
  assert.equal(captureInboxViewStateV1({ operations: [], applying: false, appliedThisSession: false, readError: true }), 'error');
  assert.equal(captureOperationActionLabelV1('apply'), '应用到本项目');
});

test('apply：materialize 到当前 project → 回读 resolved/confirmed/locate', async () => {
  const clients = fakeClient();
  const controller = await openedController(clients);
  const before = controller.read() as CaptureInboxControllerStateV1;
  assert.equal(before.operations[0]!.allowedActions.includes('apply'), true);

  const state = await controller.apply(before.operations[0]!);
  assert.equal(clients.materialized.length, 1);
  assert.equal(clients.materialized[0]!.projectId, 'p-1');
  assert.deepEqual(clients.materialized[0]!.captureIds, ['capture-1']);
  assert.equal(state.appliedThisSession, true);
  assert.equal(state.operations[0]!.outcome, 'confirmed');
  assert.equal(state.operations[0]!.targetResolution.status, 'resolved');
  assert.equal(state.operations[0]!.allowedActions.includes('locate'), true);
});

test('apply 失败 → errorCode 保留，不冒充 applied', async () => {
  const clients = fakeClient({ applyError: Object.assign(new Error('materialize timeout'), { status: 0 }) });
  const controller = await openedController(clients);
  const before = controller.read() as CaptureInboxControllerStateV1;
  const state = await controller.apply(before.operations[0]!);
  assert.equal(state.appliedThisSession, false);
  assert.equal(state.errorCode, 'apply_error');
  assert.equal(state.operations[0]!.outcome, 'unconfirmed'); // 无 receipt，不冒充成功
});

test('allowedActions 无 apply 时 apply 被拒绝（resolved 到其它 project 只能 reconcile）', async () => {
  const clients = fakeClient();
  const controller = await openedController(clients);
  const locked = op({ targetResolution: { status: 'resolved', projectId: 'p-other' }, outcome: 'confirmed', allowedActions: ['reconcile'] });
  await assert.rejects(() => controller.apply(locked), /not allowed/);
  assert.equal(clients.materialized.length, 0);
});
