// B5/B6 receiver-seeded browser acceptance config — hermetic profile.
//
// Playwright 自持三服务，本文件不依赖外部已启动进程，也不读写开发态数据：
//   1) LCOS Local Core   127.0.0.1:<CORE_PORT>（run 专属 DB / dev workspace / MVP root）
//   2) Huabu server      127.0.0.1:<API_PORT>（run 专属 workspace + data dir）
//   3) Huabu web (vite)  127.0.0.1:<WEB_PORT>（/lcos-core → CORE_PORT）
//
// 隔离纪律：
//   - repo root 由本文件位置推导（可搬目录、无盘符硬编码）。
//   - 每次 run 一个 tempRoot；Core 的 LOCAL_CORE_DB_PATH / LOCAL_CORE_DEV_WORKSPACE_ROOT /
//     LOCAL_CORE_MVP_SAMPLE_ROOT 全部指向该 tempRoot，绝不触碰
//     apps/local-core/.data/phase2.sqlite（那是开发态真相）。
//   - LOCAL_CORE_E2E_FIXTURE=1 打开隔离 e2e fixture 事实（真实 PNG / 决策记录 / 承接会话）。
//   - 三个服务 reuseExistingServer: false：端口被占用时 Playwright 直接报错退出，
//     不会悄悄复用另一份既有进程（例如开发中的 Core）。
//
// 运行：npx playwright test -c e2e/lcos-collab-golden.playwright.config.ts
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// e2e/ → apps/web → apps → huabu → repo root
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LOCAL_CORE_ROOT = join(REPO_ROOT, 'apps', 'local-core');

// Playwright 会在 runner 与每个 worker 进程里各加载一次本文件；run 身份必须先由
// 首个进程生成、再通过 env 继承，否则每个进程会算出不同的 tempRoot（服务与 spec 打架）。
const runToken = process.env.E2E_RUN_TOKEN ?? `${process.pid}-${randomUUID()}`;
process.env.E2E_RUN_TOKEN = runToken;
const tempRoot = join(tmpdir(), `lcos-e2e-${runToken}`);
const coreRoot = join(tempRoot, 'local-core');
const CORE_DB_PATH = join(coreRoot, 'phase2.sqlite');
const CORE_DEV_WORKSPACE_ROOT = join(coreRoot, 'dev-workspace');
const CORE_MVP_SAMPLE_ROOT = join(coreRoot, 'mvp-sample');
const HUABU_WORKSPACE = join(tempRoot, 'huabu-workspace');
const HUABU_DATA_DIR = join(tempRoot, 'huabu-data');

for (const dir of [coreRoot, CORE_DEV_WORKSPACE_ROOT, CORE_MVP_SAMPLE_ROOT, HUABU_WORKSPACE, HUABU_DATA_DIR]) {
  mkdirSync(dir, { recursive: true });
}

const CORE_PORT = process.env.E2E_CORE_PORT ?? '43121';
const API_PORT = process.env.E2E_HUABU_PORT ?? '3001';
const WEB_PORT = process.env.E2E_WEB_PORT ?? '5173';
// Core 的写请求 Origin 白名单默认只含 dev 5173；隔离 profile 显式声明自己的 origin。
const CORE_ALLOWED_ORIGINS = `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`;
// 仅本地 e2e 用的常量 token（Core 与 Huabu web 共用），不是机密。
const E2E_TOKEN = 'dev-token';
const E2E_FIXTURE_PROJECT_ID = 'lcos-gen2-dev';

// spec 与 harness 共用同一份 run 事实（隔离路径 / 端口 / token / fixture 项目）。
process.env.E2E_REPO_ROOT = REPO_ROOT;
process.env.E2E_TEMP_ROOT = tempRoot;
process.env.E2E_CORE_URL = `http://127.0.0.1:${CORE_PORT}`;
process.env.E2E_CORE_TOKEN = E2E_TOKEN;
process.env.E2E_FIXTURE_PROJECT_ID = E2E_FIXTURE_PROJECT_ID;
process.env.E2E_LOCAL_CORE_DB_PATH = CORE_DB_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: /lcos-collab-(golden|r2r3)\.spec\.ts/,
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  outputDir: join(tempRoot, 'test-results'),
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
      cwd: LOCAL_CORE_ROOT,
      port: Number(CORE_PORT),
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        LOCAL_CORE_TEST_PORT: CORE_PORT,
        LOCAL_CORE_DB_PATH: CORE_DB_PATH,
        LOCAL_CORE_DEV_WORKSPACE_ROOT: CORE_DEV_WORKSPACE_ROOT,
        LOCAL_CORE_MVP_SAMPLE_ROOT: CORE_MVP_SAMPLE_ROOT,
        LOCAL_CORE_ENABLE_MVP_SAMPLE: '0',
        LOCAL_CORE_E2E_FIXTURE: '1',
        LOCAL_CORE_API_TOKEN: E2E_TOKEN,
        LOCAL_CORE_ALLOWED_ORIGINS: CORE_ALLOWED_ORIGINS,
        LCOS_RECOVERY_TRANSPORT: 'fake',
      },
    },
    {
      command: 'pnpm --filter @huabu/server dev',
      cwd: join(REPO_ROOT, 'huabu'),
      port: Number(API_PORT),
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        HUABU_WORKSPACE,
        HUABU_DATA_DIR,
        HUABU_CONNECTION_TOKEN: E2E_TOKEN,
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: join(REPO_ROOT, 'huabu', 'apps', 'web'),
      port: Number(WEB_PORT),
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        VITE_LCOS_CORE_TARGET: `http://127.0.0.1:${CORE_PORT}`,
        HUABU_CONNECTION_TOKEN: E2E_TOKEN,
      },
    },
  ],
});