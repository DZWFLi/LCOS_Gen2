// R6 浏览器验收：ColorPin（颜色组 produceer 接通）+ canonical resolve 前往。
//
// 颜色组的 canonical owner 早已存在（GET / POST / DELETE /projects/:pid/color-pins，
// ChangeSet-backed；resolve 走 canonical NavigationMarkerService），此前前端没有任何 producer。
// 本 spec 只走真实入口：导航岛「+」→ 调色板 → 真实 assign → 岛显示 canonical 真色与成员数
// → 颜色组弹层 → navigation/resolve 前往 → 移除。不建第二 pin store、不猜目标。

import { expect, test } from '@playwright/test';

import {
  coreJson,
  dismissCanvasConflictToast,
  enterAssemblyProject,
  enterProject,
  enterRailProject,
  PROJECT_ID,
  readCamera,
  readRailOrder,
  seedAssemblyFixture,
  seedRailwayFixture,
  writeRailOrder,
} from './lcos-collab-harness';

test.describe.configure({ mode: 'serial' });

interface ColorPinSnapshot {
  readonly definitions: ReadonlyArray<{ readonly id: string; readonly color: string; readonly label?: string }>;
  readonly memberships: ReadonlyArray<{
    readonly id: string;
    readonly colorPinId: string;
    readonly targetRef: { readonly projectId?: string; readonly kind: string; readonly id: string };
  }>;
}

async function colorPins(projectId: string = PROJECT_ID): Promise<ColorPinSnapshot> {
  const read = await coreJson('GET', `/projects/${projectId}/color-pins`);
  expect(read.ok, `color-pins 读取必须可达：${read.status}`).toBe(true);
  return read.value as ColorPinSnapshot;
}

async function clearColorPins(projectId: string = PROJECT_ID): Promise<void> {
  for (const membership of (await colorPins(projectId)).memberships) {
    const removed = await coreJson('DELETE', `/projects/${projectId}/color-pins/memberships/${membership.id}`);
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
// ---- R6 Search / Focus / Locator：搜索 → 抵达链 ----

/** 用 canonical search 反证：查询词必须真的命中 Core 真值（不靠猜标题）。 */
async function queryWithHits(projectId: string = PROJECT_ID): Promise<{ query: string; title: string }> {
  const candidates = ['参考图', '项目定位', '施工纪律', '当前里程碑', '决策记录'];
  for (const query of candidates) {
    const read = await coreJson('GET', `/projects/${projectId}/search?q=${encodeURIComponent(query)}&limit=5`);
    if (!read.ok) continue;
    const hits = (read.value?.hits ?? []) as Array<{ title?: string | null }>;
    const hit = hits.find((item) => typeof item.title === 'string' && item.title.trim() !== '');
    if (hit !== undefined) return { query, title: String(hit.title) };
  }
  throw new Error('canonical search 对本 fixture 的候选词全部无命中——搜索索引不可用（诚实阻断，不是放宽断言）');
}

// ---- R6 Search → Arrival：Ctrl/Cmd+F = Search ----
//
// 登记范围：本用例只证明 **Search→Arrival PASS**（Ctrl/Cmd+F → canonical search →
// 抵达链收束 → 岛回静息）。`F = Focus/Where` 是另一条链（LcosFocusWhere），
// 不在此关闭，也不得与 Ctrl/Cmd+F 合并。

test('R6-2. Search→Arrival PASS：Ctrl+Cmd+F → Core 真值结果 → 抵达链收束 → 岛恢复静息（Focus/Where 不在本用例范围）', async ({ page }) => {
  await enterProject(page);
  await dismissCanvasConflictToast(page);
  const { query, title } = await queryWithHits();

  const cameraBefore = await readCamera(page);
  const island = page.locator('[data-lcos-navigator-island]').first();
  await page.keyboard.press('Control+f');
  const input = island.locator('[data-lcos-nav-part="input"]');
  await expect(input, 'Ctrl/Cmd+F 必须展开真实搜索输入').toBeVisible({ timeout: 15_000 });

  await input.fill(query);
  const results = page.locator('[data-lcos-navigator-results]').first();
  await expect(results, '搜索必须有真实结果面板（loading/empty/error 也走同一面板）').toBeVisible({ timeout: 20_000 });
  const first = results.locator('button').first();
  await expect(first, '查询词必须命中 Core 真值内容').toBeVisible({ timeout: 20_000 });
  await expect(first, '结果标题来自 canonical search，不是占位文案').toContainText(title.slice(0, 4));

  await first.click();
  // 抵达链只有两种诚实结局：同现场已投影 → 直接定位并收起搜索；
  // 否则 → 给出「前往并定位」的目的地（不假定位）。
  await expect.poll(async () => {
    if (await page.locator('[data-lcos-navigator-results]').count() === 0) return 'located';
    const text = (await island.innerText()) ?? '';
    return text.includes('前往并定位') || text.includes('位置暂不可打开') ? 'destination' : 'pending';
  }, { timeout: 25_000, message: '搜索结果必须收束到「已定位」或「给出可前往目的地」' }).not.toBe('pending');

  const located = await page.locator('[data-lcos-navigator-results]').count() === 0;
  if (located) {
    // 同现场定位真的移动 camera，且搜索态必须收起（岛恢复静息，不残留覆盖抵达目标）
    await expect.poll(async () => await readCamera(page), { timeout: 25_000 }).not.toBe(cameraBefore);
    await expect(input, '定位成功后搜索必须收起（岛回静息）').toHaveCount(0);
  }
});
// ---- R6 ColorPin semantic correction：target 必须来自 canonical surface ----

/** 打开调色板（真实入口），返回 palette 面板 locator。 */
async function openPalette(page: import('@playwright/test').Page) {
  const palettePanel = page.locator('[data-lcos-color-pin-palette]').first();
  if (await palettePanel.count() === 0) {
    await page.locator('[data-lcos-navigator-island] [data-lcos-nav-part="pin-add"]').first().click();
  }
  await expect(palettePanel).toBeVisible({ timeout: 15_000 });
  return palettePanel;
}

/** 真实点击 swatch 并等到 Core 真值出现该 membership；返回 canonical targetRef 文本。 */
async function assignSwatch(
  page: import('@playwright/test').Page,
  projectId: string,
  tone: 'violet' | 'teal' | 'amber',
): Promise<string> {
  const palettePanel = await openPalette(page);
  await expect(palettePanel, 'target 未解析时不得提供 swatch').toHaveAttribute('data-lcos-color-pin-target-state', 'resolved', { timeout: 15_000 });
  const target = (await palettePanel.getAttribute('data-lcos-color-pin-target')) ?? '';
  const before = (await colorPins(projectId)).memberships.length;
  await palettePanel.locator(`[data-lcos-color-pin-swatch="${tone}"]`).click();
  await expect.poll(async () => (await colorPins(projectId)).memberships.length, { timeout: 20_000 }).toBe(before + 1);
  return target;
}

test('R6-3. ColorPin target 必须是 canonical surface（main / scope:<exact>），且 many-to-many + 单条移除', async ({ page }) => {
  test.slow();
  const fixture = await seedAssemblyFixture();
  await clearColorPins(fixture.projectId);
  await enterAssemblyProject(page, fixture);
  await dismissCanvasConflictToast(page);

  // 1) root Main → 必须是 canonical `main`（不是 workspace:<activeWorkspaceId>）
  const mainTarget = await assignSwatch(page, fixture.projectId, 'violet');
  expect(mainTarget, 'root Main 必须映射为 canonical main').toBe('main');
  const afterMain = await colorPins(fixture.projectId);
  expect(afterMain.memberships[0]!.targetRef).toEqual({ projectId: fixture.projectId, kind: 'surface', id: 'main' });

  // 2) many-to-many：同一 target 再标一个颜色，两个 membership 同时存在
  const secondTarget = await assignSwatch(page, fixture.projectId, 'teal');
  expect(secondTarget).toBe('main');
  const both = await colorPins(fixture.projectId);
  const mainMemberships = both.memberships.filter((m) => m.targetRef.id === 'main');
  expect(mainMemberships, '同一 target 必须能同时属于两个颜色组').toHaveLength(2);
  expect(new Set(mainMemberships.map((m) => m.colorPinId)).size).toBe(2);

  // 已属的两色只标 assigned；第三种颜色仍可继续标记
  const palettePanel = await openPalette(page);
  await expect(palettePanel.locator('[data-lcos-color-pin-swatch="violet"]')).toHaveAttribute('data-lcos-color-pin-swatch-assigned', 'true');
  await expect(palettePanel.locator('[data-lcos-color-pin-swatch="teal"]')).toHaveAttribute('data-lcos-color-pin-swatch-assigned', 'true');
  await expect(palettePanel.locator('[data-lcos-color-pin-swatch="amber"]')).toHaveAttribute('data-lcos-color-pin-swatch-assigned', 'false');
  await expect(palettePanel.locator('[data-lcos-color-pin-swatch="amber"]')).toBeEnabled();

  // 3) 单条移除：移除一个后另一个仍在（many-to-many，不是「一个 target 只能一个 pin」）
  await palettePanel.locator('[data-lcos-color-pin-remove-current]').first().click();
  await expect.poll(async () => (await colorPins(fixture.projectId)).memberships.filter((m) => m.targetRef.id === 'main').length, { timeout: 20_000 }).toBe(1);
  const remaining = await colorPins(fixture.projectId);
  expect(remaining.memberships.filter((m) => m.targetRef.id === 'main')).toHaveLength(1);

  // 4) root Context → 必须是 scope:<exact contextScopeId>
  await page.locator('[data-lcos-surface="context"]').first().click();
  await page.waitForTimeout(1500);
  const contextTarget = await assignSwatch(page, fixture.projectId, 'violet');
  expect(contextTarget, 'root Context 必须是 exact context scope').toBe(`scope:scope-assembly-context-${fixture.projectId}`);
  expect(contextTarget).not.toContain('workspace:');

  // 5) root Workflow → 必须是 scope:<exact workflowScopeId>
  await page.locator('[data-lcos-surface="workflow"]').first().click();
  await page.waitForTimeout(1500);
  const workflowTarget = await assignSwatch(page, fixture.projectId, 'teal');
  expect(workflowTarget, 'root Workflow 必须是 exact workflow scope').toBe(`scope:scope-assembly-workflow-${fixture.projectId}`);
});

test('R6-4. 显式子工作现场 → workspace:<exact>；root scope 不唯一时 fail closed（不选第一个 workspace）', async ({ page }) => {
  test.slow();
  // 显式子工作现场：Railway fixture 的 rail destination 是真实存在的 workspace
  const fixture = await seedRailwayFixture();
  await clearColorPins(fixture.projectId);
  await enterRailProject(page, fixture);
  await dismissCanvasConflictToast(page);

  const childId = fixture.destIds[0]!;
  await page.goto(`/projects/${fixture.projectId}/context?workspaceId=${encodeURIComponent(childId)}`);
  await expect(page.locator('[data-lcos-project-shell]').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2500);
  await dismissCanvasConflictToast(page);

  const childTarget = await assignSwatch(page, fixture.projectId, 'amber');
  expect(childTarget, '显式子工作现场必须映射为 exact workspace').toBe(`workspace:${childId}`);
  const childMemberships = (await colorPins(fixture.projectId)).memberships;
  expect(childMemberships[0]!.targetRef).toEqual({ projectId: fixture.projectId, kind: 'surface', id: `workspace:${childId}` });

  // 同一项目回到 root Context：多个 context scope 无法唯一解析 → fail closed（不得取第一个）
  await page.goto(`/projects/${fixture.projectId}/context`);
  await expect(page.locator('[data-lcos-project-shell]').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForTimeout(2000);
  await dismissCanvasConflictToast(page);
  const palettePanel = await openPalette(page);
  await expect(palettePanel, 'root scope 不唯一时必须 fail closed').toHaveAttribute('data-lcos-color-pin-target-state', 'unavailable', { timeout: 15_000 });
  await expect(palettePanel.locator('[data-lcos-color-pin-swatch]')).toHaveCount(0);
  const beforeUnavailable = (await colorPins(fixture.projectId)).memberships.length;
  await page.waitForTimeout(800);
  expect((await colorPins(fixture.projectId)).memberships.length, 'fail closed 时不得写入任何 membership').toBe(beforeUnavailable);
});
// ---- R6 Focus / Locator：F = Focus/Where（与 Ctrl/Cmd+F Search 严格分离） ----

test('R6-5. Focus/Where（F）：已知对象「在哪」真实枚举 + 前往；与 Ctrl/Cmd+F Search 不合并', async ({ page }) => {
  test.slow();
  await enterProject(page);
  await dismissCanvasConflictToast(page);

  const focusWhereOpen = page.locator('[data-lcos-focus-where][data-open="true"]');
  const searchInput = page.locator('[data-lcos-navigator-island] [data-lcos-nav-part="input"]');

  // 1) Ctrl/Cmd+F 是 Search —— 绝不打开 Focus/Where（两条链不得合并）
  await page.keyboard.press('Control+f');
  await expect(searchInput, 'Ctrl/Cmd+F 必须打开 Search').toBeVisible({ timeout: 15_000 });
  await expect(focusWhereOpen, 'Ctrl/Cmd+F 不得打开 Focus/Where').toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(searchInput).toHaveCount(0, { timeout: 10_000 });

  // 2) 没有选中对象时按 F：诚实说明，不假枚举
  await page.keyboard.press('f');
  await expect(focusWhereOpen, 'F 必须打开 Focus/Where').toBeVisible({ timeout: 15_000 });
  await expect(focusWhereOpen).toContainText('没有选中的对象');
  await page.keyboard.press('Escape');
  await expect(focusWhereOpen).toHaveCount(0, { timeout: 10_000 });

  // 3) 真实选中一个已投影对象再按 F：标题必须来自 canonical descriptor
  const node = page.locator('.react-flow__node-image').first();
  await expect(node, 'fixture 必须有可点选的已投影对象').toBeVisible({ timeout: 40_000 });
  await node.click();
  await page.waitForTimeout(500);
  const cameraBefore = await readCamera(page);
  await page.keyboard.press('f');
  await expect(focusWhereOpen).toBeVisible({ timeout: 15_000 });
  const panelText = (await focusWhereOpen.textContent()) ?? '';
  expect(panelText, 'Focus/Where 必须回答「在哪」').toContain('在哪 ·');
  expect(panelText, '标题不得回落成占位文案（说明没读到 canonical descriptor）').not.toContain('在哪 · 当前对象');

  // 4) 有其它投影 → 真实「前往」并移动 camera；否则必须诚实空态（不假列表）
  const go = focusWhereOpen.getByRole('button', { name: /前往/ });
  if (await go.count() > 0) {
    await go.first().click();
    await expect.poll(async () => await readCamera(page), { timeout: 25_000 }).not.toBe(cameraBefore);
    await expect(focusWhereOpen, '前往成功后必须收起').toHaveCount(0, { timeout: 10_000 });
  } else {
    await expect(focusWhereOpen).toContainText(/在当前现场没有其它投影|跨现场位置读取失败|暂时无法/);
    await page.keyboard.press('Escape');
    await expect(focusWhereOpen).toHaveCount(0, { timeout: 10_000 });
  }
});
// ---- R6 ColorPin initial hydration + project isolation（薄修 bug 的 focused 证据） ----
//
// bug：岛把 init snapshot 与 project reset 拆成两个 effect，reset 的 generation bump 把刚发出的
// snapshot 判成 stale → 项目本来已有 ColorPin 时首屏不显示，只有后续 assign/remove 才带回来。
// 下面两条在真实浏览器 / 真实 Core 上钉死修好后的行为。

const PIN_VIOLET = '#6371DD';
const PIN_TEAL = '#238E86';

async function seedSurfacePin(projectId: string, color: string): Promise<void> {
  const made = await coreJson('POST', `/projects/${projectId}/color-pins/memberships`, {
    targetRef: { projectId, kind: 'surface', id: 'main' },
    color,
  });
  expect(made.ok, `seed color pin 必须成功：${made.status} ${JSON.stringify(made.value)}`).toBe(true);
}

function islandPins(page: import('@playwright/test').Page) {
  return page.locator('[data-lcos-navigator-island] [data-lcos-nav-part="pin"]');
}

test('R6-6. 项目本来已有 ColorPin：初次 mount 不做任何操作就必须显示（hydration）', async ({ page }) => {
  await clearColorPins();
  // 关键：pin 在「进入项目之前」就已存在于 canonical truth。
  await seedSurfacePin(PROJECT_ID, PIN_VIOLET);

  await enterProject(page);
  await dismissCanvasConflictToast(page);

  // 不做任何点击 / assign / remove：岛必须自己把已有 pin 读出来。
  const pins = islandPins(page);
  await expect(pins, '已有 ColorPin 必须在首屏自动 hydrate（不得等用户操作）').toHaveCount(1, { timeout: 25_000 });
  await expect(pins).toHaveAttribute('data-lcos-pin-color', PIN_VIOLET);
  await expect(pins).toHaveAttribute('data-lcos-pin-count', '1');
});

test('R6-7. 项目切换隔离：切到 B 后必须显示 B 自己的 pin，且 A 的 pin 不得残留/覆盖', async ({ page }) => {
  test.slow();
  const assembly = await seedAssemblyFixture();
  // A（当前项目）与 B（另一个项目）各自有不同颜色的 ColorPin。
  await clearColorPins();
  await clearColorPins(assembly.projectId);
  await seedSurfacePin(PROJECT_ID, PIN_VIOLET);
  await seedSurfacePin(assembly.projectId, PIN_TEAL);

  await enterProject(page);
  await expect(islandPins(page), 'A 自己的 pin 必须显示').toHaveAttribute('data-lcos-pin-color', PIN_VIOLET, { timeout: 25_000 });

  // 真实 SPA 切换项目（不经整页 reload）：壳上的项目胶囊 → 项目列表 → 点目标项目。
  await page.locator('[data-lcos-project-shell] a[href="/projects"]').first().click();
  await expect(page.locator('[data-lcos-launcher]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /LCOS Assembly E2E/ }).first().click();

  // B 的 pin 必须出现；A 的 pin（另一个颜色）不得残留。
  await expect(islandPins(page), 'B 自己的 pin 必须 hydrate').toHaveAttribute('data-lcos-pin-color', PIN_TEAL, { timeout: 30_000 });
  await expect(islandPins(page)).toHaveCount(1);
  await expect(islandPins(page), 'A 的 pin 不得覆盖 B').not.toHaveAttribute('data-lcos-pin-color', PIN_VIOLET);
});
// ---- R6 Locator / Camera / Arrival ----

test('R6-8. Locator/Camera/Arrival：定位后目标真的进入视口、camera 静止、locator cue 只报诚实状态', async ({ page }) => {
  test.slow();
  await enterProject(page);
  await dismissCanvasConflictToast(page);
  const { query, title } = await queryWithHits();

  const cameraBefore = await readCamera(page);
  await page.keyboard.press('Control+f');
  const island = page.locator('[data-lcos-navigator-island]').first();
  const input = island.locator('[data-lcos-nav-part="input"]');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(query);
  const first = page.locator('[data-lcos-navigator-results] button').first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.click();

  // 抵达链收束（同 R6-2 的两种诚实结局）
  await expect.poll(async () => {
    if (await page.locator('[data-lcos-navigator-results]').count() === 0) return 'located';
    const text = (await island.innerText()) ?? '';
    return text.includes('前往并定位') || text.includes('位置暂不可打开') ? 'destination' : 'pending';
  }, { timeout: 25_000 }).not.toBe('pending');

  const located = await page.locator('[data-lcos-navigator-results]').count() === 0;
  if (located) {
    // 真实抵达：camera 变化后必须静下来（无漂移），且目标真的在视口内。
    await expect.poll(async () => await readCamera(page), { timeout: 25_000 }).not.toBe(cameraBefore);
    await page.waitForTimeout(1200);
    const settled = await readCamera(page);
    await page.waitForTimeout(1200);
    expect(await readCamera(page), '抵达后 camera 必须静止（不得继续漂移）').toBe(settled);

    const node = page.locator('.react-flow__node', { hasText: title.slice(0, 4) }).first();
    if (await node.count() > 0) {
      const box = await node.boundingBox();
      const viewport = page.viewportSize()!;
      expect(box, '抵达后目标节点必须有几何').not.toBeNull();
      expect(box!.x, '抵达后目标必须在视口内（左）').toBeGreaterThan(-1);
      expect(box!.y, '抵达后目标必须在视口内（上）').toBeGreaterThan(-1);
      expect(box!.x, '抵达后目标必须在视口内（右）').toBeLessThan(viewport.width);
      expect(box!.y, '抵达后目标必须在视口内（下）').toBeLessThan(viewport.height);
    }
  }

  // locator cue 只允许诚实状态；抵达完成后不得留下残留 cue。
  const cue = page.locator('[data-lcos-locator]');
  if (await cue.count() > 0) {
    const state = await cue.first().getAttribute('data-lcos-locator');
    expect(['edge', 'near-edge', 'unavailable'], `locator cue 不得报未知状态：${state}`).toContain(state);
  }
  await expect.poll(async () => await cue.count(), { timeout: 15_000 }).toBe(0);
});

// ---- R6 Spatial Navigator：不假定位 / 不假前往 ----

test('R6-9. Spatial Navigator：点击结果只能「真抵达」或「给真实目的地」，绝不假前往', async ({ page }) => {
  test.slow();
  await enterProject(page);
  await dismissCanvasConflictToast(page);
  const { query } = await queryWithHits();

  const cameraBefore = await readCamera(page);
  await page.keyboard.press('Control+f');
  const island = page.locator('[data-lcos-navigator-island]').first();
  const input = island.locator('[data-lcos-nav-part="input"]');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.fill(query);
  const first = page.locator('[data-lcos-navigator-results] button').first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  const urlBefore = page.url();
  await first.click();

  await expect.poll(async () => {
    if (await page.locator('[data-lcos-navigator-results]').count() === 0) return 'located';
    const text = (await island.innerText()) ?? '';
    return text.includes('前往并定位') || text.includes('位置暂不可打开') || text.includes('尚无可定位的位置') ? 'destination' : 'pending';
  }, { timeout: 25_000 }).not.toBe('pending');

  const located = await page.locator('[data-lcos-navigator-results]').count() === 0;
  if (located) {
    await expect.poll(async () => await readCamera(page), { timeout: 25_000 }).not.toBe(cameraBefore);
    return;
  }

  // 没有真抵达 → 必须留在原地（不得假前往），且只能给真实目的地或诚实说明。
  expect(page.url(), '未真抵达时不得静默改变路由').toBe(urlBefore);
  const travel = island.getByRole('button', { name: '前往并定位' });
  if (await travel.count() > 0) {
    await expect(travel.first()).toBeEnabled();
    const cameraBeforeTravel = await readCamera(page);
    await travel.first().click();
    // 诚实不变量：点击必须产生真实后果（真切换/真抵达）或明确说明，绝不静默无果。
    await expect.poll(async () => {
      if (page.url() !== urlBefore) return 'navigated';
      if ((await readCamera(page)) !== cameraBeforeTravel) return 'located';
      const text = (await island.innerText()) ?? '';
      return /无法|尚未就绪|暂时|失败|没有可用画布/.test(text) ? 'honest' : 'pending';
    }, { timeout: 30_000, message: '点击「前往并定位」不得静默无果' }).not.toBe('pending');
  } else {
    await expect(island).toContainText(/位置暂不可打开|尚无可定位的位置|投影尚未就绪/);
  }
});

// ---- R6 Railway residual：版本真值跟随 ----

test('R6-10. Railway residual：显示的 order version 必须等于 canonical 真值', async ({ page }) => {
  test.slow();
  const fixture = await seedRailwayFixture();
  await enterRailProject(page, fixture);
  await dismissCanvasConflictToast(page);

  const rail = page.locator('[data-lcos-railway]').first();
  await expect(rail).toBeVisible({ timeout: 30_000 });
  const canonical = await readRailOrder(fixture.projectId);
  await expect(rail, 'Railway 必须显示 canonical order version（不得自造版本）')
    .toHaveAttribute('data-lcos-railway-version', String(canonical.version), { timeout: 20_000 });

  // canonical 真值前进 → 显示必须跟随（不是本地自增）
  const advanced = await writeRailOrder(fixture.projectId, canonical.refs.map((ref) => ({ kind: ref.kind, viewId: ref.viewId })), canonical.version);
  expect(advanced.ok, `写入 order 必须成功：${advanced.status}`).toBe(true);
  const next = await readRailOrder(fixture.projectId);
  expect(next.version).toBeGreaterThan(canonical.version);
  await page.reload();
  await expect(page.locator('[data-lcos-railway]').first()).toHaveAttribute('data-lcos-railway-version', String(next.version), { timeout: 30_000 });
});

// ---- R6 visual / motion：semantic zoom LOD 与 reduced-motion ----

test('R6-11. visual/motion：semantic zoom LOD 真实收放（缩小时 body 收起，不是假渲染）', async ({ page }) => {
  test.slow();
  await enterProject(page);
  await dismissCanvasConflictToast(page);

  const glyphBody = page.locator('[data-lcos-glyth-body]').first();
  await expect(glyphBody).toBeAttached({ timeout: 60_000 });
  // 冻结规则：默认缩放下注释类节点渲染最小占位符，body 不参与命中。
  const collapsedAtRest = !(await glyphBody.isVisible());

  // 真实 Ctrl+滚轮进入 full LOD，body 必须真的出现（不是靠合成事件伪装）
  await page.keyboard.down('Control');
  const box0 = await glyphBody.boundingBox();
  if (box0 !== null) {
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    for (let i = 0; i < 8; i += 1) {
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(180);
      if (await glyphBody.isVisible()) break;
    }
  }
  await page.keyboard.up('Control');
  await expect(glyphBody, '进入 full LOD 后 body 必须真的可见').toBeVisible({ timeout: 15_000 });
  expect(collapsedAtRest, '默认缩放下应处于收起态（否则本用例失去对照）').toBe(true);

  // 再缩回去：body 必须重新收起（LOD 是双向真实的）
  await page.keyboard.down('Control');
  const box1 = await glyphBody.boundingBox();
  if (box1 !== null) {
    await page.mouse.move(box1.x + box1.width / 2, box1.y + box1.height / 2);
    for (let i = 0; i < 12 && await glyphBody.isVisible(); i += 1) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(180);
    }
  }
  await page.keyboard.up('Control');
  await expect(glyphBody, '缩回后 body 必须重新收起').not.toBeVisible({ timeout: 15_000 });
});

test('R6-12. motion：prefers-reduced-motion 下应用仍然可用（不 brick）', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterProject(page);
  await dismissCanvasConflictToast(page);
  await page.keyboard.press('Control+f');
  await expect(page.locator('[data-lcos-navigator-island] [data-lcos-nav-part="input"]'), '减少动效不得让搜索不可用')
    .toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-lcos-glyth-body]').first()).toBeAttached({ timeout: 30_000 });
});