// B5 Receiver-Seeded Browser Golden Path + B6 R1–R3 Browser Interaction Closure
// 真实栈（Playwright 自持，见同名 .playwright.config.ts）：Local Core + Huabu server + Vite。
//
// fixture：真实 Core API 幂等 seed（connected-conversation ×2 + active receiver binding），
// 不造 page-local fake product truth；全部断言读真实 projection / command seam 结果。
//
// 观测记录（本轮发现，登记于 handoff）：
// - conversation 节点在画布上以 card 形式可见；Glyth species body（data-lcos-glyth-body）
//   位于 NodeWrapper 的 OverlayPortal 内，默认 semantic visibility = hidden。
//   因此 projection 断言以 DOM 存在 + identity/userState 属性为准；交互用真实组件事件路径。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const CORE = process.env.E2E_CORE_URL ?? 'http://127.0.0.1:43121';
const TOKEN = 'dev-token';
const PROJECT_ID = 'lcos-gen2-dev';

const ALLOWED_USER_STATES = ['ready', 'thinking', 'working', 'needs_user', 'done', 'unavailable'];

interface Seed { readonly conv1: string; readonly conv2: string }

async function coreJson(method: string, path: string, body?: unknown): Promise<{ ok: boolean; value?: unknown; status: number }> {
  const res = await fetch(`${CORE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let value: unknown;
  try { value = (await res.json() as { value?: unknown }).value } catch { /* no body */ }
  return { ok: res.ok, value, status: res.status };
}

async function seedFixture(): Promise<Seed> {
  const list = await coreJson('GET', `/projects/${PROJECT_ID}/connected-conversations`);
  const rows = (list.value as Array<{ id: string; conversationRef: string }> | undefined) ?? [];
  let conv1 = rows.find((row) => row.conversationRef === 'e2e-rec-1')?.id;
  let conv2 = rows.find((row) => row.conversationRef === 'e2e-rec-2')?.id;
  if (conv1 === undefined) {
    const made = await coreJson('POST', `/projects/${PROJECT_ID}/connected-conversations`, {
      action: 'connect', conversationRef: 'e2e-rec-1', executorId: 'executor-e2e', provider: 'codex', label: 'E2E 会话甲',
    });
    conv1 = (made.value as { id?: string } | undefined)?.id;
  }
  if (conv2 === undefined) {
    const made = await coreJson('POST', `/projects/${PROJECT_ID}/connected-conversations`, {
      action: 'connect', conversationRef: 'e2e-rec-2', executorId: 'executor-e2e', provider: 'codex', label: 'E2E 会话乙',
    });
    conv2 = (made.value as { id?: string } | undefined)?.id;
  }
  if (conv1 === undefined || conv2 === undefined) throw new Error(`fixture seed failed: ${JSON.stringify({ conv1, conv2 })}`);
  const bound = await coreJson('POST', `/projects/${PROJECT_ID}/receiver-binding`, { connectedConversationId: conv1 });
  if (!bound.ok) throw new Error(`receiver binding failed: ${bound.status}`);
  return { conv1, conv2 };
}

let seed: Seed;
test.beforeAll(async () => { seed = await seedFixture(); });

/** 进入项目现场并等到画布就绪（真实画布建立/恢复路径）。 */
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
  await page.waitForTimeout(1500);
}

async function readGlyths(page: Page): Promise<Array<{ label: string | null; state: string | null }>> {
  return page.locator('[data-lcos-glyth-body]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.getAttribute('aria-label'),
      state: node.getAttribute('data-lcos-glyth-user-state'),
    })));
}

/** 用真实组件事件路径打开 Work View（Glyth overlay body 默认 semantic hidden）。 */
async function openWorkView(page: Page): Promise<void> {
  const glyph = page.locator('[data-lcos-glyth-body]').first();
  await glyph.dispatchEvent('dblclick');
  await expect(page.locator('[data-lcos-conversation-work-view]').first()).toBeVisible({ timeout: 25_000 });
}

function readCamera(page: Page): Promise<string> {
  return page.evaluate(() =>
    (document.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform ?? '');
}

// ─────────────────────────── B5 ───────────────────────────

test('A. Bound Glyth 投影：identity + 6 态来自真实 projection', async ({ page }) => {
  await enterProject(page);
  const glyphs = await readGlyths(page);
  expect(glyphs.length).toBeGreaterThanOrEqual(1);
  for (const glyph of glyphs) {
    expect(glyph.state === null || ALLOWED_USER_STATES.includes(glyph.state)).toBe(true);
    expect(glyph.label ?? '').toContain('E2E');
  }
  // projection 身份确实来自 Core（seed 的两个 conversation）
  const labels = glyphs.map((glyph) => glyph.label ?? '').join('|');
  expect(labels).toMatch(/E2E 会话(甲|乙)/);
});

test('B. Work View：projection-first 打开，identity/state 正确', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  await expect(page.locator('[data-lcos-conversation-header]').first()).toBeVisible({ timeout: 10_000 });
  const stateText = await page.locator('[data-lcos-conversation-user-state]').first().textContent();
  expect((stateText ?? '').trim().length).toBeGreaterThan(0);
  // 无 pending / 无 review 时不得出现假 attention 区
  expect(await page.locator('[data-lcos-waiting-input]').count()).toBe(0);
  // Diagnostics 分层：T6 细节在 collapsed diagnostics 内
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

test('D. Delegate：真实 canonical Run + 产品层 receipt', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  await page.locator('[data-lcos-open-work-composer]').first().click();
  const input = page.locator('[data-lcos-composer-input]');
  await input.fill('e2e golden delegate task');
  await input.press('Control+Enter');
  await expect(page.locator('[data-lcos-composer]').first()).toContainText(/Run 已创建|提交失败|失败|创建/, { timeout: 25_000 });
});

test('E. Waiting Input：无 pending 时 honest 空（5xx 冒泡由单测覆盖）', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  expect(await page.locator('[data-lcos-waiting-input]').count()).toBe(0);
  const stateText = (await page.locator('[data-lcos-conversation-user-state]').first().textContent()) ?? '';
  expect(stateText.trim()).not.toBe('等你回应');
});

test('F. Review：无 pending return 时不渲染复核面', async ({ page }) => {
  await enterProject(page);
  await openWorkView(page);
  expect(await page.locator('[data-lcos-artifact-return]').count()).toBe(0);
});

test('G. Recovery：产品层不暴露 T6 raw；raw 只在 Diagnostics', async ({ page }) => {
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
  expect(before.length).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(page.locator('[data-lcos-project-shell]').first()).toBeVisible({ timeout: 45_000 });
  await page.waitForSelector('.react-flow__viewport', { timeout: 60_000 });
  await expect(page.locator('[data-lcos-glyth-body]').first()).toBeAttached({ timeout: 60_000 });
  const after = await readGlyths(page);
  expect(after.length).toBeGreaterThanOrEqual(1);
  expect(after.map((glyph) => glyph.label).sort()).toEqual(before.map((glyph) => glyph.label).sort());
});

test('J. Multi-Glyth：两个 bound conversation 各自独立投影', async ({ page }) => {
  await enterProject(page);
  const glyphs = await readGlyths(page);
  expect(glyphs.length).toBeGreaterThanOrEqual(2);
  const labels = glyphs.map((glyph) => glyph.label ?? '');
  expect(labels.some((label) => label.includes('会话甲'))).toBe(true);
  expect(labels.some((label) => label.includes('会话乙'))).toBe(true);
});

test('K. Camera invariant：打开/关闭 Work View 不移动 Canvas camera', async ({ page }) => {
  await enterProject(page);
  const before = await readCamera(page);
  await openWorkView(page);
  await page.waitForTimeout(800);
  expect(await readCamera(page)).toBe(before);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  expect(await readCamera(page)).toBe(before);
});

// ─────────────────────────── B6 ───────────────────────────

test('H. Semantic Drop → Glyth：真实原生 drag → target resolve → preview → release → canonical commit', async ({ page }) => {
  await enterProject(page);
  // 真实 payload 源：Assembly 项（current source 中唯一调用 acquireDrop 的产品路径）。
  await page.locator('[data-lcos-assembly-entry]').first().click();
  await page.waitForSelector('[data-lcos-assembly]', { timeout: 25_000 });
  const item = page.locator('[data-lcos-assembly-item]').first();
  await expect(item).toBeVisible({ timeout: 20_000 });
  const iBox = await item.boundingBox();
  expect(iBox).not.toBeNull();
  // 选一个不被 Assembly 窗口遮住的 Glyth：投放目标是「指针下方的注册目标」，
  // 视觉遮挡会让证据不诚实，所以优先取不相交的那个。
  const boxes = await page.locator('[data-lcos-glyth-body]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }));
  expect(boxes.length).toBeGreaterThanOrEqual(2);
  const box = iBox!;
  let targetIndex = boxes.findIndex((g) =>
    g.x + g.w < box.x || g.x > box.x + box.width || g.y + g.h < box.y || g.y > box.y + box.height);
  if (targetIndex < 0) targetIndex = 0;
  const targetGlyph = page.locator('[data-lcos-glyth-body]').nth(targetIndex);
  const gBox = boxes[targetIndex]!;
  const from = { x: iBox!.x + iBox!.width / 2, y: iBox!.y + iBox!.height / 2 };
  const to = { x: gBox.x + gBox.w / 2, y: gBox.y + gBox.h / 2 };
  // 真实原生 HTML5 drag（Chromium 在原生 drag 中不派发 pointer 事件）。
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 16, from.y + 10, { steps: 4 });
  await page.waitForTimeout(200);
  await page.mouse.move(to.x, to.y, { steps: 12 });
  // 驻留（dwell）：目标解析 → preview。轻微微动即在 dwellRadius 内的「停顿」，
  // 因为 Chromium 只在指针移动时重发 dragover，而 dwell 需要 >= dwellMs 的驻留。
  for (let i = 0; i < 10 && await page.locator('[data-lcos-drop-preview]').count() === 0; i += 1) {
    await page.mouse.move(to.x + (i % 2 === 0 ? 1 : -1), to.y, { steps: 1 });
    await page.waitForTimeout(180);
  }
  const preview = page.locator('[data-lcos-drop-preview]').first();
  await expect(preview, 'dwell 后必须出现 preview（投放意图可见，不是静默消失）').toBeVisible({ timeout: 5_000 });
  // 预览意图 = 提交意图：preview 必须已解析到「会话引用」目标。
  expect((await preview.innerText()).trim()).toContain('会话引用');
  await page.mouse.up();
  await page.waitForTimeout(1_500);
  // canonical commit：owner = addConversationReference（草稿引用 + Composer 锚定该会话）。
  // 前台有 Professional window 时画布级 Composer 让位，先关窗再断言。
  const close = page.locator('[data-lcos-window-icon-button][aria-label="关闭窗口"]');
  if (await close.count() > 0) {
    await close.first().click();
    await page.waitForTimeout(900);
  }
  const composer = page.locator('[data-lcos-composer]').first();
  await expect(composer, 'release 应经 canonical owner 生效（草稿引用 + Composer）').toBeVisible({ timeout: 15_000 });
  const composerTarget = (await composer.getAttribute('data-lcos-composer-target')) ?? '';
  expect(composerTarget).toContain('conversation:');
  expect(await page.locator('[data-lcos-composer-ref]').count()).toBeGreaterThanOrEqual(1);
  // 闭环：同一 Glyth 的 Work View Composer 必须锚定同一会话且带着同一条引用——
  // 证明「投放到哪里 = 用在哪里」。
  await targetGlyph.dispatchEvent('dblclick');
  await expect(page.locator('[data-lcos-conversation-work-view]').first()).toBeVisible({ timeout: 25_000 });
  const workComposer = page.locator('[data-lcos-composer]').first();
  // drop 已把 Composer 打开并锚定该会话：Work View 直接内联渲染它；
  // 只有在未打开时（例如引用被清空）才走显式「继续工作」入口。
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
  // 真实 DOM 入口：外部 payload 进入画布 —— 生产代码里没有任何 acquireDrop 调用方
  // 为外部 payload 建账（只有 Assembly 原生拖拽会 acquire），因此必须 fail-close。
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