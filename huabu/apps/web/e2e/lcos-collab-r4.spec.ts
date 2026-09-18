// R4 = Reader / Assembly direct manipulation（Track C1）浏览器验收。
// 复用既有 hermetic 栈与 harness，不新建 E2E 架构。

import { expect, test } from '@playwright/test';

import {
  coreJson,
  enterProject,
  openReaderWindow,
  PROJECT_ID,
  readCamera,
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