// B5/B6 receiver-seeded browser acceptance config（Batch B / B6）。
// Playwright 自持三服务（无外部手动启动）：
//   1) LCOS Local Core   127.0.0.1:43121（MVP seed + fake recovery transport + dev-token）
//   2) Huabu server      127.0.0.1:3001（隔离 temp workspace/data）
//   3) Huabu web (vite)  127.0.0.1:5173（/lcos-core → 43121）
// 运行：npx playwright test -c e2e/lcos-collab-golden.playwright.config.ts
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const runId = `${process.pid}-${randomUUID()}`;
const e2eWorkspace = join(tmpdir(), `lcos-e2e-ws-${runId}`);
const e2eDataDir = join(tmpdir(), `lcos-e2e-data-${runId}`);
const REPO = 'E:/OS开发/LCOS_Gen2';
const CORE_PORT = process.env.E2E_CORE_PORT ?? '43121';
const API_PORT = process.env.E2E_HUABU_PORT ?? '3001';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5173';

export default defineConfig({
  testDir: '.',
  testMatch: /lcos-collab-(golden|r2r3)\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1365, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'off',
  },
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: `${REPO}/apps/local-core`,
      port: Number(CORE_PORT),
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        LOCAL_CORE_TEST_PORT: CORE_PORT,
        LOCAL_CORE_ENABLE_MVP_SAMPLE: '1',
        LOCAL_CORE_API_TOKEN: 'dev-token',
        LCOS_RECOVERY_TRANSPORT: 'fake',
      },
    },
    {
      command: 'pnpm --filter @huabu/server dev',
      cwd: `${REPO}/huabu`,
      port: Number(API_PORT),
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        HUABU_WORKSPACE: e2eWorkspace,
        HUABU_DATA_DIR: e2eDataDir,
        HUABU_CONNECTION_TOKEN: 'dev-token',
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: `${REPO}/huabu/apps/web`,
      port: Number(WEB_PORT),
      reuseExistingServer: true,
      timeout: 180_000,
      env: {
        VITE_LCOS_CORE_TARGET: `http://127.0.0.1:${CORE_PORT}`,
        HUABU_CONNECTION_TOKEN: 'dev-token',
      },
    },
  ],
});
