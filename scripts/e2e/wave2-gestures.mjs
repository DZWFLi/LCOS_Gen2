// Wave 2 补充：wheel zoom（角落）、中键 pan、左键框选（Huabu frozen 指针语法）。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

await page.goto('http://localhost:5173/projects/lcos-gen2-dev/main', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('.react-flow__node', { timeout: 25000 });
await page.waitForTimeout(4500);

const readVp = () => page.evaluate(() => {
  const el = document.querySelector('.react-flow__viewport');
  return el ? (el.getAttribute('style') ?? '') : '';
});

// wheel zoom at pane corner (away from nodes)
const pane = await page.locator('.react-flow__pane').first().boundingBox();
const z1 = await readVp();
if (pane) {
  await page.mouse.move(pane.x + 40, pane.y + 40);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(700);
}
const z2 = await readVp();
out.wheelZoomChanged = z1 !== z2;
out.zScale1 = (z1.match(/scale\(([^)]+)\)/) ?? [])[1] ?? '';
out.zScale2 = (z2.match(/scale\(([^)]+)\)/) ?? [])[1] ?? '';

// middle-mouse pan
const p1 = await readVp();
if (pane) {
  await page.mouse.move(pane.x + 300, pane.y + 200);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(pane.x + 480, pane.y + 320, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(700);
}
const p2 = await readVp();
out.middlePanChanged = p1 !== p2;

// left-drag marquee selection creates selection outline (tool=select)
const beforeSelected = await page.locator('.react-flow__node.selected').count();
if (pane) {
  await page.mouse.move(pane.x + 100, pane.y + 100);
  await page.mouse.down();
  await page.mouse.move(pane.x + 520, pane.y + 380, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(800);
}
const afterSelected = await page.locator('.react-flow__node.selected').count();
out.marqueeSelection = { beforeSelected, afterSelected };
out.marqueeGrew = afterSelected > beforeSelected;
await page.screenshot({ path: `${SHOTS}/wave2_step4_zoom_pan_marquee_1366.png` });

await browser.close();
console.log(JSON.stringify(out, null, 2));