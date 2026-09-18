// R6 浏览器验收：ColorPin（颜色组 produceer 接通）+ canonical resolve 前往。
//
// 颜色组的 canonical owner 早已存在（GET / POST / DELETE /projects/:pid/color-pins，
// ChangeSet-backed；resolve 走 canonical NavigationMarkerService），此前前端没有任何 producer。
// 本 spec 只走真实入口：导航岛「+」→ 调色板 → 真实 assign → 岛显示 canonical 真色与成员数
// → 颜色组弹层 → navigation/resolve 前往 → 移除。不建第二 pin store、不猜目标。

import { expect, test } from '@playwright/test';

import { coreJson, dismissCanvasConflictToast, enterProject, PROJECT_ID } from './lcos-collab-harness';

test.describe.configure({ mode: 'serial' });

interface ColorPinSnapshot {
  readonly definitions: ReadonlyArray<{ readonly id: string; readonly color: string; readonly label?: string }>;
  readonly memberships: ReadonlyArray<{
    readonly id: string;
    readonly colorPinId: string;
    readonly targetRef: { readonly kind: string; readonly id: string };
  }>;
}

async function colorPins(): Promise<ColorPinSnapshot> {
  const read = await coreJson('GET', `/projects/${PROJECT_ID}/color-pins`);
  expect(read.ok, `color-pins 读取必须可达：${read.status}`).toBe(true);
  return read.value as ColorPinSnapshot;
}

async function clearColorPins(): Promise<void> {
  for (const membership of (await colorPins()).memberships) {
    const removed = await coreJson('DELETE', `/projects/${PROJECT_ID}/color-pins/memberships/${membership.id}`);
    expect(removed.ok, `清理颜色组必须成功：${removed.status}`).toBe(true);
  }
}

test('R6-1. ColorPin：真实入口标记当前现场 → canonical 落账 → 岛显真色/成员数 → resolve 前往 → 移除', async ({ page }) => {
  await clearColorPins();
  await enterProject(page);
  // Huabu 原生内容冲突浮层与导航岛同占 top-center：按用户方式先裁决掉（只登记，不绕过）。
  await dismissCanvasConflictToast(page);

  const island = page.locator('[data-lcos-navigator-island]').first();
  await expect(island).toBeVisible({ timeout: 30_000 });
  await expect(island.locator('[data-lcos-nav-part="pin"]'), '清理后不应有历史颜色组').toHaveCount(0);

  // 真实入口：岛上的「+」→ 调色板
  await island.locator('[data-lcos-nav-part="pin-add"]').click();
  const palettePanel = page.locator('[data-lcos-color-pin-palette]').first();
  await expect(palettePanel).toBeVisible({ timeout: 15_000 });
  const swatch = palettePanel.locator('[data-lcos-color-pin-swatch="teal"]');
  await expect(swatch, '调色板必须由设计 token 提供（canonical #RRGGBB）').toBeVisible();
  const swatchColor = await swatch.evaluate((node) => getComputedStyle(node as HTMLElement).backgroundColor);
  await swatch.click();

  // canonical 落账：真实 ChangeSet 写入，颜色/目标来自 Core 真值
  await expect.poll(async () => (await colorPins()).memberships.length, { timeout: 20_000 }).toBe(1);
  const snapshot = await colorPins();
  const definition = snapshot.definitions.find((item) => item.id === snapshot.memberships[0]!.colorPinId)!;
  const membership = snapshot.memberships[0]!;
  expect(definition.color, 'Core 只接受 canonical #RRGGBB').toMatch(/^#[0-9A-F]{6}$/);

  // 岛显示 1 个颜色组：canonical 颜色 + 成员数 1（不是本地估算）
  const pin = island.locator('[data-lcos-nav-part="pin"]');
  await expect(pin).toHaveCount(1, { timeout: 20_000 });
  await expect(pin).toHaveAttribute('data-lcos-pin-color', definition.color);
  await expect(pin).toHaveAttribute('data-lcos-pin-count', '1');
  const renderedColor = await pin.locator('[data-lcos-pin-mark]').evaluate((node) => getComputedStyle(node as HTMLElement).color);
  expect(renderedColor, '岛必须按 canonical 色渲染（不是 tone 近似色）').toBe(swatchColor);

  // canonical resolve：颜色组目标必须解析成真实 surface（跨现场抵达的数据面）
  const resolved = await coreJson('POST', `/projects/${PROJECT_ID}/navigation/resolve`, {
    targetRef: { projectId: PROJECT_ID, kind: membership.targetRef.kind, id: membership.targetRef.id },
  });
  expect(resolved.ok).toBe(true);
  expect(resolved.value.status, 'canonical resolve 必须 resolved（不模糊重绑）').toBe('resolved');
  const surfaceRef = String(resolved.value.target.surfaceRef);

  // 颜色组弹层：成员 + 前往
  await pin.click();
  const members = page.locator('[data-lcos-color-pin-members]').first();
  await expect(members).toBeVisible({ timeout: 15_000 });
  await expect(members.locator(`[data-lcos-color-pin-member="${membership.id}"]`)).toBeVisible();

  await members.locator('[data-lcos-color-pin-travel]').click();
  if (surfaceRef.startsWith('workspace:')) {
    await expect(page, '前往 workspace 目标必须真的进入该子现场').toHaveURL(/workspaceId=/, { timeout: 25_000 });
  } else {
    await expect(page, '前往 main 目标必须留在 main 现场').toHaveURL(/\/main(\?|$)/, { timeout: 25_000 });
  }

  // 移除：canonical membership 归零，岛回到静息
  await dismissCanvasConflictToast(page);
  // 颜色组弹层是切换式的：没开就先开（用户等价动作），别把已开的关掉。
  if (await page.locator('[data-lcos-color-pin-remove]').count() === 0) {
    await page.locator('[data-lcos-navigator-island] [data-lcos-nav-part="pin"]').first().click();
  }
  await expect(page.locator('[data-lcos-color-pin-remove]').first()).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-lcos-color-pin-remove]').first().click();
  await expect.poll(async () => (await colorPins()).memberships.length, { timeout: 20_000 }).toBe(0);
  await expect(page.locator('[data-lcos-navigator-island] [data-lcos-nav-part="pin"]')).toHaveCount(0, { timeout: 20_000 });
});