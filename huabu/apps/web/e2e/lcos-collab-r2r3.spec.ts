// B6 R2 / R3 browser acceptance — acceptance repair round.
//
// R2：Professional Window 多区域 Stage（真实 click / Esc / camera）
// R3：Railway 导航 / 接收 / 溢出滚动 / 重排序 / 陈旧 409 —— 跑在**隔离 Core 里用 canonical API
//     建立的 Railway 专用 fixture project** 上（root scope + main root workspace + 22 个
//     non-root scope→child workspace destination + 真实 rail order）。
//
// R2-B REMAINING（本轮不施工、不冒充）：titlebar drag / 8-way resize / docked-right left-edge
// resize / clamp / explicit dock / ungroup / docked-right safeRect browser proof。
// 生产代码里 setWindowRegionLayout 没有任何 caller，因此 docked-right 在浏览器不可达。

import { expect, test } from '@playwright/test';

import {
  addRailDestination,
  changeSetIds,
  closeAllWindows,
  coreJson,
  enterProject,
  enterRailProject,
  openReaderWindow,
  readCamera,
  readRailOrder,
  railwayItemKeys,
  railwayScroller,
  seedRailwayFixture,
  writeRailOrder,
  type RailwayFixture,
} from './lcos-collab-harness';

test.describe.configure({ mode: 'serial' });

interface RegionBox { id: string | null; layout: string | null; x: number; y: number; w: number; h: number; z: number }

function readRegions(page: import('@playwright/test').Page): Promise<RegionBox[]> {
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

/**
 * 真实产品路径同时开两个窗口：Artifact Reader 窗口（双击 source 节点——image 不在
 * semantic-zoom LOD 表里，永远 full，用户可直接点到）+ Assembly 窗口（入口按钮）。
 */
async function openTwoWindows(page: import('@playwright/test').Page): Promise<void> {
  await openReaderWindow(page);
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
  for (const region of regions) {
    expect(region.w).toBeGreaterThanOrEqual(232);
    expect(region.h).toBeGreaterThanOrEqual(232);
  }
  const disjoint = a!.x + a!.w <= b!.x || b!.x + b!.w <= a!.x || a!.y + a!.h <= b!.y || b!.y + b!.h <= a!.y;
  expect(disjoint, `两区域 rect 必须不相交: ${JSON.stringify(regions)}`).toBe(true);
  expect(await page.locator('[data-lcos-window-icon-button]').count()).toBe(2);
});

test('R2-2. 前景激活区域正确 + 真实鼠标点击背景区域即激活该区域', async ({ page }) => {
  await enterProject(page);
  await openTwoWindows(page);
  let regions = await readRegions(page);
  const front = regions.find((region) => region.z === 2);
  const back = regions.find((region) => region.z === 1);
  expect(front, '恰好一个区域应为全局前景 (z=2)').toBeTruthy();
  expect(back, '恰好一个区域应为背景 (z=1)').toBeTruthy();
  // 真实鼠标点击：点在背景区域的 window chrome 标题区（只触发 Stage 的激活捕获，不碰任何控件）。
  const backRegion = page.locator(`[data-lcos-window-region-id="${back!.id}"]`);
  const box = await backRegion.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + 20, box!.y + 22);
  await page.waitForTimeout(500);
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
  expect(await readRegions(page)).toHaveLength(2);
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
  if (before.dock && after.dock) expect(Math.round(after.dock.x)).toBe(Math.round(before.dock.x));
  if (before.nav && after.nav) expect(Math.round(after.nav.x)).toBe(Math.round(before.nav.x));
});

test('R2-6. 窗口打开/关闭不移动 Canvas camera', async ({ page }) => {
  await enterProject(page);
  const before = await readCamera(page);
  await openTwoWindows(page);
  expect(await readCamera(page)).toBe(before);
  await closeAllWindows(page);
  await page.waitForTimeout(500);
  expect(await readCamera(page)).toBe(before);
});

// ─────────────────────────── R3 ───────────────────────────

let fixture: RailwayFixture;
test.beforeAll(async () => { fixture = await seedRailwayFixture(); });

test('R3-1. Railway 专用 fixture：destination 全部来自 Core 真值（非 page-local graph）', async ({ page }) => {
  const graph = await coreJson('GET', `/projects/${fixture.projectId}/graph`);
  const scopes = (graph.value.scopes ?? []) as Array<{ id: string; kind: string }>;
  const workspaces = (graph.value.workspaces ?? []) as Array<{ id: string; preferredSurface?: string; scopeId: string }>;
  expect(scopes.filter((scope) => scope.kind === 'root')).toHaveLength(1);
  expect(scopes.filter((scope) => scope.kind !== 'root').length).toBeGreaterThanOrEqual(22);
  const rootWorkspaceIds = new Set(
    workspaces.filter((w) => scopes.find((s) => s.id === w.scopeId)?.kind === 'root').map((w) => w.id));
  // root scope 的 workspace 不得成为 Railway destination（否则等于第二 SurfaceDock）
  expect(fixture.destIds.every((id) => !rootWorkspaceIds.has(id))).toBe(true);
  const order = await readRailOrder(fixture.projectId);
  expect(order.refs.map((ref) => ref.viewId)).toEqual([...fixture.destIds]);

  await enterRailProject(page, fixture);
  expect(await page.locator('[data-lcos-railway]').count()).toBe(1);
  expect(Number(await page.locator('[data-lcos-railway]').getAttribute('data-lcos-railway-version')))
    .toBeGreaterThanOrEqual(fixture.version);
  expect(await railwayItemKeys(page)).toEqual(fixture.destIds.map((id) => `scene:${id}`));
});

test('R3-2. Navigate：点击 destination 真正进入该 child workspace，不误切成 root Surface 语义', async ({ page }) => {
  await enterRailProject(page, fixture);
  const targetId = fixture.destIds[4]!;
  const item = page.locator(`[data-lcos-railway-item="scene:${targetId}"]`);
  const label = (await item.getAttribute('aria-label')) ?? '';
  expect(label.length).toBeGreaterThan(0);
  await item.click();
  await expect
    .poll(() => page.url(), { timeout: 20_000 })
    .toContain(`workspaceId=${targetId}`);
  const url = page.url();
  expect(url, '必须带 workspaceId（workspace-scoped 进入）').toContain(`workspaceId=${targetId}`);
  // 该行成为当前目的地（selected），且 surface 与 child workspace 的 preferredSurface 一致
  await expect(item).toHaveAttribute('aria-current', 'page', { timeout: 15_000 });
  await expect(item).toHaveAttribute('data-lcos-variant', 'selected');
  expect(new URL(url).pathname.endsWith('/context')).toBe(true);
});

test('R3-3. Receive：Assembly 原生 drag → Railway destination → preview=该目的地 → canonical apply 落账', async ({ page }) => {
  await enterRailProject(page, fixture);
  const changeSetsBefore = await changeSetIds(fixture.projectId);
  await page.locator('[data-lcos-assembly-entry]').first().click();
  await page.waitForSelector('[data-lcos-assembly]', { timeout: 25_000 });
  // 接收通道只裁定 note/resource/artifactView 进 workspace/scene；
  // scene/scope source 按冻结规则 unsupported（不能拿它们假装 Receive 成功）。
  const noteSource = page.locator('[data-lcos-assembly-item][data-lcos-assembly-item-kind="note"]');
  await expect(noteSource.first(), 'fixture 必须提供可接收的 note source').toBeVisible({ timeout: 20_000 });
  const item = noteSource.first();
  await item.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const railItem = page.locator(`[data-lcos-railway-item="scene:${fixture.destIds[2]!}"]`);
  await expect(railItem).toBeVisible();
  const railLabel = (await railItem.getAttribute('aria-label')) ?? '';
  const from = await item.boundingBox();
  const to = await railItem.boundingBox();
  expect(from, 'note source 必须在可视区内（否则 drag 起点无效）').not.toBeNull();
  expect(from!.y).toBeGreaterThan(0);
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + 20, from!.y + 12, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
  for (let i = 0; i < 10 && await page.locator('[data-lcos-drop-preview]').count() === 0; i += 1) {
    await page.mouse.move(to!.x + to!.width / 2 + (i % 2 === 0 ? 1 : -1), to!.y + to!.height / 2, { steps: 1 });
    await page.waitForTimeout(180);
  }
  const preview = page.locator('[data-lcos-drop-preview]').first();
  await expect(preview, 'Railway 接收目标必须给出 preview').toBeVisible({ timeout: 5_000 });
  expect((await preview.innerText()).trim(), 'preview 必须指向被悬停的那个 destination').toContain(railLabel);
  await page.mouse.up();

  // canonical commit：assembly apply 必须在 Core 落账（新增 ChangeSet），不靠 UI 自述
  await expect
    .poll(async () => (await changeSetIds(fixture.projectId)).filter((id) => !changeSetsBefore.includes(id)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  // Assembly 面板若给出回执，必须如实说已投放（不能是失败）
  const receipt = page.locator('[data-lcos-assembly-receipt]');
  if (await receipt.count() > 0) {
    expect((await receipt.first().innerText()).trim()).toContain('已投放');
  }
});

test('R3-4. Overflow：Railway 内部滚动改变 target DOM rect，registry 跟随刷新，滚动后仍能命中视觉位置', async ({ page }) => {
  await enterRailProject(page, fixture);
  const scroller = railwayScroller(page);
  const overflow = await scroller.evaluate((el) => ({ scrollHeight: (el as HTMLElement).scrollHeight, clientHeight: (el as HTMLElement).clientHeight }));
  expect(overflow.scrollHeight, 'fixture 必须让 Railway 可滚动（overflow 岛）').toBeGreaterThan(overflow.clientHeight);

  const lastKey = `scene:${fixture.destIds[fixture.destIds.length - 1]!}`;
  const lastItem = page.locator(`[data-lcos-railway-item="${lastKey}"]`);
  const beforeScroll = await lastItem.boundingBox();
  await scroller.evaluate((el) => { (el as HTMLElement).scrollTop = (el as HTMLElement).scrollHeight; });
  await page.waitForTimeout(600);
  const afterScroll = await lastItem.boundingBox();
  expect(beforeScroll).not.toBeNull();
  expect(afterScroll).not.toBeNull();
  expect(Math.round(afterScroll!.y), '滚动后 target 的 DOM rect 必须改变').not.toBe(Math.round(beforeScroll!.y));

  // 滚动后按视觉实际位置投放（registry 必须已跟随 DOM rect 刷新）
  await page.locator('[data-lcos-assembly-entry]').first().click();
  await page.waitForSelector('[data-lcos-assembly]', { timeout: 25_000 });
  const source = page.locator('[data-lcos-assembly-item][data-lcos-assembly-item-kind="note"]').first();
  await expect(source).toBeVisible({ timeout: 20_000 });
  await source.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const label = (await lastItem.getAttribute('aria-label')) ?? '';
  const from = await source.boundingBox();
  const to = await lastItem.boundingBox();
  expect(from, 'note source 必须在可视区内').not.toBeNull();
  expect(from!.y).toBeGreaterThan(0);
  expect(to).not.toBeNull();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + 20, from!.y + 12, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
  for (let i = 0; i < 10 && await page.locator('[data-lcos-drop-preview]').count() === 0; i += 1) {
    await page.mouse.move(to!.x + to!.width / 2 + (i % 2 === 0 ? 1 : -1), to!.y + to!.height / 2, { steps: 1 });
    await page.waitForTimeout(180);
  }
  const preview = page.locator('[data-lcos-drop-preview]').first();
  await expect(preview, '滚动后仍必须命中视觉上的那个 destination').toBeVisible({ timeout: 5_000 });
  expect((await preview.innerText()).trim()).toContain(label);
  await page.mouse.up();
  await page.waitForTimeout(500);
});

test('R3-5. Reorder：真实 drag → Core CAS write → reload 后 durable order 保持', async ({ page }) => {
  await enterRailProject(page, fixture);
  const keysBefore = await railwayItemKeys(page);
  const versionBefore = Number(await page.locator('[data-lcos-railway]').getAttribute('data-lcos-railway-version'));
  // 用滚动岛可视区内的两行（第 2 行 → 第 1 行上方），避免拖到岛外导致 dragstart 落在别的元素上。
  const movedKey = keysBefore[1]!;
  const targetKey = keysBefore[0]!;
  const moved = page.locator(`[data-lcos-railway-item="${movedKey}"]`);
  const target = page.locator(`[data-lcos-railway-item="${targetKey}"]`);
  await moved.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const movedBox = await moved.boundingBox();
  const targetBox = await target.boundingBox();
  expect(movedBox, '被拖动行必须在可视区内').not.toBeNull();
  expect(targetBox).not.toBeNull();
  const islandBox = await railwayScroller(page).boundingBox();
  expect(islandBox).not.toBeNull();
  expect(movedBox!.y).toBeGreaterThanOrEqual(islandBox!.y - 1);
  expect(movedBox!.y + movedBox!.height).toBeLessThanOrEqual(islandBox!.y + islandBox!.height + 1);
  // 真实原生 drag：拖到第一行上半区（placement='before'）
  await page.mouse.move(movedBox!.x + movedBox!.width / 2, movedBox!.y + movedBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(movedBox!.x + movedBox!.width / 2, movedBox!.y - 10, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 4, { steps: 12 });
  await page.waitForTimeout(300);
  await page.mouse.up();

  await expect
    .poll(async () => Number(await page.locator('[data-lcos-railway]').getAttribute('data-lcos-railway-version')), { timeout: 20_000 })
    .toBeGreaterThan(versionBefore);
  const keysAfter = await railwayItemKeys(page);
  expect(keysAfter[0]).toBe(movedKey);

  // durable：Core 真值 + reload 后 DOM 顺序都保持
  const order = await readRailOrder(fixture.projectId);
  expect(order.refs[0]?.viewId).toBe(movedKey.replace('scene:', ''));
  expect(order.version).toBeGreaterThan(versionBefore);
  await page.reload();
  await expect(page.locator('[data-lcos-railway]').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2000);
  expect((await railwayItemKeys(page))[0], 'reload 后 durable order 必须保持').toBe(movedKey);
});

test('R3-6. Stale 409：并发新增 destination 不被吞掉，回读 fresh order+graph 后才解锁', async ({ page }) => {
  await enterRailProject(page, fixture);
  const versionBefore = Number(await page.locator('[data-lcos-railway]').getAttribute('data-lcos-railway-version'));
  const keysBefore = await railwayItemKeys(page);

  // 另一路 Core 写入：新增一个 durable destination（版本前进，且顺序里多出一行）
  const concurrentId = await addRailDestination(fixture.projectId, 100);
  const orderAfterConcurrent = await readRailOrder(fixture.projectId);
  expect(orderAfterConcurrent.version).toBe(versionBefore + 1);
  expect(orderAfterConcurrent.refs.map((ref) => ref.viewId)).toContain(concurrentId);

  // Browser 仍持旧 version → 真实 drag reorder → 409 → 必须回读 fresh order + fresh graph
  const targetKey = keysBefore[0]!;
  const movedKey = keysBefore[2]!;
  const moved = page.locator(`[data-lcos-railway-item="${movedKey}"]`);
  const target = page.locator(`[data-lcos-railway-item="${targetKey}"]`);
  const movedBox = await moved.boundingBox();
  const targetBox = await target.boundingBox();
  await page.mouse.move(movedBox!.x + movedBox!.width / 2, movedBox!.y + movedBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(movedBox!.x + movedBox!.width / 2, movedBox!.y - 10, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + 4, { steps: 12 });
  await page.waitForTimeout(300);
  await page.mouse.up();

  // 冲突被如实呈现（不是静默吞掉），并且回读到并发后的最新顺序
  await expect
    .poll(async () => Number(await page.locator('[data-lcos-railway]').getAttribute('data-lcos-railway-version')), { timeout: 20_000 })
    .toBe(orderAfterConcurrent.version);
  const footer = page.locator('[data-lcos-railway-footer]');
  await expect(footer).toContainText('已在别处更新', { timeout: 20_000 });
  const keysAfter = await railwayItemKeys(page);
  expect(keysAfter, '并发新增的 destination 不得被 409 回读吞掉').toContain(`scene:${concurrentId}`);
  expect(keysAfter).toEqual(orderAfterConcurrent.refs.map((ref) => `scene:${ref.viewId}`));
  // Core 真值没有被旧 version 的那次 reorder 写坏（仍是并发写入后的顺序）
  const finalOrder = await readRailOrder(fixture.projectId);
  expect(finalOrder.refs.map((ref) => ref.viewId)).toEqual(orderAfterConcurrent.refs.map((ref) => ref.viewId));
});

test('R3-7. 顺序真值 CAS 契约：fresh 写入 +1，陈旧 expectedVersion 409，不静默覆盖', async () => {
  const read = await readRailOrder(fixture.projectId);
  expect(read.refs.length).toBeGreaterThanOrEqual(2);
  const reordered = [read.refs[1]!, read.refs[0]!, ...read.refs.slice(2)];
  const fresh = await writeRailOrder(fixture.projectId, reordered, read.version);
  expect(fresh.status, `fresh CAS 写入应成功: ${JSON.stringify(fresh.value)}`).toBe(200);
  expect(fresh.value.version).toBe(read.version + 1);
  expect(fresh.value.orderedRefs.map((ref: { viewId: string }) => ref.viewId)).toEqual(reordered.map((ref) => ref.viewId));

  const stale = await writeRailOrder(fixture.projectId, read.refs, read.version);
  expect(stale.status, '陈旧 expectedVersion 必须 409，不得静默覆盖').toBe(409);
  const reread = await readRailOrder(fixture.projectId);
  expect(reread.version, '409 之后真值必须停在新版本').toBe(read.version + 1);

  const restore = await writeRailOrder(fixture.projectId, read.refs, read.version + 1);
  expect(restore.status).toBe(200);
  expect(restore.value.orderedRefs.map((ref: { viewId: string }) => ref.viewId)).toEqual(read.refs.map((ref) => ref.viewId));
});