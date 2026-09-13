// Wave 8 验收补充 2：在真实 waiting run（受控-主会话 / run-2d8d）上提交回答，
// 并执行一次真实 recovery 动作（reconcile：核对外部状态），验证回执与 Core 状态变化。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => { if (m.type() === 'error') (out.consoleErrors ??= []).push(m.text().slice(0, 200)); });

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

// 打开第 3 个 Glyth（受控-主会话）
await page.evaluate(() => {
  const el = document.querySelectorAll('[data-lcos-glyth-body]')[2];
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
});
await page.waitForSelector('[data-lcos-waiting-input]', { timeout: 15000 });
await page.waitForTimeout(3000);

// 1) 选择选项 A + 提交回答
await page.evaluate(() => {
  const opt = document.querySelector('[data-lcos-waiting-option]');
  opt?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
await page.waitForTimeout(500);
out.selectedOption = await page.evaluate(() => {
  const el = document.querySelector('[data-lcos-waiting-option]');
  return (el?.textContent ?? '').trim();
});
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[data-lcos-waiting-input] button')).find((b) => (b.textContent ?? '').includes('提交回答'));
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
await page.waitForTimeout(4500);
out.answerReceipt = await page.evaluate(() => {
  const root = document.querySelector('[data-lcos-waiting-input]');
  return (root?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 240);
});
await page.screenshot({ path: `${SHOTS}/wave8_step5_answer_1366.png` });

// 2) 真实 recovery 动作：核对外部状态（op-2, outcome_unknown）
await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('[data-lcos-recovery-action]')).find((b) => (b.textContent ?? '').includes('核对外部状态'));
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
await page.waitForTimeout(5000);
out.recoveryReceipt = await page.evaluate(() => {
  const root = document.querySelector('[data-lcos-recovery-section]');
  return (root?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300);
});
await page.screenshot({ path: `${SHOTS}/wave8_step6_recovery_1366.png` });

await browser.close();
console.log(JSON.stringify(out, null, 2));