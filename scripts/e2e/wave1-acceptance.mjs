// Wave 1 浏览器验收（fail-fast 门禁）。
//
// 依据：正本 `04_逐Wave施工卡与验收.md` Wave 1「真实浏览器动作」1–5 与「可见退出条件」，
// 以及 `appendices/B_Huabu旧壳退役与内核保留_ExactAudit.md`「防止再次出现本次施工问题的
// 验收规则 → 视觉验收」。
//
// 前置（必须与本次运行在同一条命令链里；隔离环境会被上层进程树回收）：
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 reset
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 up
// 运行：
//   node scripts/e2e/wave1-acceptance.mjs
//
// 设计约束（实测教训）：本脚本必须能从**干净数据目录**跑绿，并且不依赖上一次运行残留。
// 因此它 (a) 从 Core API 读项目/工作现场事实，(b) 只要求现场舞台处于**合法状态**
// （活的 Canvas，或诚实的空态/恢复态），(c) 若没有画布则走真实建立路径再断言。
//
// 环境变量：
//   LCOS_E2E_BASE     默认 http://localhost:5273（隔离环境；用户 dev 是 5173）
//   LCOS_E2E_CORE     默认 http://127.0.0.1:43131（隔离 Core）
//   LCOS_E2E_SHOTS    截图目录
//   LCOS_E2E_PROJECT  默认 lcos-gen2-dev
import { chromium } from 'playwright-core';

const BASE = process.env.LCOS_E2E_BASE ?? 'http://localhost:5273';
const CORE = process.env.LCOS_E2E_CORE ?? 'http://127.0.0.1:43131';
const CORE_TOKEN = process.env.LCOS_E2E_CORE_TOKEN ?? 'dev-token';
const SHOTS = process.env.LCOS_E2E_SHOTS ?? 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE =
  process.env.LCOS_E2E_CHROMIUM ??
  'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const PROJECT_ID = process.env.LCOS_E2E_PROJECT ?? 'lcos-gen2-dev';

const failures = [];
const evidence = {};
const check = (ok, message) => {
  if (ok !== true) failures.push(message);
};

/** 旧三栏壳（MainLayout）与旧 CenterArea 浮动组在生产树中的独有标记。 */
const OLD_SHELL_PROBE = () => ({
  oldMainLayoutRightPanel: document.querySelectorAll('[data-right-panel-content]').length,
  oldCanvasRestoring: document.querySelectorAll('[data-canvas-restoring]').length,
  oldRightPanelMotion: document.querySelectorAll('[data-right-panel-motion]').length,
  oldCenterAreaFloating: document.querySelectorAll(
    '[class*="top-3"][class*="right-2"][class*="z-30"]',
  ).length,
});

/** 现场舞台的合法状态（Canvas 活着 / 诚实空态 / 诚实恢复态 / 诚实加载失败）。 */
const STAGE_PROBE = () => ({
  live: !!document.querySelector('[data-lcos-worksite-stage]:not([data-lcos-worksite-stage-empty])'),
  reactFlow: !!document.querySelector('.react-flow'),
  empty: !!document.querySelector('[data-lcos-worksite-stage-empty]'),
  recover: !!document.querySelector('[data-lcos-recover-canvas]'),
  loadError: !!document.querySelector('[data-lcos-worksite-load-error]'),
  canvasIdAttr:
    document.querySelector('[data-lcos-worksite-stage]')?.getAttribute('data-lcos-canvas-id') ??
    null,
});

async function coreGet(path) {
  const res = await fetch(`${CORE}${path}`, {
    headers: { Authorization: `Bearer ${CORE_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Core GET ${path} -> ${res.status}`);
  const body = await res.json();
  return body.value ?? body;
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 240)}`));
const failedResponses = [];
page.on('response', (r) => {
  if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.url().slice(0, 180)}`);
});

const snap = (name, fullPage = false) => page.screenshot({ path: `${SHOTS}/${name}`, fullPage });

try {
  // ── 0) Core 事实（不猜；干净数据目录下 workspace 可能还没有 canvasId） ──────
  const projects = await coreGet('/projects');
  const projectId = projects.find((p) => p.id === PROJECT_ID)?.id ?? projects[0]?.id;
  check(!!projectId, 'Core 里没有可用项目，无法验收');
  const workspaces = await coreGet(`/projects/${encodeURIComponent(projectId)}/workspaces`);
  evidence.core = {
    projectId,
    workspaces: workspaces.map((w) => ({
      id: String(w.id),
      surface: w.preferredSurface ?? null,
      canvasId: w.canvasId ?? null,
    })),
  };

  // ── 1) `/spaces` = LCOS 项目启动页（不再是 Huabu CanvasListPage） ──────────
  await page.goto(`${BASE}/spaces`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const launcherReady = await page
    .waitForSelector('[data-lcos-launcher]', { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(3000);
  evidence.spaces = await page.evaluate(() => ({
    url: location.pathname,
    hasLauncher: !!document.querySelector('[data-lcos-launcher]'),
    heading: document.querySelector('[data-lcos-launcher] h1')?.textContent?.trim() ?? null,
    projectCards: document.querySelectorAll('[data-lcos-launcher] button.group').length,
    oldCanvasLinks: document.querySelectorAll('a[href^="/canvas/"]').length,
  }));
  check(launcherReady, '/spaces 未渲染 LCOS 启动页（[data-lcos-launcher] 缺失）');
  check(evidence.spaces.projectCards > 0, '/spaces 没有读到真实 Core 项目卡片');
  await snap('wave1_step1_spaces_1366.png');

  // ── 2) 从项目列表进入项目（真实点击卡片） ────────────────────────────────
  const cards = await page.locator('[data-lcos-launcher] button.group').count();
  if (cards > 0) {
    await page.locator('[data-lcos-launcher] button.group').first().click({ timeout: 10000 });
  } else {
    await page.goto(`${BASE}/projects/${PROJECT_ID}/main`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
  }
  const shellReady = await page
    .waitForSelector('[data-lcos-project-shell]', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  await page.waitForTimeout(7000);
  check(shellReady, '进入项目后未出现 LCOS Shell（[data-lcos-project-shell] 缺失）');

  // ── 4) DOM：旧五类 UI caller 未 mount ───────────────────────────────────
  evidence.shell = {
    ...(await page.evaluate(OLD_SHELL_PROBE)),
    ...(await page.evaluate(STAGE_PROBE)),
    ...(await page.evaluate(() => ({
      url: location.pathname,
      identityCapsule: !!document.querySelector('[data-lcos-project-shell] a[href="/projects"]'),
      surfaceDock: !!document.querySelector('[data-lcos-surface-dock]'),
    }))),
  };
  check(evidence.shell.oldMainLayoutRightPanel === 0, `旧 MainLayout 右栏仍挂载 ×${evidence.shell.oldMainLayoutRightPanel}`);
  check(evidence.shell.oldCanvasRestoring === 0, `旧 MainLayout 节点仍挂载（data-canvas-restoring）×${evidence.shell.oldCanvasRestoring}`);
  check(evidence.shell.oldRightPanelMotion === 0, `旧 MainLayout 节点仍挂载（data-right-panel-motion）×${evidence.shell.oldRightPanelMotion}`);
  check(evidence.shell.oldCenterAreaFloating === 0, `旧 CenterArea 浮动按钮组仍挂载 ×${evidence.shell.oldCenterAreaFloating}`);
  check(evidence.shell.identityCapsule, 'LCOS Shell 缺少项目身份胶囊');
  check(
    evidence.shell.live || evidence.shell.empty || evidence.shell.recover || evidence.shell.loadError,
    '现场舞台既没有活 Canvas，也没有诚实的空态/恢复态/加载失败态',
  );
  await snap('wave1_step2_shell_1366.png');

  // ── 2b) 没有画布就走真实建立路径，再断言唯一 Canvas 可用 ──────────────────
  if (!evidence.shell.reactFlow) {
    const recoverBtn = page.locator('[data-lcos-recover-canvas]').first();
    const emptyBtn = page.locator('[data-lcos-worksite-stage-empty] button').first();
    if ((await recoverBtn.count()) > 0) {
      await recoverBtn.click({ timeout: 10000 }).catch(() => undefined);
    } else if ((await emptyBtn.count()) > 0) {
      await emptyBtn.click({ timeout: 10000 }).catch(() => undefined);
    } else {
      failures.push('现场没有画布，且找不到任何诚实建立/恢复入口');
    }
    await page.waitForSelector('.react-flow', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(7000);
  }
  evidence.canvasEstablished = await page.evaluate(() => ({
    reactFlow: !!document.querySelector('.react-flow'),
    canvasIdAttr:
      document.querySelector('[data-lcos-worksite-stage]')?.getAttribute('data-lcos-canvas-id') ??
      null,
    loadError: !!document.querySelector('[data-lcos-worksite-load-error]'),
  }));
  check(evidence.canvasEstablished.reactFlow, '现场画布建立后仍未出现唯一 Huabu Canvas（.react-flow）');
  evidence.canvasIdAfterEstablish = evidence.canvasEstablished.canvasIdAttr;

  // ── 3) `/canvas/:canvasId` 深链也落在 LCOS Shell，且 URL 不被改写 ────────
  let canvasId = evidence.canvasIdAfterEstablish;
  if (!canvasId) {
    const ws = await coreGet(`/projects/${encodeURIComponent(projectId)}/workspaces`);
    canvasId = ws.find((w) => w.preferredSurface === 'main')?.canvasId ?? ws.find((w) => w.canvasId)?.canvasId ?? null;
  }
  check(!!canvasId, '拿不到真实 canvasId，无法验证 /canvas/:canvasId 深链');
  if (canvasId) {
    await page.goto(`${BASE}/canvas/${encodeURIComponent(canvasId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const deepShell = await page
      .waitForSelector('[data-lcos-project-shell]', { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(7000);
    evidence.canvasDeepLink = {
      ...(await page.evaluate(OLD_SHELL_PROBE)),
      ...(await page.evaluate(() => ({
        url: location.pathname,
        decodedUrl: decodeURIComponent(location.pathname),
        hasShell: !!document.querySelector('[data-lcos-project-shell]'),
        reactFlow: !!document.querySelector('.react-flow'),
        boundState:
          document
            .querySelector('[data-lcos-canvas-binding]')
            ?.getAttribute('data-lcos-canvas-binding') ?? null,
        bodyText: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200),
      }))),
    };
    check(deepShell, '/canvas/:canvasId 深链未进入 LCOS Shell');
    check(
      evidence.canvasDeepLink.decodedUrl === `/canvas/${canvasId}`,
      `/canvas/:canvasId 深链被改写为 ${evidence.canvasDeepLink.decodedUrl}（应保留原 URL）`,
    );
    check(evidence.canvasDeepLink.oldMainLayoutRightPanel === 0, '/canvas/:canvasId 下旧 MainLayout 仍挂载');
    check(evidence.canvasDeepLink.oldCenterAreaFloating === 0, '/canvas/:canvasId 下旧 CenterArea 浮动组仍挂载');
    await snap('wave1_step3_canvas_deeplink_1366.png');
  }

  // ── 2c) 刷新项目 URL：project identity 不丢 ─────────────────────────────
  await page.goto(`${BASE}/projects/${projectId}/main`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('[data-lcos-project-shell]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(7000);
  const beforeReload = await page.evaluate(() => ({
    url: location.pathname,
    capsule:
      document
        .querySelector('[data-lcos-project-shell] a[href="/projects"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? null,
  }));
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('[data-lcos-project-shell]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(7000);
  const afterReload = await page.evaluate(() => ({
    url: location.pathname,
    capsule:
      document
        .querySelector('[data-lcos-project-shell] a[href="/projects"]')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim() ?? null,
    reactFlow: !!document.querySelector('.react-flow'),
  }));
  evidence.reload = { beforeReload, afterReload };
  check(afterReload.url === beforeReload.url, '刷新后 URL 变了');
  check(
    !!afterReload.capsule && afterReload.capsule === beforeReload.capsule,
    `刷新后 project identity 丢失（before=${beforeReload.capsule} after=${afterReload.capsule}）`,
  );
  check(afterReload.reactFlow, '刷新后 Canvas 未恢复');
  await snap('wave1_step4_reload_1366.png');

  // ── 3b) back/forward：surface 之间往返，Shell 不消失 ──────────────────────
  await page.goto(`${BASE}/projects/${projectId}/context`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('[data-lcos-project-shell]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(6000);
  const onContext = await page.evaluate(() => ({
    url: location.pathname,
    hasShell: !!document.querySelector('[data-lcos-project-shell]'),
    dockActive:
      document
        .querySelector('[data-lcos-surface][data-lcos-surface-active="true"]')
        ?.getAttribute('data-lcos-surface') ?? null,
  }));
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => undefined);
  await page.waitForSelector('[data-lcos-project-shell]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(6000);
  const afterBack = {
    ...(await page.evaluate(OLD_SHELL_PROBE)),
    ...(await page.evaluate(() => ({
      url: location.pathname,
      hasShell: !!document.querySelector('[data-lcos-project-shell]'),
    }))),
  };
  evidence.history = { onContext, afterBack };
  check(onContext.hasShell, '切到 context surface 后 LCOS Shell 消失');
  check(afterBack.hasShell, 'back 之后 LCOS Shell 消失');
  check(afterBack.oldMainLayoutRightPanel === 0, 'back 之后旧 MainLayout 出现');

  // ── 5) 三视口整页截图（1366×768 / 1440×900 / 1024×768） ─────────────────
  await page.goto(`${BASE}/projects/${projectId}/main`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('[data-lcos-project-shell]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(7000);
  for (const [w, h, tag] of [
    [1366, 768, '1366'],
    [1440, 900, '1440'],
    [1024, 768, '1024'],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1800);
    await snap(`wave1_step5_shell_${tag}.png`, true);
  }

  evidence.consoleErrors = consoleErrors;
  evidence.failedResponses = failedResponses;
  // React 不变式门禁：禁止 "setState during render"（干净数据目录下首次建立画布时曾触发）。
  check(
    !consoleErrors.some((t) => /Cannot update a component/.test(t)),
    `出现 "Cannot update a component ... while rendering" 违反项：${consoleErrors.find((t) => /Cannot update a component/.test(t))}`,
  );
  // 夹具回归门禁：Core 不得再声明 Huabu 不存在的画布 id（曾在干净数据目录下首屏 404）。
  const danglingFixtureCanvas = failedResponses.filter((r) => /canvas-lcos-/.test(r));
  check(
    danglingFixtureCanvas.length === 0,
    `Core 夹具仍声明 Huabu 不存在的画布 id：${danglingFixtureCanvas.join(' | ')}`,
  );
} finally {
  await browser.close().catch(() => undefined);
}

const ok = failures.length === 0;
console.log(JSON.stringify({ scenario: 'wave1-acceptance', ok, failures, evidence }, null, 2));
if (!ok) {
  console.error('FAIL wave1-acceptance');
  process.exitCode = 1;
}