// LCOS Gen2 Collaboration 浏览器冒烟（真实栈 live）。
// 前置：local-core（MVP seed, fake transport）@127.0.0.1:43122 + vite @5173
// （VITE_LCOS_CORE_TARGET 指向 local-core；前端默认带 dev-token）。
// 运行：npx playwright test -c e2e/lcos-collab-smoke.playwright.config.ts
//
// 覆盖（诚实边界）：
// - App 载入 LCOS project shell + Main worksite（真实 Core 连通）
// - 画布渲染 React-Flow viewport + MVP 节点投影
// - 未绑定 Glyth 如实缺席（MVP 无 connected conversation → bound/unbound 语义在
//   unit + local-core HTTP 整链覆盖，浏览器 golden path 登记为下一批）
// - 窗口打开不移动 camera（Professional Window 约束的冒烟级断言）

import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://localhost:5173' });

test.describe.configure({ mode: 'serial' });

test('boots the LCOS project shell against real Local Core', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/');
  await expect(page.locator('[data-lcos-project-shell]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-lcos-main-worksite]').first()).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain('localhost:5173');
  // 关键：前端已穿过 /lcos-core 代理真实连到 Local Core（health 401 修正后为 200）
  const healthOk = await page.evaluate(async () => {
    const res = await fetch('/lcos-core/health');
    return res.status === 200;
  });
  expect(healthOk).toBe(true);
});

test('renders a real canvas with projected nodes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__viewport')).toBeVisible({ timeout: 30_000 });
  // MVP 项目 seed 了 artifacts → 画布有投影节点（body 属性证明是 LCOS 物种）。
  await expect(page.locator('[data-lcos-species-body]').first()).toBeVisible({ timeout: 30_000 });
});

test('keeps camera stable while a window opens (Professional Window constraint)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__viewport')).toBeVisible({ timeout: 30_000 });
  const readTransform = (): Promise<string> =>
    page.evaluate(() =>
      (document.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform ?? '');
  await page.waitForTimeout(500);
  const before = await readTransform();
  // 打开一个窗口（Assembly/会话入口）；无 conversation 时窗口为空面板，等价断言 camera 不变。
  const opener = page.locator('[data-lcos-assembly-entry]').first();
  if (await opener.isVisible().catch(() => false)) {
    await opener.click();
  }
  await page.waitForTimeout(600);
  const after = await readTransform();
  expect(after).toBe(before);
});

test('unbound Glyth is honestly absent (no conversation seeded)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.react-flow__viewport')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  expect(await page.locator('[data-lcos-glyth-body]').count()).toBe(0);
  // timeline/投影空态在 unit/local-core HTTP 已覆盖；此处 guard 页面无崩溃。
});