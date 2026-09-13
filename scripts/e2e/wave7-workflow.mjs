// Wave 7 验收：Workflow 现场 + 手牌/Card Pool（真实数据；取用→草稿）。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => { if (m.type() === 'error') (out.consoleErrors ??= []).push(m.text().slice(0, 250)); });

await page.goto('http://localhost:5173/projects/lcos-gen2-dev/workflow', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForTimeout(9000);
// 若画布引用失效（seeded stale canvasId）→ 走真实恢复：重建画布并回写
const recover = page.getByRole('button', { name: '重新建立现场画布（回写 workspace）' });
if (await recover.count() > 0) {
  out.recovery = 'canvas-not-found → recover clicked';
  await recover.click();
  await page.waitForTimeout(6000);
}
await page.waitForSelector('.react-flow', { timeout: 30000 });
await page.waitForTimeout(4000);
out.worksite = await page.evaluate(() => JSON.stringify({
  worksite: !!document.querySelector('[data-lcos-workflow-worksite]'),
  stageSurface: document.querySelector('[data-lcos-worksite-stage]')?.getAttribute('data-lcos-worksite-stage') ?? null,
  handToggle: !!document.querySelector('[data-lcos-workflow-hand-toggle]'),
  canvasAlive: !!document.querySelector('.react-flow'),
}));
await page.screenshot({ path: `${SHOTS}/wave7_step1_workflow_1366.png` });

// 打开手牌卡池
await page.locator('[data-lcos-workflow-hand-toggle]').click();
await page.waitForSelector('[data-lcos-workflow-hand]', { timeout: 15000 });
await page.waitForTimeout(3000);
out.pool = await page.evaluate(() => JSON.stringify({
  open: !!document.querySelector('[data-lcos-workflow-hand]'),
  cards: Array.from(document.querySelectorAll('[data-lcos-workflow-card]')).length,
  cardKinds: Array.from(document.querySelectorAll('[data-lcos-workflow-card] span')).slice(0, 10).map((s) => (s.textContent ?? '').trim()).filter(Boolean),
}));
await page.screenshot({ path: `${SHOTS}/wave7_step2_hand_1366.png` });

// 取用一张卡 → Composer 草稿 strip（真实 DOM click；Playwright force-click 对 absolute 容器有合成事件怪癖）
const take = page.locator('[data-lcos-card-take]').first();
if (await take.count() > 0) {
  await page.evaluate(() => {
    const btn = document.querySelector('[data-lcos-card-take]');
    btn?.click();
  });
  await page.waitForTimeout(900);
  out.tookToDraft = await page.evaluate(() => JSON.stringify({
    composerRefs: Array.from(document.querySelectorAll('[data-lcos-composer-ref]')).map((r) => (r.textContent ?? '').trim()),
  }));
  await page.screenshot({ path: `${SHOTS}/wave7_step3_take_draft_1366.png` });
}

await browser.close();
console.log(JSON.stringify(out, null, 2));