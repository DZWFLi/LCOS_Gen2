// R4 = Reader / Assembly direct manipulation（Track C1）浏览器验收。
// 复用既有 hermetic 栈与 harness，不新建 E2E 架构。

import { expect, test } from '@playwright/test';

import {
  assemblyRegionId,
  assemblyTargetId,
  assemblyTargetKind,
  coreJson,
  enterAssemblyProject,
  enterProject,
  openAssemblyWindow,
  openReaderWindow,
  openWorkViewByTitle,
  PROJECT_ID,
  readCamera,
  seedAssemblyFixture,
  seedReceiverConversations,
  selectAssemblySourceTab,
} from './lcos-collab-harness';

test.describe.configure({ mode: 'serial' });

/** Core 真值：材料 → revision 数（决定 revision 浏览/对比是否有可操作对象）。 */
async function revisionCounts(): Promise<ReadonlyMap<string, number>> {
  const graph = await coreJson('GET', `/projects/${PROJECT_ID}/graph`);
  const counts = new Map<string, number>();
  for (const revision of (graph.value?.artifactRevisions ?? []) as Array<{ artifactId: string }>) {
    const id = String(revision.artifactId);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Core 真值：项目内 canonical artifact 身份集合（用于证明 retry 不重复物化）。 */
async function artifactIds(projectId: string): Promise<readonly string[]> {
  const graph = await coreJson('GET', `/projects/${projectId}/graph`);
  const ids = new Set<string>();
  for (const artifact of (graph.value?.artifacts ?? []) as Array<{ id?: string }>) {
    if (typeof artifact.id === 'string') ids.add(artifact.id);
  }
  for (const revision of (graph.value?.artifactRevisions ?? []) as Array<{ artifactId?: string }>) {
    if (typeof revision.artifactId === 'string') ids.add(revision.artifactId);
  }
  return [...ids];
}

test('R4-1. Reader 主链：真实打开材料 → current revision 正文 → 加入引用 / 回到来源 / compare 如实态', async ({ page }) => {
  await enterProject(page);
  const cameraBefore = await readCamera(page);

  // 真实用户路径：双击 source 节点 → Reader Professional Window
  await openReaderWindow(page);
  const reader = page.locator('[data-lcos-reader]').first();
  await expect(reader, 'Reader 必须由真实入口打开').toBeVisible({ timeout: 30_000 });
  // 打开 Reader 本身不得移动 Canvas camera（locate 动作除外，见下）
  expect(await readCamera(page)).toBe(cameraBefore);

  // 标题 + revision 徽标（真实 artifact/revision 身份，不是占位文案）
  const title = (await reader.locator('h3').first().textContent()) ?? '';
  expect(title.trim().length).toBeGreaterThan(0);
  const headerText = (await reader.textContent()) ?? '';
  expect(headerText).toMatch(/revision \d|revision ·|无 revision/);

  // 正文：真实读取通道（image 走字节通道 → <img>；文本走文本通道）
  const contentKind = await reader.locator('[data-lcos-reader-content]').first().getAttribute('data-lcos-reader-content');
  expect(['text', 'image', 'unavailable']).toContain(contentKind);
  if (contentKind === 'image') {
    await expect(reader.locator('[data-lcos-reader-content="image"] img').first()).toBeVisible({ timeout: 20_000 });
  }

  // 加入引用：走既有草稿 owner（Composer / Assembly 共用同一引用），读数从 0 → 1
  await expect(reader.locator('[data-lcos-reader-draft-count]')).toHaveText(/草稿引用 0/);
  await reader.locator('[data-lcos-reader-to-draft]').click();
  await expect(reader.locator('[data-lcos-reader-draft-count]')).toHaveText(/草稿引用 1/);

  // 回到来源：按 Core identity 定位；未投影时如实说明（不假定位）
  await reader.locator('[data-lcos-reader-source-return]').click();
  const note = (await reader.locator('[data-lcos-reader-note]').first().textContent()) ?? '';
  expect(note).toMatch(/回到来源|尚未投影/);

  // revision 浏览 / 对比：由 Core 真值决定是否可操作，并如实反映
  const counts = await revisionCounts();
  const maxRevisions = Math.max(0, ...counts.values());
  const compareToggle = reader.locator('[data-lcos-reader-compare-toggle]');
  if (maxRevisions >= 2) {
    await expect(reader.locator('[data-lcos-reader-revisions]')).toBeVisible({ timeout: 10_000 });
    await expect(compareToggle).toBeEnabled();
    await compareToggle.click();
    await expect(reader.locator('[data-lcos-reader-compare], [data-lcos-reader-compare-error]')).toBeVisible({ timeout: 20_000 });
  } else {
    // fixture 只有单版本材料 → 按钮必须 disabled 且说明原因（不得假装可对比）
    await expect(compareToggle).toBeDisabled();
    await expect(compareToggle).toHaveAttribute('title', /只有一个版本/);
  }
});
// ─────────────────────────── R4 Assembly（C1-3 residual） ───────────────────────────
//
// §7 target continuity：一个 Project 只有一个共享 Assembly professional region；
// Main → Context → Workflow → Conversation 只更新 live targetRef，绝不新开第二窗口。
// §2/§4/§5：四路 Source Bay 可浏览 / 预览 / 分页 / 投放；逐项回执如实分层；retry 不重复。

test('R4-2. 一个 Project 只有一个共享 Assembly：Surface / Conversation 切换只换 targetRef', async ({ page }) => {
  const fixture = await seedAssemblyFixture();
  const seed = await seedReceiverConversations(fixture.projectId);
  await enterAssemblyProject(page, fixture);

  await openAssemblyWindow(page);
  const regionId = await assemblyRegionId(page);
  expect(regionId.length, 'Assembly 必须落在真实 region 里').toBeGreaterThan(0);
  await expect(page.locator('[data-lcos-assembly]'), '一个 Project 只能有一个 Assembly').toHaveCount(1);
  expect(await assemblyTargetKind(page)).toBe('main');
  expect(await assemblyTargetId(page)).toBe('');

  // Context 现场：同一入口再点一次 → region 不变，只换 live targetRef
  await page.locator('[data-lcos-surface="context"]').first().click();
  await page.waitForTimeout(1500);
  await openAssemblyWindow(page);
  await expect(page.locator('[data-lcos-assembly]'), 'Surface 切换不得创建第二个 Assembly').toHaveCount(1);
  expect(await assemblyRegionId(page), '必须是同一个 Assembly region').toBe(regionId);
  expect(await assemblyTargetKind(page)).toBe('workspace');
  expect(await assemblyTargetId(page)).toBe(`workspace-assembly-context-${fixture.projectId}`);

  // Workflow 现场
  await page.locator('[data-lcos-surface="workflow"]').first().click();
  await page.waitForTimeout(1500);
  await openAssemblyWindow(page);
  await expect(page.locator('[data-lcos-assembly]')).toHaveCount(1);
  expect(await assemblyRegionId(page)).toBe(regionId);
  expect(await assemblyTargetId(page)).toBe(`workspace-assembly-workflow-${fixture.projectId}`);

  // Conversation Work View → open/focus Assembly：仍是同一个 Assembly，targetRef = conversation
  await page.locator('[data-lcos-surface="main"]').first().click();
  await page.waitForTimeout(1500);
  await openWorkViewByTitle(page, seed.label1);
  await page.locator('[data-lcos-conversation-open-assembly]').first().click();
  await expect(page.locator('[data-lcos-assembly]'), 'Conversation 不得创建 ConversationAssembly').toHaveCount(1);
  expect(await assemblyRegionId(page)).toBe(regionId);
  expect(await assemblyTargetKind(page)).toBe('conversation');
  expect(await assemblyTargetId(page)).toBe(seed.conv1);
});

test('R4-3. Source Bay 四路可浏览 / 预览 / 分页 / 投放；retry 不重复；不支持项如实', async ({ page }) => {
  test.slow(); // 四路 + 分页 + 多次真实 apply：默认 120s 不够
  const fixture = await seedAssemblyFixture();
  await enterAssemblyProject(page, fixture);
  await openAssemblyWindow(page);

  // ---- Project Warehouse：真实 note source + canonical 分页 ----
  await expect(page.locator('[data-lcos-assembly-source-panel="project"]')).toBeVisible({ timeout: 20_000 });
  const noteItem = page.locator(`[data-lcos-assembly-item="${fixture.noteId}"]`);
  await expect(noteItem, 'fixture 必须提供真实 note source').toBeVisible({ timeout: 25_000 });

  await expect(page.locator('[data-lcos-assembly-item]'), 'canonical 第一页 = 50').toHaveCount(50, { timeout: 20_000 });
  const pageMore = page.locator('[data-lcos-assembly-page-more]');
  await expect(pageMore, '超过一页时必须给出 canonical nextCursor 入口').toBeVisible({ timeout: 15_000 });
  await pageMore.click();
  await expect.poll(async () => page.locator('[data-lcos-assembly-item]').count(), { timeout: 20_000 }).toBeGreaterThan(50);
  const ids = await page.locator('[data-lcos-assembly-item]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-lcos-assembly-item')));
  expect(new Set(ids).size, '分页追加不得出现重复卡').toBe(ids.length);

  // 投放 note → Main：第一次 applied（取用行是 hover 驱动的，先真实 hover）
  await noteItem.hover();
  await noteItem.locator('[data-lcos-assembly-more]').click();
  await noteItem.locator('[data-lcos-assembly-drop]').click();
  const receipt = page.locator('[data-lcos-assembly-receipt]').first();
  await expect(receipt).toBeVisible({ timeout: 25_000 });
  await expect(receipt.locator('[data-lcos-assembly-outcome-line="applied"]')).toHaveCount(1, { timeout: 25_000 });

  // retry：already-member（幂等，不重复创建 membership）；且**不得**报成「全部成功」
  await noteItem.hover();
  await noteItem.locator('[data-lcos-assembly-drop]').click();
  await expect(receipt.locator('[data-lcos-assembly-outcome-line="already-member"]')).toHaveCount(1, { timeout: 25_000 });
  await expect(receipt).toHaveAttribute('data-lcos-assembly-outcome', 'already-present');
  await expect(receipt).toContainText('没有新增变更');

  // ---- Capture Space（system-level staging）----
  await selectAssemblySourceTab(page, 'capture');
  const captureItem = page.locator(`[data-lcos-assembly-capture-item="${fixture.captureId}"]`);
  await expect(captureItem, 'fixture 必须提供真实 capture staging item').toBeVisible({ timeout: 25_000 });
  await captureItem.locator(`[data-lcos-assembly-preview-open="capture:${fixture.captureId}"]`).click();
  const preview = page.locator('[data-lcos-assembly-preview]').first();
  await expect(preview).toHaveAttribute('data-lcos-assembly-preview', 'ready', { timeout: 25_000 });
  await expect(preview).toContainText('payload');
  await page.locator('[data-lcos-assembly-preview-close]').click();

  // 投放 capture → Main：materialize（首次 applied），并如实从 pending 暂存区解析掉
  const artifactsBefore = await artifactIds(fixture.projectId);
  await captureItem.locator('[data-lcos-assembly-drop]').click();
  await expect(receipt.locator('[data-lcos-assembly-outcome-line="applied"]')).toHaveCount(1, { timeout: 30_000 });
  await expect(
    page.locator(`[data-lcos-assembly-capture-item="${fixture.captureId}"]`),
    '已物化的 capture 必须如实离开 pending 暂存区（canonical resolution，不是 UI 隐藏）',
  ).toHaveCount(0, { timeout: 30_000 });
  const artifactsAfter = await artifactIds(fixture.projectId);
  expect(artifactsAfter.length, 'materialize 只能产生一个新 artifact').toBe(artifactsBefore.length + 1);

  // ---- Resources / Sources ----
  await selectAssemblySourceTab(page, 'sources');
  const resourceItem = page.locator(`[data-lcos-assembly-resource-item="${fixture.resourceId}"]`);
  await expect(resourceItem, 'fixture 必须提供真实导入来源').toBeVisible({ timeout: 25_000 });
  await resourceItem.locator(`[data-lcos-assembly-preview-open="resource:${fixture.resourceId}"]`).click();
  await expect(preview).toHaveAttribute('data-lcos-assembly-preview', 'ready', { timeout: 25_000 });
  await expect(preview).toContainText('理解状态');
  await page.locator('[data-lcos-assembly-preview-close]').click();
  await resourceItem.locator('[data-lcos-assembly-drop]').click();
  await expect(receipt.locator('[data-lcos-assembly-outcome-line="applied"]')).toHaveCount(1, { timeout: 30_000 });

  // ---- §5 retry 幂等（canonical 证明；Assembly 不建第二套 retry ledger）----
  // 同 sourceRef + 同 targetRef 连投两次：第二次必须 already-member，复用同一个 canonical view，不新增 artifact。
  const retryBody = {
    schemaVersion: 1,
    projectId: fixture.projectId,
    sourceRefs: [{ kind: 'capture', id: fixture.captureId2 }],
    targetRef: { kind: 'main' },
  };
  const retryBefore = await artifactIds(fixture.projectId);
  const firstRetry = await coreJson('POST', `/projects/${fixture.projectId}/assembly/apply`, retryBody);
  expect(firstRetry.ok).toBe(true);
  expect(firstRetry.value.results[0].status).toBe('applied');
  const retryAfterFirst = await artifactIds(fixture.projectId);
  expect(retryAfterFirst.length, '第一次投放只应新增一个 artifact').toBe(retryBefore.length + 1);

  const secondRetry = await coreJson('POST', `/projects/${fixture.projectId}/assembly/apply`, retryBody);
  expect(secondRetry.ok).toBe(true);
  expect(secondRetry.value.results[0].channel, 'retry 必须命中 already-member（不重复创建）').toBe('already-member');
  expect(secondRetry.value.results[0].memberViewId, 'retry 必须复用同一个 canonical view').toBe(firstRetry.value.results[0].memberViewId);
  expect((await artifactIds(fixture.projectId)).length, 'retry 不得重复物化出第二个 artifact').toBe(retryAfterFirst.length);

  // ---- Skills：分层只读；能读到就列出、读不到就如实报错（绝不 fake bind）----
  // 本 checkout 未包含 canonical skill 层（repo 根无 tools/lcos-agent、无 packages/skills），
  // 因此两种结局都必须被如实呈现，且 Skills 路的失败绝不能打死另外三路（§3 路径隔离）。
  await selectAssemblySourceTab(page, 'skills', { allowError: true });
  await expect(page.locator('[data-lcos-assembly-skill-admission="read-only"]')).toBeVisible();
  await expect.poll(async () => {
    const errored = await page.locator('[data-lcos-assembly-source-panel="skills"] [data-lcos-assembly-error="skills"]').count();
    const items = await page.locator('[data-lcos-assembly-skill-item]').count();
    return errored > 0 || items > 0;
  }, { timeout: 25_000, message: 'Skills 路必须收束到「列出」或「如实报错」' }).toBe(true);
  const skillsErrored = await page.locator('[data-lcos-assembly-source-panel="skills"] [data-lcos-assembly-error="skills"]').count() > 0;
  if (!skillsErrored) {
    const skillItems = page.locator('[data-lcos-assembly-skill-item]');
    await expect(skillItems.first(), '有 skill 层时必须列出真实分层技能').toBeVisible({ timeout: 25_000 });
    expect(await skillItems.count()).toBeGreaterThan(0);
    await skillItems.first().locator('[data-lcos-assembly-preview-open]').click();
    await expect(preview).toHaveAttribute('data-lcos-assembly-preview', 'ready', { timeout: 25_000 });
    await expect(page.locator('[data-lcos-assembly-skill-apply="unavailable"]').first()).toBeVisible();
  } else {
    await expect(page.locator('[data-lcos-assembly-source-panel="skills"] [data-lcos-assembly-error="skills"]'), 'skill 层缺失必须如实报错并给重试')
      .toContainText('技能读取失败');
  }
  // 无论哪种结局：skill 一律不提供投放（v0.15 只读，不复制 package、不 fake bind）
  await expect(page.locator('[data-lcos-assembly-source-panel="skills"] [data-lcos-assembly-drop]')).toHaveCount(0);

  // §3 路径隔离：Skills 路的错误不得影响其它三路（canonical 数据仍在）
  await selectAssemblySourceTab(page, 'capture');
  await expect(page.locator('[data-lcos-assembly-capture-item]').first(), 'Skills 失败不得打死 Capture 路').toBeVisible({ timeout: 25_000 });
  await selectAssemblySourceTab(page, 'sources');
  await expect(page.locator(`[data-lcos-assembly-resource-item="${fixture.resourceId}"]`), 'Skills 失败不得打死 Sources 路').toBeVisible({ timeout: 25_000 });

  // ---- §3：同 Project Surface 切换后 source data 保留、仍是同一个 Assembly ----
  const regionId = await assemblyRegionId(page);
  await page.locator('[data-lcos-surface="context"]').first().click();
  await page.waitForTimeout(1500);
  await openAssemblyWindow(page);
  expect(await assemblyRegionId(page), 'Surface 切换后仍是同一个 Assembly region').toBe(regionId);
  await selectAssemblySourceTab(page, 'project');
  await expect(page.locator(`[data-lcos-assembly-item="${fixture.noteId}"]`), '切换 Surface 不得清空已加载的 source data').toBeVisible({ timeout: 25_000 });
});