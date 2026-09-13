// Sprint P0-05（T5/T7 consumer）headless 测试：connector source mapper + controller。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ConnectorSourceProjectionV1 } from '@local-creative-os/contracts';
import { connectorSourceViewStateV1 } from '../src/lcos/connector/connectorSourceMapper.js';
import { ConnectorSourceController, type ConnectorSourceControllerStateV1 } from '../src/lcos/connector/connectorSourceController.js';

function source(overrides: Partial<ConnectorSourceProjectionV1> = {}): ConnectorSourceProjectionV1 {
  return {
    schemaVersion: 1, connector: 'obsidian', displayName: 'Obsidian Vault', access: 'read_only',
    sourceKind: 'local_directory', contentTypes: ['text/markdown'],
    session: { status: 'none' }, allowedActions: ['scan'],
    ...overrides,
  };
}

function fakeClient(opts: { error?: boolean } = {}) {
  return {
    connectors: {
      listSources: async () => {
        if (opts.error) throw Object.assign(new Error('read failed'), { status: 500 });
        return [source()];
      },
    },
  };
}

async function openedController(clients: ReturnType<typeof fakeClient>): Promise<ConnectorSourceController> {
  const controller = new ConnectorSourceController(clients.connectors as never);
  controller.open('p-1');
  for (let i = 0; i < 50 && controller.read()?.status === 'loading'; i += 1) await new Promise((r) => setTimeout(r, 5));
  return controller;
}

test('connectorSourceViewStateV1 映射', () => {
  assert.equal(connectorSourceViewStateV1({ sources: null, readError: false }), 'loading');
  assert.equal(connectorSourceViewStateV1({ sources: [], readError: false }), 'empty');
  assert.equal(connectorSourceViewStateV1({ sources: [source()], readError: false }), 'not_configured');
  assert.equal(connectorSourceViewStateV1({ sources: [source({ session: { status: 'active', scanId: 's-1', expiresAt: '2099-01-01T00:00:00.000Z' } })], readError: false }), 'ready');
  assert.equal(connectorSourceViewStateV1({ sources: [source({ allowedActions: [] })], readError: false }), 'unsupported');
  assert.equal(connectorSourceViewStateV1({ sources: [], readError: true }), 'error');
});

test('controller：载入投影；read 失败 → error', async () => {
  const ok = await openedController(fakeClient());
  const state = ok.read() as ConnectorSourceControllerStateV1;
  assert.equal(state.status, 'loaded');
  assert.equal(state.sources[0]!.connector, 'obsidian');

  const bad = await openedController(fakeClient({ error: true }));
  const badState = bad.read() as ConnectorSourceControllerStateV1;
  assert.equal(badState.status, 'error');
  assert.equal(badState.errorCode, 'read_error');
});

test('controller：refresh 重读后保留 loaded', async () => {
  const clients = fakeClient();
  const controller = await openedController(clients);
  const refreshed = await controller.refresh();
  assert.equal(refreshed.status, 'loaded');
  assert.equal(refreshed.sources.length, 1);
});
