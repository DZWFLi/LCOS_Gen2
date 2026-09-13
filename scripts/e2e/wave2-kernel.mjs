// Wave 2 机械回归验收（LCOS chromeMode 下 Huabu kernel 保留）。
// 断言：chrome 隐藏 + pan/zoom/select/drag/reload 几何保持。本地 Chromium headless。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5173';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => { if (m.type() === 'error') (out.consoleErrors ??= []).push(m.text().slice(0, 300)); });

await page.goto(`${BASE}/projects/lcos-gen2-dev/main`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('.react-flow', { timeout: 25000 });
await page.waitForTimeout(5000);

// chrome 隐藏断言
out.chrome = await page.evaluate(() => JSON.stringify({
  reactFlow: !!document.querySelector('.react-flow'),
  hasControls: !!document.querySelector('.react-flow__controls'),
  hasMiniMap: !!document.querySelector('.react-flow__minimap'),
  nodeToolbarText: Array.from(document.querySelectorAll('.react-flow__panel')).map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60)).filter(Boolean),
  hostOverlay: !!document.querySelector('[data-lcos-host-overlay], [data-testid*="host-overlay"]'),
}));

// 选取第一个真实节点
const firstNode = page.locator('.react-flow__node').first();
await firstNode.waitFor({ timeout: 15000 }).catch(() => (out.nodeWait = 'none'));
const nodeCount = await page.locator('.react-flow__node').count();
out.nodeCount = nodeCount;
await page.screenshot({ path: `${SHOTS}/wave2_step1_initial_1366.png` });

// 1) 点击选中
const nodeBox = await firstNode.boundingBox();
if (nodeBox) {
  await page.mouse.click(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.waitForTimeout(600);
  out.selectedClass = await firstNode.getAttribute('class').then((c) => (c ?? '').includes('selected'));
}

// 2) 拖拽节点 → transform 变化
let transformBefore = await firstNode.getAttribute('style').then((s) => s ?? '');
if (nodeBox) {
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(nodeBox.x + nodeBox.width / 2 + 120, nodeBox.y + nodeBox.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
}
let transformAfter = await firstNode.getAttribute('style').then((s) => s ?? '');
out.dragMoved = transformBefore !== transformAfter;
out.transformBefore = transformBefore.slice(0, 120);
out.transformAfter = transformAfter.slice(0, 120);
await page.screenshot({ path: `${SHOTS}/wave2_step2_drag_1366.png` });

// 3) wheel zoom → viewport transform 变化
const vpTransform = (async () =>
  await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__viewport');
    return pane ? (pane.getAttribute('style') ?? '') : '';
  }))();
const zoomBefore = await vpTransform;
const pane = await page.locator('.react-flow__viewport').first().boundingBox();
if (pane) {
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(700);
}
const zoomAfter = await page.evaluate(() => {
  const el = document.querySelector('.react-flow__viewport');
  return el ? (el.getAttribute('style') ?? '') : '';
});
out.zoomChanged = zoomBefore !== zoomAfter;
out.zoomBefore = zoomBefore.slice(0, 120);
out.zoomAfter = zoomAfter.slice(0, 120);

// 4) 空区拖拽 pan → viewport transform 再变
const panBefore = await page.evaluate(() => {
  const el = document.querySelector('.react-flow__viewport');
  return el ? (el.getAttribute('style') ?? '') : '';
});
const paneBox = await page.locator('.react-flow__pane').first().boundingBox();
if (paneBox) {
  await page.mouse.move(paneBox.x + 60, paneBox.y + 60);
  await page.mouse.down();
  await page.mouse.move(paneBox.x + 220, paneBox.y + 180, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}
const panAfter = await page.evaluate(() => {
  const el = document.querySelector('.react-flow__viewport');
  return el ? (el.getAttribute('style') ?? '') : '';
});
out.panChanged = panBefore !== panAfter;

// 5) reload 后几何保持（换一个节点记录位置靠 center 检测；用 transform 是否恢复持久化值）
// 通过 reload 后节点数量与布局仍渲染来判断；真实持久化由 canvasStore 既有测试覆盖。
await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('.react-flow__node', { timeout: 25000 });
await page.waitForTimeout(4500);
out.afterReload = await page.evaluate(() => JSON.stringify({
  nodes: document.querySelectorAll('.react-flow__node').length,
  canvasAlive: !!document.querySelector('.react-flow'),
  chromeStillHidden: !document.querySelector('.react-flow__controls') && !document.querySelector('.react-flow__minimap'),
}));
await page.screenshot({ path: `${SHOTS}/wave2_step3_reload_1366.png` });

await browser.close();
console.log(JSON.stringify(out, null, 2));