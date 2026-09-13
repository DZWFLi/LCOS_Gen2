// Wave 2 parity：同一 Canvas 在 LCOS 路由 vs Huabu dev route 的框选/指针参数对比。
import { chromium } from 'playwright-core';

const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

async function probe(route, label) {
  await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('.react-flow__node', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(4500);
  const info = await page.evaluate(() => JSON.stringify({
    coarse: matchMedia('(pointer: coarse)').matches,
    fine: matchMedia('(pointer: fine)').matches,
    anyPointer: matchMedia('(any-pointer: fine)').matches,
    nodes: document.querySelectorAll('.react-flow__node').length,
  }));
  const selBefore = await page.locator('.react-flow__node.selected').count();
  const pane = await page.locator('.react-flow__pane').first().boundingBox();
  let boxResult = null;
  if (pane) {
    await page.mouse.move(pane.x + 25, pane.y + 25);
    await page.mouse.down();
    await page.mouse.move(pane.x + 480, pane.y + 330, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
  }
  const selAfter = await page.locator('.react-flow__node.selected').count();
  boxResult = { before: selBefore, after: selAfter, grew: selAfter > selBefore };
  out[label] = { media: JSON.parse(info), marquee: boxResult };
}

await probe('http://localhost:5173/projects/lcos-gen2-dev/main', 'lcos');
await probe('http://localhost:5173/canvas/canvas-ac7b8268-7280-474e-a77c-dd7d10320452', 'huabuDev');

await browser.close();
console.log(JSON.stringify(out, null, 2));