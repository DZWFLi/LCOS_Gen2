// Wave 1 收尾：reload 身份保持 + back/forward 检查。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const out = {};
const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

await page.goto('http://localhost:5173/projects/lcos-gen2-dev/main', { waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('[data-lcos-project-shell]', { timeout: 20000 });
await page.waitForTimeout(4000);
out.beforeReload = await page.evaluate(() => JSON.stringify({
  url: location.pathname,
  capsule: document.querySelector('[data-lcos-project-shell] a[href="/projects"]')?.textContent?.replace(/\s+/g, ' ').trim(),
  dockActive: document.querySelector('[data-lcos-surface][data-lcos-surface-active="true"]')?.textContent?.trim(),
}));

// reload
await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
await page.waitForSelector('[data-lcos-project-shell]', { timeout: 20000 });
await page.waitForTimeout(4000);
out.afterReload = await page.evaluate(() => JSON.stringify({
  url: location.pathname,
  capsule: document.querySelector('[data-lcos-project-shell] a[href="/projects"]')?.textContent?.replace(/\s+/g, ' ').trim(),
  dockActive: document.querySelector('[data-lcos-surface][data-lcos-surface-active="true"]')?.textContent?.trim(),
  canvasAlive: !!document.querySelector('.react-flow'),
}));
await page.screenshot({ path: `${SHOTS}/wave1_step6_reload_1366.png` });

// switch to context surface via dock click, then back via browser back
const contextBtn = page.locator('[data-lcos-surface="context"]');
if (await contextBtn.count() > 0) {
  await contextBtn.click({ timeout: 8000 }).catch(() => (out.dockClick = 'failed'));
  await page.waitForTimeout(4000);
  out.afterContext = await page.evaluate(() => JSON.stringify({
    url: location.pathname,
    dockActive: document.querySelector('[data-lcos-surface][data-lcos-surface-active="true"]')?.textContent?.trim(),
  }));
  await page.screenshot({ path: `${SHOTS}/wave1_step7_context_1366.png` });
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(3500);
  out.afterBack = await page.evaluate(() => JSON.stringify({
    url: location.pathname,
    dockActive: document.querySelector('[data-lcos-surface][data-lcos-surface-active="true"]')?.textContent?.trim(),
  }));
}

await browser.close();
console.log(JSON.stringify(out, null, 2));