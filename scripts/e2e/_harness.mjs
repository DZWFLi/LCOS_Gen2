// R0 fail-fast e2e harness（2026-09-14）。
//
// 目的：让"脚本跑到末尾"不再等于"通过"。关键 selector 缺失、关键值为 false、
// console/pageerror 出现、HTTP 非白名单状态、关键实体为空 → 一律非零退出。
//
// 用法（各 Recovery Wave 的 e2e 脚本）：
//   import { runScenario } from './_harness.mjs';
//   await runScenario({ name: 'R2-main', body: async (h) => {
//     await h.goto('/projects/<pid>/main');
//     await h.requireSelector('.react-flow');
//     h.requireTrue(await h.count('[data-lcos-species-body]') > 0, 'Main 上应出现 LCOS 物种 body');
//   }});
//
// 不引入断言库、不引入测试框架：一个场景一个进程，退出码即结论。

import { chromium } from 'playwright-core';

const DEFAULT_EXE =
  'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const DEFAULT_BASE = 'http://localhost:5173';

function fail(message) {
  throw new Error(message);
}

/**
 * 运行一个场景。任何断言失败 / console 错误 / pageerror / 非白名单 HTTP →
 * 打印结构化失败摘要并把 process.exitCode 置 1。
 */
export async function runScenario({
  name,
  baseUrl = DEFAULT_BASE,
  viewport = { width: 1440, height: 900 },
  headless = true,
  // 允许出现的 HTTP 状态（默认只允许 <400）；例如 expect 404 的场景写 [404]
  allowHttp = [],
  // 允许出现的 console error 文本模式（仅用于"失败是场景本身要验证的条件"，
  // 例如 stale canvas 场景的 404 日志）。摘要里仍然完整打印全部 console error。
  allowConsoleErrorsMatching = [],
  body,
}) {
  const failures = [];
  const consoleErrors = [];
  const pageErrors = [];
  const httpRecords = [];
  const allowed = new Set(allowHttp);

  const browser = await chromium.launch({
    executablePath: process.env.LCOS_CHROME ?? DEFAULT_EXE,
    headless,
  });
  const page = await browser.newPage({ viewport });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('response', (r) => {
    const status = r.status();
    if (status >= 400) {
      httpRecords.push({ status, url: r.url().slice(0, 200), allowed: allowed.has(status) });
    }
  });

  const h = {
    page,
    goto: (path) => page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 }),
    count: (selector) => page.locator(selector).count(),
    text: (selector) =>
      page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim() ?? null, selector),
    has: (selector) => page.evaluate((s) => !!document.querySelector(s), selector),
    evaluate: (fn, arg) => page.evaluate(fn, arg),
    wait: (ms) => page.waitForTimeout(ms),
    screenshot: (file) => page.screenshot({ path: file }),

    /** 目标超时即抛错（不允许 catch 后继续）。 */
    async requireSelector(selector, { timeout = 20000, message } = {}) {
      try {
        await page.waitForSelector(selector, { timeout });
      } catch {
        fail(message ?? `requireSelector 失败：未出现 ${selector}（${timeout}ms）`);
      }
    },

    requireTrue(condition, message) {
      if (condition !== true) fail(message ?? 'requireTrue 失败（false）');
    },

    requireEqual(actual, expected, message) {
      if (actual !== expected) {
        fail(`${message ?? 'requireEqual 失败'}：actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
      }
    },

    requireNonEmpty(value, message) {
      const size =
        typeof value === 'string'
          ? value.trim().length
          : typeof value === 'number'
            ? value
            : (value?.length ?? 0);
      if (!size) fail(`${message ?? 'requireNonEmpty 失败'}：${JSON.stringify(value)} 为空`);
      return value;
    },
  };

  let ok = false;
  try {
    await body(h);
    const unexpectedConsole = consoleErrors.filter(
      (text) => !allowConsoleErrorsMatching.some((pattern) => pattern.test(text)),
    );
    const unexpectedHttp = httpRecords.filter((r) => !r.allowed);
    h.requireTrue(unexpectedConsole.length === 0, `出现 console error：${unexpectedConsole.join(' | ')}`);
    h.requireTrue(pageErrors.length === 0, `出现 pageerror：${pageErrors.join(' | ')}`);
    h.requireTrue(
      unexpectedHttp.length === 0,
      `出现非白名单 HTTP：${unexpectedHttp.map((r) => `${r.status} ${r.url}`).join(' | ')}`,
    );
    ok = failures.length === 0;
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close().catch(() => undefined);
  }

  const summary = {
    scenario: name,
    ok,
    failures,
    consoleErrors,
    pageErrors,
    http: httpRecords,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!ok) {
    console.error(`FAIL ${name}`);
    process.exitCode = 1;
  }
  return summary;
}
