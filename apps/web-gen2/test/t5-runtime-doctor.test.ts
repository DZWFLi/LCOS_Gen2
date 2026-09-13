// Sprint P0-09（T5/T6 consumer）headless 测试：runtime doctor mapper + health client 扁平契约。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { HealthStatus } from '@local-creative-os/contracts';
import { HttpClient } from '../src/backend/client.js';
import { CoreHealthClient } from '../src/backend/health.js';
import { runtimeDoctorViewStateV1 } from '../src/lcos/doctor/runtimeDoctorMapper.js';

const HEALTHY: HealthStatus = { status: 'ok', service: 'local-core', mode: 'phase_2_lite', version: '0.3.0-phase2' };

test('runtimeDoctorViewStateV1 映射', () => {
  assert.equal(runtimeDoctorViewStateV1({ health: HEALTHY, readError: false, offlineLikely: false }), 'healthy');
  assert.equal(runtimeDoctorViewStateV1({ health: null, readError: false, offlineLikely: false }), 'loading');
  assert.equal(runtimeDoctorViewStateV1({ health: null, readError: true, offlineLikely: true }), 'offline');
  assert.equal(runtimeDoctorViewStateV1({ health: null, readError: true, offlineLikely: false }), 'unknown');
});

test('CoreHealthClient.getHealth 解析扁平 HealthStatus（非 envelope）', async () => {
  const http = new HttpClient({
    baseUrl: 'http://core.test',
    fetch: async () => new Response(JSON.stringify(HEALTHY), { status: 200, headers: { 'content-type': 'application/json' } }),
  });
  const client = new CoreHealthClient(http);
  const value = await client.getHealth();
  assert.deepEqual(value, HEALTHY);
});
