// R0-3 验收：stale canvas → 重建 → 回写 → reload 持久化 → 再进不重复创建。
// 只在 R0-6 隔离环境跑（默认 http://localhost:5273，指向隔离 Core 43131 / Huabu 3011），
// 绝不使用用户 dev 数据（43121/3001/5173）。
//
//   node scripts/e2e/r0-stale-canvas.mjs            # 用默认隔离端口
//   LCOS_E2E_WEB_URL=http://localhost:5273 node …   # 显式指定
//
// 退出码：任何一步不满足 → 非零（由 _harness 统一处理）。

import { runScenario } from './_harness.mjs';

const BASE = process.env.LCOS_E2E_WEB_URL ?? 'http://localhost:5273';
const PROJECT = 'lcos-gen2-dev';
const TOKEN = process.env.LCOS_E2E_TOKEN ?? 'dev-token';

async function mainCanvasId() {
  const response = await fetch(`${BASE}/lcos-core/projects/${PROJECT}/workspaces`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!response.ok) throw new Error(`读取 workspaces 失败：HTTP ${response.status}`);
  const body = await response.json();
  const main = body.value.find((w) => w.preferredSurface === 'main');
  if (!main) throw new Error('隔离 Core 里没有 preferredSurface=main 的 workspace');
  return main.canvasId;
}

await runScenario({
  name: 'r0-stale-canvas-recreate-persist',
  baseUrl: BASE,
  allowHttp: [404],
  // 期望出现：stale canvasId 导致的画布 404 日志（本场景要验证的正是它）
  allowConsoleErrorsMatching: [/404/, /Failed to load resource/],
  body: async (h) => {
    // 1) 隔离 Core 已被 ensureRealDevProject() 种入 lcos-gen2-dev，其 workspace.canvasId 指向
    //    一张本环境 Huabu 画布库里不存在的画布 → 首次进入必然 404
    const staleCanvasId = await mainCanvasId();
    h.requireNonEmpty(staleCanvasId, '隔离 Core workspace 应带 canvasId');

    // 2) 首次进入：出现恢复入口
    await h.goto(`/projects/${PROJECT}/main`);
    await h.wait(6000);
    await h.requireSelector('[data-lcos-recover-canvas]', {
      timeout: 30000,
      message: 'stale canvas 场景未出现「重新建立现场画布」恢复入口',
    });

    // 3) 点击重建 → 真实挂上新画布
    await h.page.locator('[data-lcos-recover-canvas]').first().click();
    await h.requireSelector('.react-flow', {
      timeout: 60000,
      message: '点击重建后 Main 仍未挂载画布（ensureCanvas(recreate) 未生效）',
    });
    await h.wait(8000);

    // 4) Core workspace.canvasId 已更新且不等于旧值
    const recreatedCanvasId = await mainCanvasId();
    h.requireNonEmpty(recreatedCanvasId, '重建后 workspace.canvasId 为空');
    h.requireTrue(
      recreatedCanvasId !== staleCanvasId,
      `重建后 canvasId 未变化（仍是 ${String(recreatedCanvasId)}）`,
    );

    // 5) reload 后仍用同一新 canvasId，且不再显示恢复入口
    await h.page.reload({ waitUntil: 'domcontentloaded' });
    await h.requireSelector('.react-flow', { timeout: 40000, message: 'reload 后画布未挂载' });
    await h.wait(6000);
    const afterReload = await mainCanvasId();
    h.requireEqual(afterReload, recreatedCanvasId, 'reload 后 workspace.canvasId 漂移');
    h.requireTrue(
      (await h.has('[data-lcos-recover-canvas]')) === false,
      'reload 后仍显示恢复入口（说明 workspace 未被正确持久化）',
    );

    // 6) 再普通进入一次：不得重复创建
    await h.page.reload({ waitUntil: 'domcontentloaded' });
    await h.requireSelector('.react-flow', { timeout: 40000 });
    await h.wait(6000);
    const thirdOpen = await mainCanvasId();
    h.requireEqual(thirdOpen, recreatedCanvasId, '再次进入时重复创建了新画布');
  },
});
