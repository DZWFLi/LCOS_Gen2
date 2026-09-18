// LCOS collaboration browser acceptance — shared harness.
//
// 唯一来源：run 事实由 e2e/lcos-collab-golden.playwright.config.ts 注入（隔离 temp DB /
// workspace / 端口 / token）。任何 spec 都不得自己拼盘符路径或直连开发态 Core。
//
// 纪律：所有用户动作走真实 locator 手势（click / dblclick / mouse / wheel），
// 不对 hidden（semantic zoom 未展开）的节点 body 派发合成事件。

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const CORE = process.env.E2E_CORE_URL ?? 'http://127.0.0.1:43121';
export const TOKEN = process.env.E2E_CORE_TOKEN ?? 'dev-token';
export const PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? 'lcos-gen2-dev';
export const TEMP_ROOT = process.env.E2E_TEMP_ROOT;
export const EXPECTED_DB_PATH = process.env.E2E_LOCAL_CORE_DB_PATH;

export interface CoreResult { readonly ok: boolean; readonly status: number; readonly value?: any }

/** 直接打真实 Core（fixture seeding / canonical 真值读取）；不经过 UI。 */
export async function coreJson(method: string, path: string, body?: unknown): Promise<CoreResult> {
  const res = await fetch(`${CORE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let value: unknown;
  try { value = ((await res.json()) as { value?: unknown }).value } catch { /* no body */ }
  return { ok: res.ok, status: res.status, value };
}

/** 隔离护栏：本次 run 的 Core 必须跑在 run 专属 temp DB 上（不触碰开发 .data/phase2.sqlite）。 */
export async function assertHermeticCore(): Promise<void> {
  const status = await coreJson('GET', '/metadata/status');
  expect(status.ok, 'Core /metadata/status 必须可达').toBe(true);
  const databasePath = String((status.value as { databasePath?: unknown } | undefined)?.databasePath ?? '');
  expect(databasePath.length).toBeGreaterThan(0);
  const normalized = databasePath.replace(/\\/g, '/').toLowerCase();
  if (EXPECTED_DB_PATH !== undefined) {
    expect(normalized).toBe(EXPECTED_DB_PATH.replace(/\\/g, '/').toLowerCase());
  }
  expect(normalized).not.toContain('/.data/phase2.sqlite');
  if (TEMP_ROOT !== undefined) {
    expect(normalized).toContain(TEMP_ROOT.replace(/\\/g, '/').toLowerCase());
  }
}

/** 进入项目现场并等到画布就绪（真实画布建立/恢复路径）。 */
export async function enterProject(page: Page): Promise<void> {
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
  await page.waitForTimeout(1800);
}

export interface GlyphReading { readonly label: string | null; readonly state: string | null; readonly visible: boolean }

export async function readGlyths(page: Page): Promise<readonly GlyphReading[]> {
  return page.locator('[data-lcos-glyth-body]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      label: node.getAttribute('aria-label'),
      state: node.getAttribute('data-lcos-glyth-user-state'),
      visible: getComputedStyle(node as HTMLElement).visibility === 'visible',
    })));
}

export function readCamera(page: Page): Promise<string> {
  return page.evaluate(() =>
    (document.querySelector('.react-flow__viewport') as HTMLElement | null)?.style.transform ?? '');
}

/** Glyth 所在的真实 react-flow 节点（semantic zoom 的 LOD 宿主）。 */
async function glyphNodeBox(glyph: Locator): Promise<{ cx: number; cy: number; w: number } | null> {
  return glyph.evaluate((el) => {
    const node = el.closest('.react-flow__node') as HTMLElement | null;
    if (node === null) return null;
    const r = node.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width };
  });
}

/**
 * 让 Glyth body 真正可见。
 *
 * 冻结的 semantic zoom 规则：note 类节点屏幕宽度 < 140px 时渲染 minimal 占位，
 * species body 因此 visibility:hidden / pointer-events:none。用户要读到它必须放大
 * （Ctrl+滚轮，真实手势）。这里就是用真实手势把节点推到 full LOD——
 * 不派发合成事件、不改 store、不绕过 hit testing。
 */
export async function revealGlyth(page: Page, index = 0): Promise<Locator> {
  const glyph = page.locator('[data-lcos-glyth-body]').nth(index);
  await expect(glyph).toBeAttached({ timeout: 60_000 });
  if (await glyph.isVisible().catch(() => false)) return glyph;
  const first = await glyphNodeBox(glyph);
  if (first === null) return glyph;
  await page.keyboard.down('Control');
  try {
    for (let i = 0; i < 14; i += 1) {
      const box = await glyphNodeBox(glyph);
      if (box === null) break;
      await page.mouse.move(box.cx, box.cy);
      await page.mouse.wheel(0, -200);
      await page.waitForTimeout(200);
      if (await glyph.isVisible().catch(() => false)) break;
      if (box.w >= 200) break;
    }
  } finally {
    await page.keyboard.up('Control');
  }
  await page.waitForTimeout(300);
  return glyph;
}

/** 真实双击 Glyth 打开会话窗口，并等到 Work View 就绪。 */
export async function openWorkView(page: Page, index = 0): Promise<void> {
  const glyph = await revealGlyth(page, index);
  await expect(glyph, 'Glyth body 必须在用户可达的 full LOD 下可见（semantic zoom 展开后）').toBeVisible({ timeout: 15_000 });
  await glyph.dblclick();
  await expect(page.locator('[data-lcos-conversation-work-view]').first()).toBeVisible({ timeout: 25_000 });
}

export interface ReceiverSeed { readonly conv1: string; readonly conv2: string; readonly label1: string; readonly label2: string }

/** 真实 Core seed：两条 connected conversation + receiver binding（幂等）。 */
export async function seedReceiverConversations(): Promise<ReceiverSeed> {
  const label1 = 'E2E 会话甲';
  const label2 = 'E2E 会话乙';
  const list = await coreJson('GET', `/projects/${PROJECT_ID}/connected-conversations`);
  const rows = (list.value as Array<{ id: string; conversationRef: string }> | undefined) ?? [];
  let conv1 = rows.find((row) => row.conversationRef === 'e2e-rec-1')?.id;
  let conv2 = rows.find((row) => row.conversationRef === 'e2e-rec-2')?.id;
  if (conv1 === undefined) {
    const made = await coreJson('POST', `/projects/${PROJECT_ID}/connected-conversations`, {
      action: 'connect', conversationRef: 'e2e-rec-1', executorId: 'executor-e2e', provider: 'codex', label: label1,
    });
    conv1 = (made.value as { id?: string } | undefined)?.id;
  }
  if (conv2 === undefined) {
    const made = await coreJson('POST', `/projects/${PROJECT_ID}/connected-conversations`, {
      action: 'connect', conversationRef: 'e2e-rec-2', executorId: 'executor-e2e', provider: 'codex', label: label2,
    });
    conv2 = (made.value as { id?: string } | undefined)?.id;
  }
  if (conv1 === undefined || conv2 === undefined) throw new Error(`receiver seed failed: ${JSON.stringify({ conv1, conv2 })}`);
  const bound = await coreJson('POST', `/projects/${PROJECT_ID}/receiver-binding`, { connectedConversationId: conv1 });
  if (!bound.ok) throw new Error(`receiver binding failed: ${bound.status}`);
  return { conv1, conv2, label1, label2 };
}

/** 该项目所有 conversation 标题（connected + 导入会话），用于校验 Glyth 身份来自 Core。 */
export async function coreConversationTitles(): Promise<readonly string[]> {
  const [connected, imported] = await Promise.all([
    coreJson('GET', `/projects/${PROJECT_ID}/connected-conversations`),
    coreJson('GET', `/projects/${PROJECT_ID}/conversations`),
  ]);
  const titles = new Set<string>();
  for (const row of (connected.value ?? []) as Array<{ label?: string }>) {
    if (typeof row.label === 'string' && row.label.trim() !== '') titles.add(row.label.trim());
  }
  for (const row of (imported.value ?? []) as Array<{ title?: string; label?: string }>) {
    const title = row.title ?? row.label;
    if (typeof title === 'string' && title.trim() !== '') titles.add(title.trim());
  }
  return [...titles];
}

/** 从 aria-label 取标题（`<title> · <pose> · 双击打开会话窗口`）。 */
export function titleOfGlyph(label: string | null): string {
  return (label ?? '').split(' · ')[0]?.trim() ?? '';
}
/** 真实关闭所有 Professional 窗口（Esc 会先被 inline Composer 消费，故用关闭按钮）。 */
export async function closeAllWindows(page: Page): Promise<void> {
  const close = page.locator('[data-lcos-window-icon-button][aria-label="关闭窗口"]');
  for (let i = 0; i < 6 && await close.count() > 0; i += 1) {
    await close.first().click();
    await page.waitForTimeout(400);
  }
  await expect(page.locator('[data-lcos-window-region-id]')).toHaveCount(0, { timeout: 10_000 });
}

/** 按 Core conversation 标题定位 Glyth 下标（身份来自投影，不靠固定顺序）。 */
export async function glyphIndexByTitle(page: Page, title: string): Promise<number> {
  const glyphs = await readGlyths(page);
  const index = glyphs.findIndex((glyph) => titleOfGlyph(glyph.label).includes(title));
  expect(index, `未找到标题包含「${title}」的 Glyth：${JSON.stringify(glyphs.map((g) => g.label))}`).toBeGreaterThanOrEqual(0);
  return index;
}

/** 按标题进入该 conversation 的 Work View（真实双击，semantic zoom 展开后）。 */
export async function openWorkViewByTitle(page: Page, title: string): Promise<void> {
  await openWorkView(page, await glyphIndexByTitle(page, title));
}