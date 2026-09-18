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
  mainWorkspaceId,
  openWorkView,
  openWorkViewByTitle,
  readCamera,
  readGlyths,
  readProjectRunReviews,
  readRunInputRequest,
  revealGlyth,
  runThroughRuntime,
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
  // LCOS 物种真值（species body）数量 —— 外部 payload 不得让它增长。
  // 登记（非本轮修）：Huabu 原生 drop 会自行创建画布节点（实测 +3），那是 Huabu 的能力，
  // 不是 LCOS Drop grammar 的 fake success；是否要把外部输入收口到规范 Capture/Import owner
  // 属于 Capture 网关范围，交用户裁定。
  const speciesBefore = await page.locator('[data-lcos-species-body]').count();
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
  // LCOS 层面仍然失败关闭：外部 payload 没有让任何 LCOS 物种真值增长
  // （Huabu 原生的 drop-to-canvas 节点不属于 LCOS 真值，已登记见上）。
  expect(await page.locator('[data-lcos-species-body]').count(), '外部 payload 不得新增 LCOS 物种真值').toBe(speciesBefore);
  expect(await readCamera(page)).toBe(camera);
  expect(page.url()).toBe(url);
});
// ─────────────── B3/B4 正路径：canonical owner 建真实 pending 状态 ───────────────

test('E2. Waiting Input 正路径：canonical pending input → needs_user → 用户真实回答 → canonical 完成 → projection 更新', async ({ page }) => {
  const workspaceId = await mainWorkspaceId(PROJECT_ID);
  const runId = await runThroughRuntime(PROJECT_ID, {
    instruction: '__E2E_WAITING_INPUT__ 请确认本轮节奏',
    connectedConversationId: seed.conv1,
    workspaceId,
  });
  const pending = await readRunInputRequest(runId);
  expect(pending.ok, 'canonical 链路必须真的建出 pending input request').toBe(true);
  expect(String(pending.value.runId)).toBe(runId);
  expect(pending.value.status).toBe('pending');
  const question = String(pending.value.question);

  await enterProject(page);
  await openWorkViewByTitle(page, seed.label1);
  const waiting = page.locator('[data-lcos-waiting-input]').first();
  await expect(waiting, 'Core pending input 必须投影成 Waiting Input UI').toBeVisible({ timeout: 25_000 });
  expect(await waiting.innerText()).toContain(question);
  await expect(page.locator('[data-lcos-conversation-user-state]').first()).toContainText('等你回应', { timeout: 20_000 });

  // 用户真实回答：点选项 + 填自由文本 + 点「提交回答」
  const option = waiting.locator('[data-lcos-waiting-option]').first();
  if (await option.count() > 0) await option.click();
  await waiting.getByLabel('回答待输入问题').fill('按稳妥节奏走（e2e）');
  await waiting.getByRole('button', { name: '提交回答' }).click();

  // canonical：request 被完成
  await expect.poll(async () => (await readRunInputRequest(runId)).status, { timeout: 30_000 }).toBe(404);
  // projection 更新：不再是 needs_user / 不再有待输入区
  await expect
    .poll(async () => (await page.locator('[data-lcos-conversation-user-state]').first().textContent()) ?? '', { timeout: 30_000 })
    .not.toContain('等你回应');
  expect(await page.locator('[data-lcos-waiting-input]').count()).toBe(0);
});

test('F2. Review 正路径：canonical pending return → 复核面 → 真实 accept → return 状态改变 → UI 更新', async ({ page }) => {
  const workspaceId = await mainWorkspaceId(PROJECT_ID);
  const runId = await runThroughRuntime(PROJECT_ID, {
    instruction: '__E2E_REVIEW__ 产出一份待复核草稿',
    connectedConversationId: seed.conv2,
    workspaceId,
  });
  const seeded = await readProjectRunReviews(PROJECT_ID);
  const seededReview = seeded.find((row) => String(row.run.id) === runId);
  expect(seededReview, 'canonical 链路必须落出该 Run 的 review').toBeTruthy();
  const pendingReturn = (seededReview?.returns ?? []).find((row) => row.status === 'pending_review');
  expect(pendingReturn, 'review 必须有一个 pending_review return').toBeTruthy();
  const returnId = String(pendingReturn!.id);

  await enterProject(page);
  await openWorkViewByTitle(page, seed.label2);
  const section = page.locator('[data-lcos-artifact-return]').first();
  await expect(section, 'Core pending return 必须投影成复核面').toBeVisible({ timeout: 25_000 });
  const row = page.locator(`[data-lcos-review-return="${returnId}"]`);
  await expect(row).toBeVisible({ timeout: 15_000 });
  const accept = row.locator('[data-lcos-return-accept]');
  await expect(accept, 'accept 必须可用（capability.enabled）').toBeEnabled({ timeout: 10_000 });
  await accept.click();

  await expect.poll(async () => {
    const after = await readProjectRunReviews(PROJECT_ID);
    const review = after.find((item) => String(item.run.id) === runId);
    return (review?.returns ?? []).find((item) => String(item.id) === returnId)?.status ?? 'missing';
  }, { timeout: 30_000 }).not.toBe('pending_review');

  await expect(page.locator(`[data-lcos-review-return="${returnId}"]`), '复核面必须随真值更新消失').toHaveCount(0, { timeout: 30_000 });
});
test('G2. Recovery 正路径 = BLOCKED_BY_C2（诚实登记，不冒充 PASS）', async ({ page }) => {
  // 结论与依据（本轮实测）：
  //   recovery.state='recoverable' 的唯一输入是 continuation operation 的 step/status = outcome_unknown。
  //   该状态只能由 agentlet transport 返回「不确定回执」产生。隔离栈里唯一可用的 transport 是
  //   DEV-ONLY 的 DevFakeAgentletTransportV1（LCOS_RECOVERY_TRANSPORT=fake），它只会成功 spawn；
  //   唯一的怀疑注入钩子 failNextSpawnOnce() 是进程内方法，没有 env / HTTP 面，
  //   也没有 canonical Core 路由能直写 continuation step = outcome_unknown。
  //   → canonical owner 无法建出真实可恢复状态；注入面属于 C2 / R5 hard runtime 施工范围。
  const submitted = await coreJson('POST', `/projects/${PROJECT_ID}/conversation-continuations`, {
    operationId: `e2e-recovery-${Date.now()}`,
    mode: 'continue_existing',
    contextInheritance: 'inherit',
    checkout: 'shared',
    provider: 'codex',
    connectedConversationId: seed.conv1,
  });
  expect(submitted.ok, `canonical continuation submit 必须可达：${submitted.status} ${JSON.stringify(submitted.value)}`).toBe(true);
  const listed = await coreJson('GET', `/projects/${PROJECT_ID}/conversation-continuations`);
  const operations = (listed.value ?? []) as Array<{ status?: string; allowedActions?: readonly string[] }>;
  expect(operations.length).toBeGreaterThan(0);
  expect(
    operations.filter((op) => op.status === 'outcome_unknown'),
    '本栈没有 outcome_unknown 注入面 → 不得出现「可恢复」状态（若出现，本 BLOCKED 结论必须重估）',
  ).toHaveLength(0);

  // 诚实负路径仍在：Diagnostics 暴露 recovery 段，但普通首屏不泄漏 raw T6（与 G1 同源）
  await enterProject(page);
  await openWorkViewByTitle(page, seed.label1);
  const firstScreen = (await page.locator('[data-lcos-conversation-work-view]').first().textContent()) ?? '';
  expect(firstScreen).not.toMatch(/external_create|core_bind|outcome_unknown|retry_attach|retry_projection/);
  await page.locator('[data-lcos-diagnostics-toggle]').first().click();
  await expect(page.locator('[data-lcos-recovery-section]').first()).toBeVisible({ timeout: 15_000 });
});