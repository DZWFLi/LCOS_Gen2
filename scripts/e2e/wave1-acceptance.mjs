// Wave 1 浏览器验收脚本（本地 Chromium；headless）。
// 运行：node scripts/e2e/wave1-acceptance.mjs（需 node_modules 含 playwright-core）
// 证据：重定向 / 启动页 / 项目卡片点击 / LCOS Shell / 旧壳缺位 / 三视口截图。
import { chromium } from 'playwright-core';

const SHOTS = process.env.LCOS_E2E_SHOTS ?? 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const BASE = process.env.LCOS_E2E_BASE ?? 'http://localhost:5173';
const EXE = process.env.LCOS_E2E_CHROMIUM ?? 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';

const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => {
  if (m.type() === 'error') (out.consoleErrors ??= []).push(m.text().slice(0, 300));
});

// 1) Root redirect -> /projects
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2500);
out.landingUrl = page.url();
await page.screenshot({ path: `${SHOTS}/wave1_step1_root_1366.png` });

// 2) /projects launcher content
await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('[data-lcos-launcher]', { timeout: 15000 }).catch(() => (out.launcherMissing = true));
await page.waitForTimeout(3000); // let project list load
out.launcher = await page.evaluate(() =>
  JSON.stringify({
    brand: document.querySelector('header span')?.textContent ?? '',
    title: document.querySelector('h1')?.textContent ?? '',
    subtitle: document.querySelector('header p')?.textContent ?? '',
    hasNewButton: Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('新建项目')),
    hasOpenButton: Array.from(document.querySelectorAll('button')).some((b) => b.textContent?.includes('打开已有项目')),
    projectCards: Array.from(document.querySelectorAll('button.group'))
      .map((b) => b.querySelector('span')?.textContent?.trim())
      .filter(Boolean),
    bodyText: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
  }),
);
await page.screenshot({ path: `${SHOTS}/wave1_step2_launcher_1366.png` });

// 3) Open project shell via real click on project card
const card = page.locator('button.group').first();
if ((await card.count()) > 0) {
  await card.click({ timeout: 8000 }).catch(() => (out.cardClick = 'failed'));
} else {
  await page.goto(`${BASE}/projects/lcos-gen2-dev/main`, { waitUntil: 'domcontentloaded', timeout: 20000 });
}
await page.waitForSelector('[data-lcos-project-shell]', { timeout: 20000 }).catch(() => (out.shellMissing = true));
await page.waitForTimeout(5000); // canvas load
out.shellUrl = page.url();
out.shell = await page.evaluate(() =>
  JSON.stringify({
    hasIdentityCapsule: !!document.querySelector('[data-lcos-project-shell] a[href="/projects"]'),
    hasSurfaceDock: !!document.querySelector('[data-lcos-surface-dock]'),
    dockLabels: Array.from(document.querySelectorAll('[data-lcos-surface-dock] button')).map((b) => b.textContent?.trim()),
    stageSurface: document.querySelector('[data-lcos-worksite-stage]')?.getAttribute('data-lcos-worksite-stage') ?? null,
    stageEmpty: !!document.querySelector('[data-lcos-worksite-stage-empty]'),
    canvasNode: !!document.querySelector('.react-flow'),
    anyAside: !!document.querySelector('aside'),
    headerTexts: Array.from(document.querySelectorAll('header')).map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').slice(0, 80)),
    textSample: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300),
  }),
);
await page.screenshot({ path: `${SHOTS}/wave1_step3_shell_1366.png` });

// 3b) probe for known old-chrome classes
await page.waitForTimeout(1500);
out.oldChromeProbe = await page.evaluate(() =>
  JSON.stringify({
    layerPanel: !!document.querySelector('[class*="layer-panel"], [data-testid*="layer"]'),
    previewPanel: !!document.querySelector('[class*="preview-workspace"], [class*="PreviewWorkspace"]'),
    canvasHeaderClass: !!document.querySelector('header[class*="CanvasHeader"], [class*="canvas-header"]'),
    floatingControls: Array.from(document.querySelectorAll('button'))
      .filter((b) => /Handbook|Settings|^Bot$/i.test(b.textContent ?? ''))
      .map((b) => (b.textContent ?? '').trim()),
  }),
);

// 4) viewports
for (const [w, h, tag] of [[1440, 900, '1440'], [1024, 768, '1024']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/wave1_step4_shell_${tag}.png` });
}
await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(2500);
for (const [w, h, tag] of [[1440, 900, '1440'], [1024, 768, '1024']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/wave1_step5_launcher_${tag}.png` });
}

await browser.close();
console.log(JSON.stringify(out, null, 2));