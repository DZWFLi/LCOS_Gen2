// Wave 8 验收：Glyth 双击 → Conversation Work View（identity/reach/Run/续工节）。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => { if (m.type() === 'error') (out.consoleErrors ??= []).push(m.text().slice(0, 200)); });

async function ensureMain() {
  await page.goto('http://localhost:5173/projects/lcos-gen2-dev/main', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const recover = page.getByRole('button', { name: '重新建立现场画布（回写 workspace）' });
  if ((await recover.count()) > 0) {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent ?? '').includes('重新建立现场画布'));
      btn?.click();
    });
    await page.waitForTimeout(6000);
  }
  await page.waitForSelector('.react-flow', { timeout: 30000 });
  await page.waitForTimeout(9000);
}

await ensureMain();
out.glythBodies = await page.evaluate(() => document.querySelectorAll('[data-lcos-glyth-body]').length);
await page.screenshot({ path: `${SHOTS}/wave8_step1_glyth_main_1366.png` });

// 双击第一个 Glyth body（原生 dblclick 冒泡 → React onDoubleClick）
const opened = await page.evaluate(() => {
  const el = document.querySelector('[data-lcos-glyth-body]');
  if (!el) return false;
  const target = el.getBoundingClientRect();
  const opts = { bubbles: true, cancelable: true, clientX: target.x + target.width / 2, clientY: target.y + target.height / 2 };
  el.dispatchEvent(new MouseEvent('dblclick', opts));
  return true;
});
out.dblclickDispatched = opened;
await page.waitForSelector('[data-lcos-conversation-work-view]', { timeout: 15000 }).catch(() => (out.wvMissing = true));
await page.waitForTimeout(4000);
out.workView = await page.evaluate(() => {
  const root = document.querySelector('[data-lcos-conversation-work-view]');
  return JSON.stringify({
    open: !!root,
    windowTitle: document.querySelector('[data-lcos-window-tab="conversation"]')?.textContent ?? null,
    hasWaiting: !!document.querySelector('[data-lcos-waiting-input]'),
    hasRecovery: !!document.querySelector('[data-lcos-recovery-section]'),
    text: (root?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 260),
  });
});
await page.screenshot({ path: `${SHOTS}/wave8_step2_workview_1366.png` });

// Esc / 关闭窗口后回到画布
await page.evaluate(() => {
  const btn = document.querySelector('[data-lcos-professional-stage] button[aria-label="关闭窗口"]');
  btn?.click();
});
await page.waitForTimeout(1200);
out.afterClose = await page.evaluate(() => JSON.stringify({
  workViewGone: !document.querySelector('[data-lcos-conversation-work-view]'),
  canvasAlive: !!document.querySelector('.react-flow'),
}));
await page.screenshot({ path: `${SHOTS}/wave8_step3_closed_1366.png` });

await browser.close();
console.log(JSON.stringify(out, null, 2));