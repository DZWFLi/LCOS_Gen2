// Wave 1 浏览器验收（fail-fast 门禁）。
//
// 依据：正本 `04_逐Wave施工卡与验收.md` Wave 1「真实浏览器动作」1–5 与「可见退出条件」，
// 以及 `appendices/B_Huabu旧壳退役与内核保留_ExactAudit.md`「防止再次出现本次施工问题的
// 验收规则 → 视觉验收」。
//
// 前置（必须与本次运行在同一条命令链里；隔离环境会被上层进程树回收）：
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 up
// 运行：
//   node scripts/e2e/wave1-acceptance.mjs
//
// 环境变量：
//   LCOS_E2E_BASE     默认 http://localhost:5273（隔离环境；用户 dev 是 5173）
//   LCOS_E2E_SHOTS    截图目录
//   LCOS_E2E_PROJECT  默认 lcos-gen2-dev（r0-e2e-env 播种的真实 Core 项目）
import { chromium } from 'playwright-core';

const BASE = process.env.LCOS_E2E_BASE ?? 'http://localhost:5273';
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

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 240)}`));

const snap = (name, fullPage = false) =>
  page.screenshot({ path: `${SHOTS}/${name}`, fullPage });

/** 旧三栏壳（MainLayout）与旧 CenterArea 浮动组在生产树中的独有标记。 */
const OLD_SHELL_PROBE = () => ({
  oldMainLayoutRightPanel: document.querySelectorAll('[data-right-panel-content]').length,
  oldCanvasRestoring: document.querySelectorAll('[data-canvas-restoring]').length,
  oldRightPanelMotion: document.querySelectorAll('[data-right-panel-motion]').length,
  oldCenterAreaFloating: document.querySelectorAll(
    '[class*="top-3"][class*="right-2"][class*="z-30"]',
  ).length,
});

try {
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
  await snap('wave1_step1_spaces_1366.png');

  // ── 2) 从项目列表进入项目（真实点击卡片） ────────────────────────────────
  const cards = await page.locator('[data-lcos-launcher] button.group').count();
  check(cards > 0, `/spaces 没有读到真实 Core 项目卡片（cards=${cards}）`);
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

  // ── 4) DOM：旧五类 UI caller 未 mount；新壳唯一 ──────────────────────────
  evidence.shell = {
    ...(await page.evaluate(OLD_SHELL_PROBE)),
    ...(await page.evaluate(() => ({
      url: location.pathname,
      identityCapsule: !!document.querySelector('[data-lcos-project-shell] a[href="/projects"]'),
      reactFlow: !!document.querySelector('.react-flow'),
      canvasId:
        document.querySelector('[data-lcos-worksite-stage]')?.getAttribute('data-lcos-canvas-id') ??
        null,
      surfaceDock: !!document.querySelector('[data-lcos-surface-dock]'),
    }))),
  };
  check(evidence.shell.oldMainLayoutRightPanel === 0, `旧 MainLayout 右栏仍挂载 ×${evidence.shell.oldMainLayoutRightPanel}`);
  check(evidence.shell.oldCanvasRestoring === 0, `旧 MainLayout 节点仍挂载（data-canvas-restoring）×${evidence.shell.oldCanvasRestoring}`);
  check(evidence.shell.oldRightPanelMotion === 0, `旧 MainLayout 节点仍挂载（data-right-panel-motion）×${evidence.shell.oldRightPanelMotion}`);
  check(evidence.shell.oldCenterAreaFloating === 0, `旧 CenterArea 浮动按钮组仍挂载 ×${evidence.shell.oldCenterAreaFloating}`);
  check(evidence.shell.identityCapsule, 'LCOS Shell 缺少项目身份胶囊');
  check(evidence.shell.reactFlow, 'LCOS Shell 下没有唯一 Huabu Canvas（.react-flow 缺失）');
  await snap('wave1_step2_shell_1366.png');

  // ── 3) `/canvas/:canvasId` 深链也落在 LCOS Shell，且 URL 不被改写 ────────
  const canvasId = evidence.shell.canvasId;
  if (canvasId) {
    await page.goto(`${BASE}/canvas/${encodeURIComponent(canvasId)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const deepShell = await page
      .waitForSelector('[data-lcos-project-shell]', { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForTimeout(6000);
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
        bodyText: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 240),
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
  } else {
    failures.push('拿不到真实 canvasId，无法验证 /canvas/:canvasId 深链');
  }

  // ── 2b) 刷新项目 URL：project identity 不丢 ─────────────────────────────
  await page.goto(`${BASE}/projects/${PROJECT_ID}/main`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('[data-lcos-project-shell]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(6000);
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
  await page.waitForTimeout(6000);
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

  // ── 3b) back/forward：surface 之间往返，Shell 与 identity 不丢 ────────────
  await page.goto(`${BASE}/projects/${PROJECT_ID}/context`, {
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
      reactFlow: !!document.querySelector('.react-flow'),
    }))),
  };
  evidence.history = { onContext, afterBack };
  check(afterBack.hasShell, 'back 之后 LCOS Shell 消失');
  check(afterBack.reactFlow, 'back 之后 Canvas 未恢复');
  check(afterBack.oldMainLayoutRightPanel === 0, 'back 之后旧 MainLayout 出现');

  // ── 5) 三视口整页截图（1366×768 / 1440×900 / 1024×768） ─────────────────
  await page.goto(`${BASE}/projects/${PROJECT_ID}/main`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('[data-lcos-project-shell]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(6000);
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
} finally {
  await browser.close().catch(() => undefined);
}

const ok = failures.length === 0;
console.log(JSON.stringify({ scenario: 'wave1-acceptance', ok, failures, evidence }, null, 2));
if (!ok) {
  console.error('FAIL wave1-acceptance');
  process.exitCode = 1;
}