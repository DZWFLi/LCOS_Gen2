// Wave 3 浏览器验证：LCOS species body 是否真实渲染（binding-aware seam 接管）。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto('http://localhost:5173/projects/lcos-gen2-dev/main', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('.react-flow', { timeout: 25000 });
// wait longer for reconcile + reference store sync
await page.waitForTimeout(12000);

out.species = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
  const speciesCount = {};
  for (const node of nodes) {
    const body = node.querySelector('[data-lcos-species-body]');
    if (body) {
      const species = body.firstElementChild?.getAttribute('data-lcos-species') ?? 'bare';
      speciesCount[species] = (speciesCount[species] ?? 0) + 1;
    }
  }
  return JSON.stringify({
    totalNodes: nodes.length,
    withLcosBody: Object.values(speciesCount).reduce((a, b) => a + b, 0),
    bySpecies: speciesCount,
  });
});
await page.screenshot({ path: `${SHOTS}/wave3_step1_species_1366.png` });

// zoom in to check density switching (reading density content)
await page.locator('.react-flow__viewport').first().boundingBox().then(async (pane) => {
  if (!pane) return;
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -1200);
  await page.keyboard.up('Control');
});
await page.waitForTimeout(1200);
out.afterZoomIn = await page.evaluate(() => JSON.stringify({
  sampleMeta: (() => {
    const body = document.querySelector('[data-lcos-species-body]');
    if (!body) return null;
    const spans = Array.from(body.querySelectorAll('span'));
    const small = spans.find((s) => (s.textContent ?? '').length < 40 && s.textContent?.includes('·'));
    return small?.textContent ?? null;
  })(),
}));
await page.screenshot({ path: `${SHOTS}/wave3_step2_zoomin_1366.png` });

await browser.close();
console.log(JSON.stringify(out, null, 2));