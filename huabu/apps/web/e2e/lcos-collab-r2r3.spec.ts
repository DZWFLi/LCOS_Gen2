// B6 R2 / R3 browser acceptance.
//
// R2 — Professional Window multi-region Stage（真实浏览器几何/激活/Esc/HUD safeRect）
// R3 — Railway 导航 / 接收 / 重排序（Core CAS）
//
// 诚实边界（本轮实测，登记于 handoff）：
// - R2: docked-right / 标题栏拖拽 / 8 向 resize / 指针钳制 / 显式 dock-ungroup 在生产代码
//   中没有任何 wiring（setWindowRegionLayout 只有 store 定义 + 单测调用，无产品 caller），
//   因此「停靠右侧贡献 safeRect」在浏览器不可达 → 登记为 R2-B remaining work。
// - R3: 可达 fixture 项目 (lcos-gen2-dev) 只有 1 个 kind=root 的 scope，
//   projectRailwayDestinations 的冻结规则会刻意隐藏「root scope + 有 surface 映射」的行
//   （它们等于第二个 SurfaceDock），因此 Railway 在浏览器不渲染（[data-lcos-railway] = 0）。
//   浏览器级导航/接收/重排序因此 BLOCKED；CAS 契约在本文件用真实 Core HTTP 逐条验证，
//   投影/排序规则由 railwayProjection.test.ts + web-gen2/railway-order.test.ts 覆盖。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const CORE = process.env.E2E_CORE_URL ?? 'http://127.0.0.1:43121';
const TOKEN = 'dev-token';
const PROJECT_ID = 'lcos-gen2-dev';

async function coreJson(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; value?: any }> {
  const res = await fetch(`${CORE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let value: unknown;
  try { value = ((await res.json()) as { value?: unknown }).value } catch { /* no body */ }
  return { ok: res.ok, status: res.status, value };
}

async function enterProject(page: Page): Promise<void> {
  await page.goto(`/projects/${PROJECT_ID}/main`);
  await expect(page.locator('[data-lcos-project-shell]').first()).toBeVisible({ timeout: 45_000 });
  for (let attempt = 0; attempt < 4 && await page.locator('.react-flow__viewport').count() === 0; attempt += 1) {
    const restore = page.getByRole('button', { name: /重新建立现场画布/ });
    const create = page.getByRole('button', { name: '建立主画布' });
    const retry = page.getByRole('button', { name: '重试加载' });
    if (await restore.isVisible().catch(() => false)) await restore.click();
    else if (await create.isVisible().catch(() => false)) await create.click();
    else if (await retry.isVisible().catch(() => false)) await retry.click();
    else break;
    await page.waitForTimeout(2500);
  }
  await page.waitForSelector('.react-flow__viewport', { timeout: 60_000 });
  await expect(page.locator('[data-lcos-glyth-body]').first()).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(1200);
}

interface RegionBox { id: string | null; layout: string | null; x: number; y: number; w: number; h: number; z: number }

function readRegions(page: Page): Promise<RegionBox[]> {
  return page.locator('[data-lcos-window-region-id]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return {
        id: node.getAttribute('data-lcos-window-region-id'),
        layout: node.getAttribute('data-lcos-window-layout'),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        z: Number(getComputedStyle(node as HTMLElement).zIndex),
      };
    }));
}

function readCamera(page: Page): Promise<string> {
  return page.evaluate(() =>
    (document.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform ?? '');
}

/** 真实产品路径同时开两个窗口：会话窗口（Glyth 双击）+ Assembly 窗口（入口按钮）。 */
async function openTwoWindows(page: Page): Promise<void> {
  await page.locator('[data-lcos-glyth-body]').first().dispatchEvent('dblclick');
  await expect(page.locator('[data-lcos-window-region-id]')).toHaveCount(1, { timeout: 25_000 });
  await page.locator('[data-lcos-assembly-entry]').first().click();
  await expect(page.locator('[data-lcos-window-region-id]')).toHaveCount(2, { timeout: 25_000 });
  await page.waitForTimeout(800);
}

// ─────────────────────────── R2 ───────────────────────────

test('R2-1. 两个独立窗口区域同时可见：id 不同、rect 不相交、均为 floating', async ({ page }) => {
  await enterProject(page);
  await openTwoWindows(page);
  const regions = await readRegions(page);
  expect(regions).toHaveLength(2);
  const [a, b] = regions;
  expect(a!.id).not.toBe(b!.id);
  expect(a!.layout).toBe('floating');
  expect(b!.layout).toBe('floating');
  // 两个 region 都有真实面积，且 rect 不相交（不是两个 store 条目 / 不是叠在一起）
  for (const region of regions) {
    expect(region.w).toBeGreaterThanOrEqual(232);
    expect(region.h).toBeGreaterThanOrEqual(232);
  }
  const disjoint =
    a!.x + a!.w <= b!.x || b!.x + b!.w <= a!.x || a!.y + a!.h <= b!.y || b!.y + b!.h <= a!.y;
  expect(disjoint, `两区域 rect 必须不相交: ${JSON.stringify(regions)}`).toBe(true);
});

test('R2-2. 前景激活区域正确 + 点击背景区域即激活该区域', async ({ page }) => {
  await enterProject(page);
  await openTwoWindows(page);
  let regions = await readRegions(page);
  const front = regions.find((region) => region.z === 2);
  const back = regions.find((region) => region.z === 1);
  expect(front, '恰好一个区域应为全局前景 (z=2)').toBeTruthy();
  expect(back, '恰好一个区域应为背景 (z=1)').toBeTruthy();
  // 真实 pointer 路径：Stage 的 onPointerDownCapture → activateWindow
  await page.locator(`[data-lcos-window-region-id="${back!.id}"]`).dispatchEvent('pointerdown', { bubbles: true });
  await page.waitForTimeout(400);
  regions = await readRegions(page);
  expect(regions.find((region) => region.id === back!.id)?.z, '被点击的背景区域必须成为前景').toBe(2);
  expect(regions.find((region) => region.id === front!.id)?.z, '原前景区域必须让位').toBe(1);
});

test('R2-3. Esc 栈只作用于最顶层窗口', async ({ page }) => {
  await enterProject(page);
  await openTwoWindows(page);
  const before = await readRegions(page);
  const front = before.find((region) => region.z === 2)!;
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-lcos-window-region-id]')).toHaveCount(1, { timeout: 10_000 });
  const after = await readRegions(page);
  expect(after[0]!.id, '被关闭的必须是最顶层区域').not.toBe(front.id);
});

test('R2-4. 分组标签仅属于显式组：当前无显式组 → 无 tab，region 数等于窗口数', async ({ page }) => {
  await enterProject(page);
  await openTwoWindows(page);
  expect(await page.locator('[role="tab"], [data-lcos-window-tab]').count()).toBe(0);
  const regions = await readRegions(page);
  expect(regions).toHaveLength(2);
  // 无合并：每个区域一个窗口（不存在承载多窗口的 tab chrome）
  const titles = await page.locator('[data-lcos-window-icon-button]').count();
  expect(titles).toBe(2);
});

test('R2-5. 浮动区域只贡献 occupiedRect、不收缩全局 safeRect（HUD 不整体位移）', async ({ page }) => {
  await enterProject(page);
  const dock = page.locator('[data-lcos-surface-dock]').first();
  const nav = page.locator('[data-lcos-navigator-island]').first();
  expect(await page.locator('[data-lcos-surface-dock], [data-lcos-navigator-island]').count(),
    'HUD 必须存在，否则本断言无观测对象').toBeGreaterThan(0);
  const before = {
    dock: await dock.count() > 0 ? await dock.boundingBox() : null,
    nav: await nav.count() > 0 ? await nav.boundingBox() : null,
  };
  await openTwoWindows(page);
  await page.waitForTimeout(600);
  const after = {
    dock: await dock.count() > 0 ? await dock.boundingBox() : null,
    nav: await nav.count() > 0 ? await nav.boundingBox() : null,
  };
  // lcosHudEdgeOffsets 只读 safeRect；floating 区域不参与 safeRect 收敛 →
  // 打开两个浮动窗口后 HUD 位置必须保持（浮动 = 精确遮挡，不是全局 inset）。
  if (before.dock && after.dock) expect(Math.round(after.dock.x)).toBe(Math.round(before.dock.x));
  if (before.nav && after.nav) expect(Math.round(after.nav.x)).toBe(Math.round(before.nav.x));
});

test('R2-6. 窗口打开/关闭不移动 Canvas camera', async ({ page }) => {
  await enterProject(page);
  const before = await readCamera(page);
  await openTwoWindows(page);
  expect(await readCamera(page)).toBe(before);
  const close = page.locator('[data-lcos-window-icon-button][aria-label="关闭窗口"]');
  while (await close.count() > 0) {
    await close.first().click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(400);
  expect(await readCamera(page)).toBe(before);
});

// ─────────────────────────── R3 ───────────────────────────

test('R3-1. 顺序真值在 Core：fresh CAS 写入成功 +1，陈旧版本写入 409（不静默覆盖）', async () => {
  const read = await coreJson('GET', `/projects/${PROJECT_ID}/view-rail-order`);
  expect(read.ok).toBe(true);
  const originalRefs: Array<{ kind: string; viewId: string }> = read.value.orderedRefs ?? [];
  const version: number = read.value.version;
  expect(originalRefs.length).toBeGreaterThanOrEqual(2);

  const reordered = [originalRefs[1]!, originalRefs[0]!, ...originalRefs.slice(2)];
  const fresh = await coreJson('PUT', `/projects/${PROJECT_ID}/view-rail-order`, {
    orderedRefs: reordered,
    expectedVersion: version,
  });
  expect(fresh.status, `fresh CAS 写入应成功: ${JSON.stringify(fresh.value)}`).toBe(200);
  expect(fresh.value.version).toBe(version + 1);
  expect(fresh.value.orderedRefs.map((ref: any) => ref.viewId)).toEqual(reordered.map((ref) => ref.viewId));

  const stale = await coreJson('PUT', `/projects/${PROJECT_ID}/view-rail-order`, {
    orderedRefs: originalRefs,
    expectedVersion: version,
  });
  expect(stale.status, '陈旧 expectedVersion 必须 409，不得静默覆盖').toBe(409);

  const reread = await coreJson('GET', `/projects/${PROJECT_ID}/view-rail-order`);
  expect(reread.value.version, '409 之后顺序真值必须保持在新版本上').toBe(version + 1);

  // 还原原始顺序（同一条 CAS 通道），避免留下 fixture 漂移
  const restore = await coreJson('PUT', `/projects/${PROJECT_ID}/view-rail-order`, {
    orderedRefs: originalRefs,
    expectedVersion: version + 1,
  });
  expect(restore.status).toBe(200);
  expect(restore.value.version).toBe(version + 2);
  expect(restore.value.orderedRefs.map((ref: any) => ref.viewId)).toEqual(originalRefs.map((ref) => ref.viewId));
});

test('R3-2. 浏览器 Railway 可达性：BLOCKED（本项目只有 root scope，root 行被冻结规则刻意隐藏）', async ({ page }) => {
  const graph = await coreJson('GET', `/projects/${PROJECT_ID}/graph`);
  const scopes: Array<{ id: string; kind: string }> = graph.value.scopes ?? [];
  const nonRootScopes = scopes.filter((scope) => scope.kind !== 'root');
  const read = await coreJson('GET', `/projects/${PROJECT_ID}/view-rail-order`);
  const refs: Array<{ kind: string; viewId: string }> = read.value.orderedRefs ?? [];
  const workspaceIds = new Set((graph.value.workspaces ?? []).map((w: any) => String(w.id)));
  const rootWorkspaceIds = new Set(
    (graph.value.workspaces ?? [])
      .filter((w: any) => scopes.find((scope) => scope.id === w.scopeId)?.kind === 'root')
      .map((w: any) => String(w.id)),
  );
  // 真值前提：顺序存在但全部指向 root scope 的工作现场 → 投影结果必须为空。
  expect(refs.length).toBeGreaterThan(0);
  expect(refs.every((ref) => workspaceIds.has(ref.viewId) && rootWorkspaceIds.has(ref.viewId))).toBe(true);
  expect(nonRootScopes, '若出现非 root scope，本 BLOCKED 结论必须重估').toHaveLength(0);

  await enterProject(page);
  expect(
    await page.locator('[data-lcos-railway]').count(),
    'root-scope 目的地不得渲染为 Railway（否则等于把 SurfaceDock 重复成第二份导航）',
  ).toBe(0);
});