// Wave 4 浏览器验收：Global HUD（Navigator 岛搜索 / Railway / camera controls / FocusWhere F）。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => { if (m.type() === 'error') (out.consoleErrors ??= []).push(m.text().slice(0, 250)); });

await page.goto('http://localhost:5173/projects/lcos-gen2-dev/main', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('.react-flow', { timeout: 25000 });
await page.waitForTimeout(9000);

out.hud = await page.evaluate(() => JSON.stringify({
  navigatorIsland: !!document.querySelector('[data-lcos-navigator-island]'),
  railway: !!document.querySelector('[data-lcos-railway]'),
  railwayItems: Array.from(document.querySelectorAll('[data-lcos-railway-item]')).map((b) => b.getAttribute('data-lcos-railway-item')),
  cameraControls: !!document.querySelector('[data-lcos-camera-controls]'),
  cameraZoom: document.querySelector('[data-lcos-camera-controls]')?.textContent?.trim() ?? '',
  surfaceDock: !!document.querySelector('[data-lcos-surface-dock]'),
  oldControlsGone: !document.querySelector('.react-flow__controls'),
  oldMinimapGone: !document.querySelector('.react-flow__minimap'),
}));
await page.screenshot({ path: `${SHOTS}/wave4_step1_hud_1366.png` });

// Cmd/Ctrl+F 展开搜索岛 → 真实搜索
await page.keyboard.press('Control+f');
await page.waitForTimeout(400);
const expanded = await page.evaluate(() => JSON.stringify({
  width: document.querySelector('[data-lcos-navigator-island] [class*="transition-all"]') ? 'expanded' : 'unknown',
  hasInput: !!document.querySelector('[data-lcos-navigator-island] input'),
}));
out.navigatorExpanded = expanded;
await page.screenshot({ path: `${SHOTS}/wave4_step2_navigator_expand_1366.png` });

await page.keyboard.type('受控', { delay: 60 });
await page.waitForTimeout(1200); // debounce + search
out.search = await page.evaluate(() => JSON.stringify({
  resultsOpen: !!document.querySelector('[data-lcos-navigator-results]'),
  resultTitles: Array.from(document.querySelectorAll('[data-lcos-navigator-results] button span')).map((s) => (s.textContent ?? '').trim()).filter(Boolean).slice(0, 8),
}));
await page.screenshot({ path: `${SHOTS}/wave4_step3_navigator_results_1366.png` });

// 点第一个结果（同现场定位或无投影提示）
const firstResult = page.locator('[data-lcos-navigator-results] button').first();
if (await firstResult.count() > 0) {
  await firstResult.click().catch(() => {});
  await page.waitForTimeout(1200);
  out.afterResultClick = await page.evaluate(() => JSON.stringify({
    detail: document.querySelector('[data-lcos-navigator-island]')?.textContent?.includes('未在当前现场投影') ? 'unprojected-hint' : 'no-detail',
    viewportChanged: (document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '').slice(0, 80),
  }));
}
await page.screenshot({ path: `${SHOTS}/wave4_step4_loc_1366.png` });

// 点击一个 glyph 节点 → F → FocusWhere 面板
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const glyph = page.locator('[data-lcos-species="glyth"]').first();
if (await glyph.count() > 0) {
  const box = await glyph.boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(600);
  await page.keyboard.press('f');
  await page.waitForTimeout(1500);
  out.focusWhere = await page.evaluate(() => JSON.stringify({
    open: document.querySelector('[data-lcos-focus-where][data-open="true"]') !== null,
    text: (document.querySelector('[data-lcos-focus-where][data-open="true"]')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
  }));
  await page.screenshot({ path: `${SHOTS}/wave4_step5_focuswhere_1366.png` });
} else {
  out.focusWhere = 'no-glyph-node';
}

// camera controls 实测：点放大
const zoomBefore = await page.evaluate(() => (document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '').match(/scale\(([^)]+)\)/)?.[1] ?? '');
await page.locator('[data-lcos-camera-controls] button[aria-label="放大"]').click();
await page.waitForTimeout(700);
const zoomAfter = await page.evaluate(() => (document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '').match(/scale\(([^)]+)\)/)?.[1] ?? '');
out.cameraZoomBtn = { before: zoomBefore, after: zoomAfter, changed: zoomBefore !== zoomAfter };
await page.screenshot({ path: `${SHOTS}/wave4_step6_camera_1366.png` });

await browser.close();
console.log(JSON.stringify(out, null, 2));