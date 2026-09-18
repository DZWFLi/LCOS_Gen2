// LCOS collaboration browser acceptance — shared harness.
//
// 唯一来源：run 事实由 e2e/lcos-collab-golden.playwright.config.ts 注入（隔离 temp DB /
// workspace / 端口 / token）。任何 spec 都不得自己拼盘符路径或直连开发态 Core。
//
// 纪律：所有用户动作走真实 locator 手势（click / dblclick / mouse / wheel），
// 不对 hidden（semantic zoom 未展开）的节点 body 派发合成事件。

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

export const CORE = process.env.E2E_CORE_URL ?? 'http://127.0.0.1:43121';
export const TOKEN = process.env.E2E_CORE_TOKEN ?? 'dev-token';
export const PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? 'lcos-gen2-dev';
export const TEMP_ROOT = process.env.E2E_TEMP_ROOT;
export const EXPECTED_DB_PATH = process.env.E2E_LOCAL_CORE_DB_PATH;

export interface CoreResult {
  readonly ok: boolean;
  readonly status: number;
  readonly value?: any;
  /** Core 失败时的 error 体（code / message），便于断言与诊断。 */
  readonly error?: { readonly code?: string; readonly message?: string; readonly retryable?: boolean };
}

/** 直接打真实 Core（fixture seeding / canonical 真值读取）；不经过 UI。 */
export async function coreJson(method: string, path: string, body?: unknown): Promise<CoreResult> {
  const res = await fetch(`${CORE}${path}`, {
    method,
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: unknown;
  try { parsed = await res.json() } catch { parsed = undefined }
  const record = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as { value?: unknown; error?: unknown };
  const error = (typeof record.error === 'object' && record.error !== null ? record.error : undefined) as CoreResult['error'];
  return { ok: res.ok, status: res.status, value: record.value, ...(error === undefined ? {} : { error }) };
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
export async function seedReceiverConversations(projectId: string = PROJECT_ID): Promise<ReceiverSeed> {
  const label1 = 'E2E 会话甲';
  const label2 = 'E2E 会话乙';
  const list = await coreJson('GET', `/projects/${projectId}/connected-conversations`);
  const rows = (list.value as Array<{ id: string; conversationRef: string }> | undefined) ?? [];
  let conv1 = rows.find((row) => row.conversationRef === 'e2e-rec-1')?.id;
  let conv2 = rows.find((row) => row.conversationRef === 'e2e-rec-2')?.id;
  if (conv1 === undefined) {
    const made = await coreJson('POST', `/projects/${projectId}/connected-conversations`, {
      action: 'connect', conversationRef: 'e2e-rec-1', executorId: 'executor-e2e', provider: 'codex', label: label1,
    });
    conv1 = (made.value as { id?: string } | undefined)?.id;
  }
  if (conv2 === undefined) {
    const made = await coreJson('POST', `/projects/${projectId}/connected-conversations`, {
      action: 'connect', conversationRef: 'e2e-rec-2', executorId: 'executor-e2e', provider: 'codex', label: label2,
    });
    conv2 = (made.value as { id?: string } | undefined)?.id;
  }
  if (conv1 === undefined || conv2 === undefined) throw new Error(`receiver seed failed: ${JSON.stringify({ conv1, conv2 })}`);
  const bound = await coreJson('POST', `/projects/${projectId}/receiver-binding`, { connectedConversationId: conv1 });
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

/** 按 Core conversation 标题定位 Glyth 下标（身份来自投影，不靠固定顺序；容忍投影重建的瞬时空窗）。 */
export async function glyphIndexByTitle(page: Page, title: string, timeoutMs = 40_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let glyphs = await readGlyths(page);
  while (Date.now() < deadline && !glyphs.some((glyph) => titleOfGlyph(glyph.label).includes(title))) {
    await page.waitForTimeout(400);
    glyphs = await readGlyths(page);
  }
  const index = glyphs.findIndex((glyph) => titleOfGlyph(glyph.label).includes(title));
  expect(index, `未找到标题包含「${title}」的 Glyth：${JSON.stringify(glyphs.map((g) => g.label))}`).toBeGreaterThanOrEqual(0);
  return index;
}

/** 按标题进入该 conversation 的 Work View（真实双击，semantic zoom 展开后）。 */
export async function openWorkViewByTitle(page: Page, title: string): Promise<void> {
  await openWorkView(page, await glyphIndexByTitle(page, title));
}

/**
 * 真实打开 Artifact Reader 窗口：双击 source species 节点（image 不在 semantic-zoom LOD 表里，
 * 因此永远 full、用户可直接点到）。用于不需要 conversation Glyth 的多窗口场景。
 */
export async function openReaderWindow(page: Page): Promise<void> {
  const node = page.locator('.react-flow__node-image').first();
  await expect(node, 'fixture 必须有可见的 image（source）节点作为 reader 入口').toBeVisible({ timeout: 40_000 });
  await node.dblclick();
  await expect(page.locator('[data-lcos-window-region-id]')).not.toHaveCount(0, { timeout: 25_000 });
  await page.waitForTimeout(600);
}
// ─────────────────── Railway dedicated fixture（R3） ───────────────────
//
// 隔离 Core 里用 canonical API 建一个 Railway 专用项目：
//   root scope
//   └─ main root workspace（保证项目能进入 /main）
//   non-root scope N → child workspace N（Railway destination）
//
// 不破坏 Main/Context/Workflow root identity，不把 Railway 做成第二 SurfaceDock，
// 不使用 page-local fake graph —— graph 与 rail order 都真实存在隔离 Core 里。

export interface RailwayFixture {
  readonly projectId: string;
  readonly destIds: readonly string[];
  readonly version: number;
}

const RAIL_DEST_COUNT = 22;

/** 进入任意项目的某个 surface 并等到画布就绪。 */
export async function enterProjectById(page: Page, projectId: string, surface = 'main'): Promise<void> {
  await page.goto(`/projects/${projectId}/${surface}`);
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
  await page.waitForTimeout(1800);
}

export async function readRailOrder(projectId: string): Promise<{ readonly refs: readonly { kind: string; viewId: string }[]; readonly version: number }> {
  const read = await coreJson('GET', `/projects/${projectId}/view-rail-order`);
  return {
    refs: ((read.value?.orderedRefs ?? []) as Array<{ kind: string; viewId: string }>),
    version: Number(read.value?.version ?? 0),
  };
}

export function writeRailOrder(
  projectId: string,
  refs: readonly { kind: string; viewId: string }[],
  expectedVersion: number,
): Promise<CoreResult> {
  return coreJson('PUT', `/projects/${projectId}/view-rail-order`, { orderedRefs: refs, expectedVersion });
}

function railScopeAndWorkspace(projectId: string, index: number, rootScopeId: string, stamp: string) {
  const suffix = `${index}-${stamp}`;
  return {
    scopeId: `scope-rail-${suffix}`,
    workspaceId: `workspace-rail-${suffix}`,
    scopeKind: index % 2 === 0 ? 'context' : 'workflow',
    surface: index % 2 === 0 ? 'context' : 'workflow',
    rootScopeId,
    stamp,
  };
}

/**
 * 在真实 Core 里新增一个 durable destination（non-root scope + child workspace + graph + rail order CAS）。
 * 用于「并发新增目的地不得被 409 回读吞掉」的场景。
 */
export async function addRailDestination(projectId: string, index: number): Promise<string> {
  const now = new Date().toISOString();
  const graph = await coreJson('GET', `/projects/${projectId}/graph`);
  const snapshot = graph.value;
  const rootScope = (snapshot.scopes ?? []).find((scope: { kind?: string }) => scope.kind === 'root');
  const ids = railScopeAndWorkspace(projectId, index, rootScope === undefined ? '' : String(rootScope.id), String(Date.now()));
  const scopes = [
    ...(snapshot.scopes ?? []),
    { id: ids.scopeId, projectId, parentScopeId: ids.rootScopeId, containerViewId: null, kind: ids.scopeKind, name: `Rail 追加 ${index}`, createdAt: now, updatedAt: now },
  ];
  const workspaces = [
    ...(snapshot.workspaces ?? []),
    {
      id: ids.workspaceId, projectId, scopeId: ids.scopeId, name: `Rail 追加 ${index}`,
      intent: 'canvas', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: [],
      contextPolicy: 'workspace-related', preferredSurface: ids.surface, updatedAt: now,
    },
  ];
  const saved = await coreJson('PUT', `/projects/${projectId}/graph`, { snapshot: { ...snapshot, scopes, workspaces } });
  if (!saved.ok) throw new Error(`addRailDestination graph failed: ${saved.status} ${JSON.stringify(saved.value)}`);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { refs, version } = await readRailOrder(projectId);
    const written = await writeRailOrder(projectId, [...refs, { kind: 'scene', viewId: ids.workspaceId }], version);
    if (written.ok) return ids.workspaceId;
    if (written.status !== 409) throw new Error(`addRailDestination order failed: ${written.status}`);
  }
  throw new Error('addRailDestination order conflicted repeatedly');
}

/** 建 Railway 专用 fixture project（幂等：同一 run 内只建一次）。 */
let railwayFixturePromise: Promise<RailwayFixture> | undefined;

export function seedRailwayFixture(): Promise<RailwayFixture> {
  railwayFixturePromise ??= (async (): Promise<RailwayFixture> => {
    const now = new Date().toISOString();
    const parentPath = join(TEMP_ROOT ?? tmpdir(), 'railway-fixture-workspace');
    mkdirSync(parentPath, { recursive: true });
    const created = await coreJson('POST', '/projects', {
      name: 'LCOS Railway E2E', intent: 'create', parentPath, directoryName: 'railway-fixture',
    });
    if (!created.ok) throw new Error(`railway fixture project create failed: ${created.status}`);
    const projectId = String(created.value.id);
    const graph = await coreJson('GET', `/projects/${projectId}/graph`);
    const snapshot = graph.value;
    const rootScopeId = String((snapshot.scopes ?? []).find((scope: { kind?: string }) => scope.kind === 'root')?.id
      ?? `scope-${projectId}-root`);
    const scopes = [...(snapshot.scopes ?? [])];
    const workspaces = [...(snapshot.workspaces ?? [])];
    // 建项目时已 seed 了一个无 preferredSurface 的 Main workspace；投影需要 surface 映射，
    // 因此显式补一个 main root workspace（仍然唯一，不破坏 root identity）。
    if (!workspaces.some((workspace: { preferredSurface?: string }) => workspace.preferredSurface === 'main')) {
      workspaces.push({
        id: `workspace-rail-main-${projectId}`, projectId, scopeId: rootScopeId, name: 'Railway Main',
        intent: 'canvas', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: [],
        contextPolicy: 'workspace-related', preferredSurface: 'main', updatedAt: now,
      });
    }
    // 接收通道（channel 4）只裁定 note/resource/artifactView 进 workspace/scene。
    // fixture 必须给 Assembly 一个可接收的 source（scene/scope source 按冻结规则 unsupported）。
    const notes = [...(snapshot.notes ?? [])];
    for (let index = 0; index < 3; index += 1) {
      notes.push({
        id: `note-rail-${index}`, projectId, anchor: { type: 'project' },
        body: `Railway 接收用备注 ${index}`, createdAt: now, updatedAt: now,
      });
    }
    const destIds: string[] = [];
    for (let index = 0; index < RAIL_DEST_COUNT; index += 1) {
      const ids = railScopeAndWorkspace(projectId, index, rootScopeId, 'fx');
      scopes.push({ id: ids.scopeId, projectId, parentScopeId: rootScopeId, containerViewId: null, kind: ids.scopeKind, name: `Rail 现场 ${index}`, createdAt: now, updatedAt: now });
      workspaces.push({
        id: ids.workspaceId, projectId, scopeId: ids.scopeId, name: `Rail 现场 ${index}`,
        intent: 'canvas', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: [],
        contextPolicy: 'workspace-related', preferredSurface: ids.surface, updatedAt: now,
      });
      destIds.push(ids.workspaceId);
    }
    const saved = await coreJson('PUT', `/projects/${projectId}/graph`, { snapshot: { ...snapshot, scopes, workspaces, notes } });
    if (!saved.ok) throw new Error(`railway fixture graph failed: ${saved.status} ${JSON.stringify(saved.value)}`);
    const order = await writeRailOrder(projectId, destIds.map((viewId) => ({ kind: 'scene', viewId })), 0);
    if (!order.ok) throw new Error(`railway fixture order failed: ${order.status}`);
    return { projectId, destIds, version: Number(order.value.version) };
  })();
  return railwayFixturePromise;
}

export async function enterRailProject(page: Page, fixture: RailwayFixture): Promise<void> {
  await enterProjectById(page, fixture.projectId, 'main');
  await expect(page.locator('[data-lcos-railway]').first()).toBeVisible({ timeout: 30_000 });
}

/** Railway 滚动岛（唯一 overflow 容器：LcosRailwayView 的 data-lcos-family）。 */
export function railwayScroller(page: Page): Locator {
  return page.locator('[data-lcos-family="railway"]').first();
}

export function railwayItemKeys(page: Page): Promise<readonly (string | null)[]> {
  return page.locator('[data-lcos-railway-item]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-lcos-railway-item')));
}
// ─────────────────── Runtime canonical owners（B3/B4 正路径） ───────────────────
//
// 通过现有 canonical 链路（create Run → dispatch → sync）建真实 pending 状态：
//   __E2E_WAITING_INPUT__ → Core 保存 pending input request（projection → needs_user）
//   __E2E_REVIEW__        → Core 落 pending artifact return（projection → pending review）
// provider 结果由 e2e/fake-bridge/server.mjs（DEV-ONLY T7 transport double）给出。

export async function mainWorkspaceId(projectId: string): Promise<string> {
  const list = await coreJson('GET', `/projects/${projectId}/workspaces`);
  const main = ((list.value ?? []) as Array<{ id: string; preferredSurface?: string }>)
    .find((workspace) => workspace.preferredSurface === 'main');
  if (main === undefined) throw new Error('project has no main workspace');
  return String(main.id);
}

export async function runThroughRuntime(
  projectId: string,
  input: {
    readonly instruction: string;
    readonly connectedConversationId: string;
    readonly workspaceId: string;
    readonly outputIntent?: 'create' | 'analyze';
  },
): Promise<string> {
  const created = await coreJson('POST', `/projects/${projectId}/runs`, {
    instruction: input.instruction,
    outputIntent: input.outputIntent ?? 'create',
    workspaceId: input.workspaceId,
    receiverRef: { connectedConversationId: input.connectedConversationId },
  });
  if (!created.ok) throw new Error(`run create failed: ${created.status} ${JSON.stringify(created.error ?? created.value)}`);
  // POST /projects/:pid/runs 返回 RuntimeRunActionResult = { review: RunReview }。
  const runId = String(created.value?.review?.run?.id ?? created.value?.id ?? '');
  if (runId === '' || runId === 'undefined') {
    throw new Error(`run create returned no run id: ${JSON.stringify(created.value)}`);
  }
  const dispatched = await coreJson('POST', `/runs/${encodeURIComponent(runId)}/dispatch`, {});
  if (!dispatched.ok) throw new Error(`run dispatch failed: ${dispatched.status} ${JSON.stringify(dispatched.error ?? dispatched.value)}`);
  const synced = await coreJson('POST', `/runs/${encodeURIComponent(runId)}/sync`, {});
  if (!synced.ok) throw new Error(`run sync failed: ${synced.status} ${JSON.stringify(synced.error ?? synced.value)}`);
  return runId;
}

/** Core pending input request（200 = 仍 pending；404 = 已不 pending）。 */
export function readRunInputRequest(runId: string): Promise<CoreResult> {
  return coreJson('GET', `/runs/${encodeURIComponent(runId)}/input-request`);
}

export interface RunReviewRow {
  readonly run: { readonly id: string; readonly instruction: string; readonly status: string };
  readonly returns: ReadonlyArray<{ readonly id: string; readonly status: string; readonly baseRevisionId: string; readonly targetArtifactId?: string }>;
  readonly inputRequest?: { readonly requestId: string; readonly status: string };
  readonly capabilities?: Record<string, { readonly enabled: boolean; readonly reason?: string }>;
}

export async function readProjectRunReviews(projectId: string): Promise<readonly RunReviewRow[]> {
  const res = await coreJson('GET', `/projects/${projectId}/runs`);
  return (res.value ?? []) as readonly RunReviewRow[];
}
/** 项目 ChangeSet id 列表（Assembly apply 的 canonical 落账证据）。 */
export async function changeSetIds(projectId: string): Promise<readonly string[]> {
  const res = await coreJson('GET', `/projects/${projectId}/change-sets`);
  return ((res.value ?? []) as Array<{ id?: string }>).map((row) => String(row.id ?? '')).filter((id) => id !== '');
}
// ─────────────────── R4 Assembly dedicated fixture ───────────────────
//
// R4 Assembly 的四路 Source Bay 需要真实的 canonical 数据才可信：
//   Project Warehouse ← graph（note）
//   Capture Space     ← /runtime/capture-space/enqueue（desktop 快速捕获同一 canonical 入口）
//   Resources         ← resource-upload-sessions（真实导入，不依赖外网）
//   Skills            ← 仓库内 packages/skills（分层只读）
// 全部在隔离 Core 里用 canonical API 建，不造第二套 Assembly 数据。

export interface AssemblyFixture {
  readonly projectId: string;
  readonly scopeId: string;
  readonly captureId: string;
  /** 第二条 capture：专供 canonical retry 幂等证明（不被 UI 消费）。 */
  readonly captureId2: string;
  readonly resourceId: string;
  readonly noteId: string;
}

/** 真实 Capture：走 desktop 快速捕获同一条 canonical enqueue（system-level staging）。 */
async function seedCapture(operationId: string, title: string): Promise<string> {
  const enqueued = await coreJson('POST', '/runtime/capture-space/enqueue', {
    schemaVersion: 1,
    operationId,
    capturedAt: new Date().toISOString(),
    source: { kind: 'text', pageTitle: title },
    content: { text: `${title} · payload`, mimeType: 'text/plain' },
    target: { mode: 'staging' },
    hints: { title },
  });
  if (!enqueued.ok) throw new Error(`assembly fixture capture failed: ${enqueued.status} ${JSON.stringify(enqueued.value)}`);
  const stagingId = (enqueued.value as { receipt?: { stagingId?: string } } | undefined)?.receipt?.stagingId;
  if (stagingId === undefined) throw new Error(`capture receipt has no stagingId: ${JSON.stringify(enqueued.value)}`);
  return stagingId;
}

/** 真实 Resource：canonical 上传会话（PUT 原始字节 → complete），完全离线。 */
async function seedResource(projectId: string, scopeId: string, fileName: string, body: string): Promise<string> {
  const started = await coreJson('POST', `/projects/${projectId}/resource-upload-sessions`, {
    importRequestId: `import-assembly-${projectId}`,
    rootName: fileName,
    scopeId,
    x: 0,
    y: 0,
  });
  if (!started.ok) throw new Error(`assembly fixture upload session failed: ${started.status}`);
  const sessionId = String((started.value as { sessionId?: string } | undefined)?.sessionId ?? '');
  if (sessionId === '') throw new Error('assembly fixture upload session has no sessionId');
  const uploaded = await coreJson('PUT', `/projects/${projectId}/resource-upload-sessions/${sessionId}/files?path=${encodeURIComponent(fileName)}`, body);
  if (!uploaded.ok) throw new Error(`assembly fixture upload failed: ${uploaded.status}`);
  const done = await coreJson('POST', `/projects/${projectId}/resource-upload-sessions/${sessionId}/complete`);
  if (!done.ok) throw new Error(`assembly fixture complete failed: ${done.status} ${JSON.stringify(done.value)}`);
  const resourceId = String((done.value as { resourceId?: string } | undefined)?.resourceId ?? '');
  if (resourceId === '') throw new Error(`assembly fixture has no resourceId: ${JSON.stringify(done.value)}`);
  return resourceId;
}

let assemblyFixturePromise: Promise<AssemblyFixture> | undefined;

export function seedAssemblyFixture(): Promise<AssemblyFixture> {
  assemblyFixturePromise ??= (async (): Promise<AssemblyFixture> => {
    const now = new Date().toISOString();
    const parentPath = join(TEMP_ROOT ?? tmpdir(), 'assembly-fixture-workspace');
    mkdirSync(parentPath, { recursive: true });
    const created = await coreJson('POST', '/projects', {
      name: 'LCOS Assembly E2E', intent: 'create', parentPath, directoryName: 'assembly-fixture',
    });
    if (!created.ok) throw new Error(`assembly fixture project create failed: ${created.status}`);
    const projectId = String(created.value.id);
    const graph = await coreJson('GET', `/projects/${projectId}/graph`);
    const snapshot = graph.value;
    const rootScopeId = String((snapshot.scopes ?? []).find((scope: { kind?: string }) => scope.kind === 'root')?.id
      ?? `scope-${projectId}-root`);
    const scopes = [...(snapshot.scopes ?? [])];
    const workspaces = [...(snapshot.workspaces ?? [])];

    const addWorkspace = (scopeId: string, surface: 'main' | 'context' | 'workflow', label: string): void => {
      if (workspaces.some((workspace: { preferredSurface?: string }) => workspace.preferredSurface === surface)) return;
      workspaces.push({
        id: `workspace-assembly-${surface}-${projectId}`, projectId, scopeId, name: label,
        intent: 'canvas', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: [],
        contextPolicy: 'workspace-related', preferredSurface: surface, updatedAt: now,
      });
    };
    addWorkspace(rootScopeId, 'main', 'Assembly Main');
    for (const surface of ['context', 'workflow'] as const) {
      const scopeId = `scope-assembly-${surface}-${projectId}`;
      scopes.push({
        id: scopeId, projectId, parentScopeId: rootScopeId, containerViewId: null,
        kind: surface, name: `Assembly ${surface}`, createdAt: now, updatedAt: now,
      });
      addWorkspace(scopeId, surface, `Assembly ${surface}`);
    }

    const noteId = 'note-assembly-1';
    // 60 条 note：让 canonical 分页（nextCursor）在浏览器里真实可达（默认页 50）。
    // updatedAt 略微前置，保证 note 稳定落在第一页（排序 = updatedAt 降序 + id 稳定序）。
    const noteStamp = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const notes = [...(snapshot.notes ?? [])];
    for (let index = 1; index <= 60; index += 1) {
      const id = `note-assembly-${index}`;
      if (notes.some((note: { id?: string }) => note.id === id)) continue;
      notes.push({ id, projectId, anchor: { type: 'project' }, body: `Assembly 投放用备注 ${index}`, createdAt: noteStamp, updatedAt: noteStamp });
    }
    const saved = await coreJson('PUT', `/projects/${projectId}/graph`, { snapshot: { ...snapshot, scopes, workspaces, notes } });
    if (!saved.ok) throw new Error(`assembly fixture graph failed: ${saved.status} ${JSON.stringify(saved.value)}`);

    const [captureId, captureId2, resourceId] = await Promise.all([
      seedCapture(`e2e-assembly-capture-${projectId}`, 'Assembly 暂存文本'),
      seedCapture(`e2e-assembly-capture-retry-${projectId}`, 'Assembly 重试暂存文本'),
      seedResource(projectId, rootScopeId, 'assembly-source.txt', 'Assembly 来源文本（E2E）'),
    ]);
    return { projectId, scopeId: rootScopeId, captureId, captureId2, resourceId, noteId };
  })();
  return assemblyFixturePromise;
}

export async function enterAssemblyProject(page: Page, fixture: AssemblyFixture): Promise<void> {
  await enterProjectById(page, fixture.projectId, 'main');
}

/** 真实入口按钮打开 Assembly（不是 page.evaluate 造窗口）。 */
export async function openAssemblyWindow(page: Page): Promise<void> {
  await page.locator('[data-lcos-assembly-entry]').first().click();
  await expect(page.locator('[data-lcos-assembly]').first()).toBeVisible({ timeout: 30_000 });
}

/** Assembly 所在的 region id（用于证明「同一个 region」）。 */
export async function assemblyRegionId(page: Page): Promise<string> {
  return page.locator('[data-lcos-assembly]').first().evaluate((node) =>
    (node.closest('[data-lcos-window-region-id]') as HTMLElement | null)?.dataset.lcosWindowRegionId ?? '');
}

export function assemblyTargetKind(page: Page): Promise<string | null> {
  return page.locator('[data-lcos-assembly]').first().getAttribute('data-lcos-assembly-target');
}

/** live targetRef 的 id（main 为空串）——用于证明「同一个 Assembly 只换 target」。 */
export function assemblyTargetId(page: Page): Promise<string | null> {
  return page.locator('[data-lcos-assembly]').first().getAttribute('data-lcos-assembly-target-id');
}

/** 切 Source Bay tab（真实 click）并等到该路离开 loading。 */
export async function selectAssemblySourceTab(
  page: Page,
  tab: 'project' | 'capture' | 'sources' | 'skills',
  options: { readonly allowError?: boolean } = {},
): Promise<void> {
  await page.locator(`[data-lcos-assembly-source-tab="${tab}"]`).first().click();
  await expect(page.locator(`[data-lcos-assembly-source-panel="${tab}"]`)).toBeVisible({ timeout: 15_000 });
  if (options.allowError !== true) {
    await expect(page.locator(`[data-lcos-assembly-source-panel="${tab}"] [data-lcos-assembly-error="${tab}"]`)).toHaveCount(0, { timeout: 15_000 });
  }
  await expect(page.locator(`[data-lcos-assembly-source-panel="${tab}"] [data-lcos-assembly-preview]`)).toHaveCount(0);
}
/**
 * 真实用户动作：Huabu 原生「节点内容冲突」浮层（top-center, z-9999）会盖住
 * LCOS 导航岛（同为 top-center, z-40），在解决前岛不可点。
 * LCOS 不接管 Huabu 的通知 owner —— 验收里按用户的方式裁决（保留我的版本），
 * 而不是 force click 绕过（那会点到浮层自身上）。
 *
 * 记录（非 LCOS 所有，只登记）：两个 owner 争用同一个 top-center 锚点。
 */
export async function dismissCanvasConflictToast(page: Page): Promise<void> {
  const keepMine = page.getByRole('button', { name: /Keep mine|保留我/ });
  for (let attempt = 0; attempt < 3 && await keepMine.count() > 0; attempt += 1) {
    await keepMine.first().click();
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(400);
}