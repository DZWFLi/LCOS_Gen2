// Wave 2 debug 2：ctrl+wheel 缩放 / 中键平移 / 框选（抓 RF 行为，排除语法误用）。
import { chromium } from 'playwright-core';

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
const pane = await page.locator('.react-flow__pane').first().boundingBox();
const mid = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 };

// ctrl + wheel zoom
const z1 = await readVp();
if (pane) {
  await page.mouse.move(mid.x, mid.y);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -600);
  await page.keyboard.up('Control');
  await page.waitForTimeout(800);
}
const z2 = await readVp();
out.ctrlWheelZoom = {
  changed: z1 !== z2,
  s1: (z1.match(/scale\(([^)]+)\)/) ?? [])[1] ?? '',
  s2: (z2.match(/scale\(([^)]+)\)/) ?? [])[1] ?? '',
};

// middle drag pan
const p1 = await readVp();
await page.mouse.move(mid.x, mid.y);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(mid.x + 200, mid.y + 120, { steps: 10 });
await page.mouse.up({ button: 'middle' });
await page.waitForTimeout(800);
const p2 = await readVp();
out.middlePan = { changed: p1 !== p2 };

// marquee select on empty region (top-left corner)
const selBefore = await page.locator('.react-flow__node.selected').count();
await page.mouse.move(pane.x + 30, pane.y + 30);
await page.mouse.down();
await page.mouse.move(pane.x + 420, pane.y + 300, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(900);
const selAfter = await page.locator('.react-flow__node.selected').count();
out.marquee = { before: selBefore, after: selAfter, grew: selAfter > selBefore };

// tool probe
out.tools = await page.evaluate(() => JSON.stringify({
  selectedCount: document.querySelectorAll('.react-flow__node.selected').length,
  marqueeBox: !!document.querySelector('.react-flow__selection'),
}));

await browser.close();
console.log(JSON.stringify(out, null, 2));