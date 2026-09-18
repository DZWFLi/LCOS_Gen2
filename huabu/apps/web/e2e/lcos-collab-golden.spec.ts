// B5 Receiver-Seeded Browser Golden Path — acceptance repair round.
//
// 真实栈（hermetic）：见 e2e/lcos-collab-golden.playwright.config.ts（run 专属 temp DB/workspace）。
// 用户动作纪律：真实 locator 手势（click / dblclick / mouse / wheel）；semantic zoom 未展开时
// 不对 hidden 的 species body 派发合成事件（见 harness.revealGlyth）。

import { expect, test } from '@playwright/test';

import {
  PROJECT_ID,
  assertHermeticCore,
  closeAllWindows,
  coreConversationTitles,
  coreJson,
  enterProject,
  glyphIndexByTitle,
  openWorkView,
  openWorkViewByTitle,
  readCamera,
  readGlyths,
  revealGlyth,
  seedReceiverConversations,
  titleOfGlyph,
  type ReceiverSeed,
} from './lcos-collab-harness';

test.describe.configure({ mode: 'serial' });

const ALLOWED_USER_STATES = ['ready', 'thinking', 'working', 'needs_user', 'done', 'unavailable'];

let seed: ReceiverSeed;
test.beforeAll(async () => {
  await assertHermeticCore();
  seed = await seedReceiverConversations();
});

// ─────────────────────────── B5 ───────────────────────────

test('A0. Hermetic：本次 run 的 Core 跑在 run 专属 temp DB，不触碰开发 .data', async () => {
  await assertHermeticCore();
});

test('A. Bound Glyth 投影：identity 来自真实 Core，用户态只在 6 态词表内', async ({ page }) => {
  await enterProject(page);
  const glyphs = await readGlyths(page);
  expect(glyphs.length).toBeGreaterThanOrEqual(2);
  const knownTitles = await coreConversationTitles();
  for (const glyph of glyphs) {
    expect(glyph.label ?? '').toContain('双击打开会话窗口');
    expect(glyph.state === null || ALLOWED_USER_STATES.includes(glyph.state)).toBe(true);
    // identity 必须能在 Core 里找到同名 conversation —— 不是画布自造标题。
    expect(knownTitles, `Glyth「${titleOfGlyph(glyph.label)}」必须在 Core conversation 真值里`).toContain(titleOfGlyph(glyph.label));
  }
  const titles = glyphs.map((glyph) => titleOfGlyph(glyph.label)).join('|');
  expect(titles).toContain(seed.label1);
  expect(titles).toContain(seed.label2);
});

test('B. Work View：真实双击进入，identity/state 正确，无假 attention', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  await expect(page.locator('[data-lcos-conversation-header]').first()).toBeVisible({ timeout: 10_000 });
  const stateText = await page.locator('[data-lcos-conversation-user-state]').first().textContent();
  expect((stateText ?? '').trim().length).toBeGreaterThan(0);
  expect(await page.locator('[data-lcos-waiting-input]').count()).toBe(0);
  await page.locator('[data-lcos-diagnostics-toggle]').first().click();
  await expect(page.locator('[data-lcos-diagnostics]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('[data-lcos-recovery-section]').first()).toBeVisible({ timeout: 10_000 });
});

test('C. Composer target = canonical conversation（无二次 Session 选择）', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  await page.locator('[data-lcos-open-work-composer]').first().click();
  const composer = page.locator('[data-lcos-composer]').first();
  await expect(composer).toBeVisible({ timeout: 10_000 });
  const targetId = await composer.getAttribute('data-lcos-composer-target');
  expect(targetId ?? '').toContain('conversation:');
  expect(await page.locator('[data-lcos-session-chooser], [data-lcos-receiver-picker], [data-lcos-session-picker]').count()).toBe(0);
});

test('D. Delegate 真成功：产品层 success receipt + Core 新增 canonical Run（instruction 对得上）', async ({ page }) => {
  const marker = `e2e-delegate-${Date.now()}`;
  const before = await coreJson('GET', `/projects/${PROJECT_ID}/runs`);
  expect(before.ok, 'Core runs 读面必须可用').toBe(true);
  const beforeIds = new Set((before.value ?? []).map((row: any) => String(row.run?.id ?? '')));
  await enterProject(page);
  await openWorkView(page);
  await page.locator('[data-lcos-open-work-composer]').first().click();
  const composer = page.locator('[data-lcos-composer]').first();
  await expect(composer).toBeVisible({ timeout: 10_000 });
  const input = page.locator('[data-lcos-composer-input]');
  await input.fill(`请处理 ${marker}`);
  // 真实产品提交动作：点击 Composer 的提交按钮（不是 Ctrl+Enter 快捷键旁路）。
  const submit = page.getByRole('button', { name: '提交' });
  await expect(submit, 'Composer 提交按钮必须可用（workspace + receiver 均已解析）').toBeEnabled({ timeout: 10_000 });
  await submit.click();
  await expect(composer).toContainText('Run 已创建', { timeout: 30_000 });
  const composerText = (await composer.textContent()) ?? '';
  expect(composerText, `delegate 不得以失败收场：${composerText.trim().slice(0, 200)}`).not.toContain('提交失败');
  expect(await page.locator('[data-lcos-composer-blocked], [data-lcos-composer-receiver-blocked]').count()).toBe(0);

  const after = await coreJson('GET', `/projects/${PROJECT_ID}/runs`);
  const newRuns = (after.value ?? []).filter((row: any) => !beforeIds.has(String(row.run?.id ?? '')));
  expect(newRuns.length, 'Core 必须新增 canonical Run').toBeGreaterThanOrEqual(1);
  const matched = newRuns.find((row: any) => String(row.run?.instruction ?? '').includes(marker));
  expect(matched, `新 Run 的 instruction 必须与提交内容一致`).toBeTruthy();
  expect(String(matched.run.instruction).trim()).toBe(`请处理 ${marker}`);
});

test('E1. Waiting Input 负路径：没有 pending input 时诚实为空', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  expect(await page.locator('[data-lcos-waiting-input]').count()).toBe(0);
  const stateText = (await page.locator('[data-lcos-conversation-user-state]').first().textContent()) ?? '';
  expect(stateText.trim()).not.toBe('等你回应');
});

test('F1. Review 负路径：没有 pending return 时不渲染复核面', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  expect(await page.locator('[data-lcos-artifact-return]').count()).toBe(0);
});

test('G1. Recovery 负路径：普通 Work View 不暴露 T6 raw，raw 只在 Diagnostics', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  const firstScreen = (await page.locator('[data-lcos-conversation-work-view]').first().textContent()) ?? '';
  expect(firstScreen).not.toMatch(/external_create|core_bind|outcome_unknown|retry_attach|retry_projection/);
  await page.locator('[data-lcos-diagnostics-toggle]').first().click();
  await expect(page.locator('[data-lcos-recovery-section]').first()).toBeVisible({ timeout: 10_000 });
});

test('I. Reload：identity/receiver/projection 从 canonical truth 重建', async ({ page }) => {
  await enterProject(page);
  const before = await readGlyths(page);
  expect(before.length).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(page.locator('[data-lcos-project-shell]').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForSelector('.react-flow__viewport', { timeout: 60_000 });
  await expect(page.locator('[data-lcos-glyth-body]').first()).toBeAttached({ timeout: 60_000 });
  const after = await readGlyths(page);
  expect(after.map((glyph) => glyph.label).sort()).toEqual(before.map((glyph) => glyph.label).sort());
});

test('K. Camera invariant：真实双击打开会话窗口不移动 Canvas camera', async ({ page }) => {
  await enterProject(page);
  const glyph = await revealGlyth(page);
  const before = await readCamera(page);
  await glyph.dblclick();
  await expect(page.locator('[data-lcos-conversation-work-view]').first()).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(800);
  expect(await readCamera(page)).toBe(before);
});

// ─────────────────────────── B6 ───────────────────────────

test('J. Multi-Glyth：A→A / B→B，target 不相等，且互不串台', async ({ page }) => {
  await enterProject(page);

  await openWorkViewByTitle(page, seed.label1);
  await page.locator('[data-lcos-open-work-composer]').first().click();
  const composerA = page.locator('[data-lcos-composer]').first();
  await expect(composerA).toBeVisible({ timeout: 10_000 });
  const targetA = (await composerA.getAttribute('data-lcos-composer-target')) ?? '';
  expect(targetA, '会话甲的操作必须落在甲自己的 conversation 上').toContain(seed.conv1);
  await closeAllWindows(page);

  await openWorkViewByTitle(page, seed.label2);
  await page.locator('[data-lcos-open-work-composer]').first().click();
  const composerB = page.locator('[data-lcos-composer]').first();
  await expect(composerB).toBeVisible({ timeout: 10_000 });
  const targetB = (await composerB.getAttribute('data-lcos-composer-target')) ?? '';
  expect(targetB, '会话乙的操作必须落在乙自己的 conversation 上').toContain(seed.conv2);
  expect(targetA, 'A/B target 必须不相等（禁止串台）').not.toBe(targetB);
  await closeAllWindows(page);

  // 回到甲：乙的刷新不得改写甲的锚定
  await openWorkViewByTitle(page, seed.label1);
  await page.locator('[data-lcos-open-work-composer]').first().click();
  const composerA2 = page.locator('[data-lcos-composer]').first();
  await expect(composerA2).toBeVisible({ timeout: 10_000 });
  expect(await composerA2.getAttribute('data-lcos-composer-target'), '乙的刷新不得串到甲的 Composer').toBe(targetA);
});

test('H. Semantic Drop → Glyth：真实原生 drag → target resolve → preview → release → canonical commit', async ({ page }) => {
  await enterProject(page);
  const targetIndex = await glyphIndexByTitle(page, seed.label1);
  // 让被投放的 Glyth 在用户可达的 full LOD 下真实可见（证据要诚实）。
  const targetGlyph = await revealGlyth(page, targetIndex);
  await expect(targetGlyph).toBeVisible({ timeout: 15_000 });
  await page.locator('[data-lcos-assembly-entry]').first().click();
  await page.waitForSelector('[data-lcos-assembly]', { timeout: 25_000 });
  const item = page.locator('[data-lcos-assembly-item]').first();
  await expect(item).toBeVisible({ timeout: 20_000 });
  const iBox = await item.boundingBox();
  const gBox = await targetGlyph.boundingBox();
  expect(iBox).not.toBeNull();
  expect(gBox).not.toBeNull();
  const from = { x: iBox!.x + iBox!.width / 2, y: iBox!.y + iBox!.height / 2 };
  const to = { x: gBox!.x + gBox!.width / 2, y: gBox!.y + gBox!.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 10, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  for (let i = 0; i < 10 && await page.locator('[data-lcos-drop-preview]').count() === 0; i += 1) {
    await page.mouse.move(to.x + (i % 2 === 0 ? 1 : -1), to.y, { steps: 1 });
    await page.waitForTimeout(180);
  }
  const preview = page.locator('[data-lcos-drop-preview]').first();
  await expect(preview, 'dwell 后必须出现 preview（投放意图可见，不是静默消失）').toBeVisible({ timeout: 5_000 });
  expect((await preview.innerText()).trim()).toContain('会话引用');
  await page.mouse.up();
  await page.waitForTimeout(1_500);
  const close = page.locator('[data-lcos-window-icon-button][aria-label="关闭窗口"]');
  if (await close.count() > 0) {
    await close.first().click();
    await page.waitForTimeout(900);
  }
  const composer = page.locator('[data-lcos-composer]').first();
  await expect(composer, 'release 应经 canonical owner 生效（草稿引用 + Composer）').toBeVisible({ timeout: 15_000 });
  const composerTarget = (await composer.getAttribute('data-lcos-composer-target')) ?? '';
  expect(composerTarget).toContain(seed.conv1);
  expect(await page.locator('[data-lcos-composer-ref]').count()).toBeGreaterThanOrEqual(1);
  await targetGlyph.dblclick();
  await expect(page.locator('[data-lcos-conversation-work-view]').first()).toBeVisible({ timeout: 25_000 });
  const workComposer = page.locator('[data-lcos-composer]').first();
  if (await workComposer.count() === 0) {
    const openWorkComposer = page.locator('[data-lcos-open-work-composer]');
    if (await openWorkComposer.count() > 0) await openWorkComposer.first().click();
  }
  await expect(workComposer).toBeVisible({ timeout: 15_000 });
  expect(await workComposer.getAttribute('data-lcos-composer-target')).toBe(composerTarget);
  expect(await page.locator('[data-lcos-composer-ref]').count()).toBeGreaterThanOrEqual(1);
});

test('H2. 外部 file/text/url 失败关闭：无规范捕获/导入 owner 时不产生任何产品真值', async ({ page }) => {
  await enterProject(page);
  const camera = await readCamera(page);
  const regionsBefore = await page.locator('[data-lcos-window-region-id]').count();
  const url = page.url();
  const payloads: Array<{ file?: { name: string; type: string; body: string }; text?: string }> = [
    { file: { name: 'note.txt', type: 'text/plain', body: 'hello' } },
    { text: '外部文本片段' },
    { text: 'https://example.com/a' },
  ];
  for (const payload of payloads) {
    await page.evaluate((input) => {
      const dt = new DataTransfer();
      if (input.file) dt.items.add(new File([input.file.body], input.file.name, { type: input.file.type }));
      if (input.text) dt.setData('text/plain', input.text);
      const target = document.querySelector('.react-flow__pane') ?? document.body;
      for (const eventName of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(eventName, {
          bubbles: true, cancelable: true, dataTransfer: dt, clientX: 640, clientY: 420,
        }));
      }
    }, payload);
    await page.waitForTimeout(400);
  }
  expect(await page.locator('[data-lcos-drop-preview]').count(), '外部 payload 不得伪造 preview').toBe(0);
  expect(await page.locator('[data-lcos-composer]').count(), '外部 payload 不得打开 Composer').toBe(0);
  expect(await page.locator('[data-lcos-composer-ref]').count(), '外部 payload 不得写入草稿引用').toBe(0);
  expect(await page.locator('[data-lcos-window-region-id]').count()).toBe(regionsBefore);
  expect(await readCamera(page)).toBe(camera);
  expect(page.url()).toBe(url);
});