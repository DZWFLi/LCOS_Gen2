// Wave 6 验收：Context 现场（Atlas 强表征 + Temporal Rail）。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => { if (m.type() === 'error') (out.consoleErrors ??= []).push(m.text().slice(0, 250)); });

// 直接进入 Context 现场
await page.goto('http://localhost:5173/projects/lcos-gen2-dev/context', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('.react-flow', { timeout: 25000 });
await page.waitForTimeout(9000);
out.context = await page.evaluate(() => JSON.stringify({
  worksite: !!document.querySelector('[data-lcos-context-worksite]'),
  stageSurface: document.querySelector('[data-lcos-worksite-stage]')?.getAttribute('data-lcos-worksite-stage') ?? null,
  temporalRail: !!document.querySelector('[data-lcos-temporal-rail]'),
  atlasButton: !!document.querySelector('[data-lcos-context-instrument="atlas"]'),
  canvasAlive: !!document.querySelector('.react-flow'),
}));
await page.screenshot({ path: `${SHOTS}/wave6_step1_context_1366.png` });

// 打开 Atlas
await page.locator('[data-lcos-context-instrument="atlas"]').click();
await page.waitForSelector('[data-lcos-context-atlas]', { timeout: 15000 });
await page.waitForTimeout(3000);
out.atlas = await page.evaluate(() => JSON.stringify({
  open: !!document.querySelector('[data-lcos-context-atlas]'),
  cards: Array.from(document.querySelectorAll('[data-lcos-atlas-card]')).map((c) => c.getAttribute('data-lcos-atlas-card')),
  cardTexts: Array.from(document.querySelectorAll('[data-lcos-atlas-card] span')).slice(0, 8).map((s) => (s.textContent ?? '').trim()).filter(Boolean),
}));
await page.screenshot({ path: `${SHOTS}/wave6_step2_atlas_1366.png` });

// 切时间组织
await page.locator('[data-lcos-context-atlas] button').filter({ hasText: '时间' }).click();
await page.waitForTimeout(800);
out.atlasTime = await page.evaluate(() => JSON.stringify({
  headings: Array.from(document.querySelectorAll('[data-lcos-context-atlas] h4')).map((h) => (h.textContent ?? '').trim()),
}));
await page.screenshot({ path: `${SHOTS}/wave6_step3_atlas_time_1366.png` });

// 关闭恢复现场
await page.locator('[data-lcos-context-atlas] button[aria-label="关闭 Atlas"]').click();
await page.waitForTimeout(800);
out.atlasClosed = await page.evaluate(() => JSON.stringify({
  atlasGone: !document.querySelector('[data-lcos-context-atlas]'),
  canvasAlive: !!document.querySelector('.react-flow'),
}));
await page.screenshot({ path: `${SHOTS}/wave6_step4_back_1366.png` });

await browser.close();
console.log(JSON.stringify(out, null, 2));