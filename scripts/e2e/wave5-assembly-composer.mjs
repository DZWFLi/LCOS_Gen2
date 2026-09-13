// Wave 5 验收：Assembly（真实 warehouse）→ Reader → Composer 草稿/提交链。
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
await page.screenshot({ path: `${SHOTS}/wave5_step1_shell_1366.png` });

// 打开 Assembly（Dock）
const assemblyBtn = page.locator('[data-lcos-surface="assembly"]');
await assemblyBtn.click();
await page.waitForSelector('[data-lcos-assembly]', { timeout: 15000 });
await page.waitForTimeout(3500); // warehouse load
out.assembly = await page.evaluate(() => JSON.stringify({
  windowOpen: !!document.querySelector('[data-lcos-professional-stage]'),
  itemCount: document.querySelectorAll('[data-lcos-assembly-kind]').length,
  kinds: Array.from(document.querySelectorAll('[data-lcos-assembly-kind]')).map((k) => k.getAttribute('data-lcos-assembly-kind')),
  titles: Array.from(document.querySelectorAll('[data-lcos-assembly] .text-sm.font-medium')).slice(0, 6).map((el) => (el.textContent ?? '').trim()),
}));
await page.screenshot({ path: `${SHOTS}/wave5_step2_assembly_1366.png` });

// 阅读第一个条目
const firstDrop = page.locator('[data-lcos-assembly-drop]').first();
if (await firstDrop.count() > 0) {
  const readerBtn = page.locator('[data-lcos-assembly] button').filter({ hasText: '阅读' }).first();
  await readerBtn.click().catch(() => {});
  await page.waitForTimeout(2000);
  out.reader = await page.evaluate(() => JSON.stringify({
    readerOpen: !!document.querySelector('[data-lcos-reader]'),
    title: document.querySelector('[data-lcos-reader] h3')?.textContent ?? null,
    meta: (document.querySelector('[data-lcos-reader] p')?.textContent ?? '').slice(0, 80),
  }));
  await page.screenshot({ path: `${SHOTS}/wave5_step3_reader_1366.png` });
}

// 加入 Composer 草稿
const addBtn = page.locator('[data-lcos-assembly-add]').first();
if (await addBtn.count() > 0) {
  await addBtn.click();
  await page.waitForTimeout(800);
  out.composerRefs = await page.evaluate(() => JSON.stringify({
    refs: Array.from(document.querySelectorAll('[data-lcos-composer-ref]')).map((r) => (r.textContent ?? '').trim()),
  }));
  await page.screenshot({ path: `${SHOTS}/wave5_step4_draftref_1366.png` });
}

// Composer 提交真实 Run（Cmd/Ctrl+Enter；与按钮等价）
await page.evaluate(() => {
  const t = document.querySelector('[data-lcos-composer] textarea');
  if (t) t.focus();
});
await page.keyboard.type('Wave 5 浏览器验收：分析当前项目材料的组织方式。');
await page.keyboard.press('Control+Enter');
await page.waitForTimeout(4500);
out.submit = await page.evaluate(() => JSON.stringify({
  receipt: (document.querySelector('[data-lcos-composer]')?.textContent ?? '').replace(/\s+/g, ' ').slice(-160),
}));
await page.screenshot({ path: `${SHOTS}/wave5_step5_submit_1366.png` });

await browser.close();
console.log(JSON.stringify(out, null, 2));