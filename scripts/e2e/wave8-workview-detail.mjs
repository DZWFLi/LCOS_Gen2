// Wave 8 验收补充：逐个 Glyth 双击，找到有真实 Run / 续工操作的会话，验证 Waiting/Recovery 节。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = { sessions: [] };
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

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

const count = await page.evaluate(() => document.querySelectorAll('[data-lcos-glyth-body]').length);
out.glythCount = count;

for (let i = 0; i < count; i += 1) {
  const ok = await page.evaluate((idx) => {
    const el = document.querySelectorAll('[data-lcos-glyth-body]')[idx];
    if (!el) return false;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
    return true;
  }, i);
  if (!ok) continue;
  await page.waitForSelector('[data-lcos-conversation-work-view]', { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(3200);
  const info = await page.evaluate(() => {
    const root = document.querySelector('[data-lcos-conversation-work-view]');
    return JSON.stringify({
      title: document.querySelector('[data-lcos-window-tab="conversation"]')?.textContent ?? null,
      runRows: document.querySelectorAll('[data-lcos-conversation-work-view] [data-lcos-waiting-input]').length,
      runStatus: Array.from(document.querySelectorAll('[data-lcos-conversation-work-view] span')).map((s) => (s.textContent ?? '').trim()).filter((t) => /^(waiting_input|running|succeeded|failed|review|queued)$/.test(t)),
      recoveryStages: Array.from(document.querySelectorAll('[data-lcos-recovery-step]')).map((s) => (s.textContent ?? '').trim()),
      recoveryActions: Array.from(document.querySelectorAll('[data-lcos-recovery-action]')).map((b) => b.textContent?.trim()),
      text: (root?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
    });
  });
  out.sessions.push({ index: i, info });
  if (i === 2) await page.screenshot({ path: `${SHOTS}/wave8_step4_session3_1366.png` });
  await page.evaluate(() => {
    const btn = document.querySelector('[data-lcos-professional-stage] button[aria-label="关闭窗口"]');
    btn?.click();
  });
  await page.waitForTimeout(900);
}

await browser.close();
console.log(JSON.stringify(out, null, 2));