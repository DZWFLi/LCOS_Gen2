// Live-stack smoke config：不自主起 webServer，复用我们已启动的真实栈
// （local-core 43122 + vite 5173）。避免与主 config 的隔离 backend 冲突。
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: /lcos-collab-smoke\.spec\.ts/,
  timeout: 45_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
  webServer: [],
  globalTeardown: undefined,
});