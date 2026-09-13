// Wave 10 验收：整机 Golden Path + 失败路径 + 重启恢复（真实 Core 数据，headless Chromium）。
// 主路径：打开 Project → 恢复 Main → Assembly 接收材料/投放 Main/阅读 → Context+Atlas+Rail
//   → Workflow 手牌取用 → Composer 提交真实 Run → Glyth Work View（Run/waiting/复核/续工）
//   → 回答 waiting → 回 Main → 重启恢复。
// 失败路径：Core 断开（网络级）→ 诚实离线态 + 重试；waiting 回答真实 409 → 输入保留；复核 capability 真实禁用原因。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const BASE = 'http://localhost:5173';
const PROJECT = 'lcos-gen2-dev';
const out = { steps: {}, failures: {}, restart: {}, consoleErrors: [] };

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
page.on('console', (m) => {
  if (m.type() === 'error') out.consoleErrors.push(m.text().slice(0, 200));
});

const txt = (sel) =>
  page.evaluate((s) => document.querySelector(s)?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 220) ?? null, sel);
const count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const has = (sel) => page.evaluate((s) => !!document.querySelector(s), sel);

async function recoverIfNeeded() {
  const recover = page.getByRole('button', { name: '重新建立现场画布（回写 workspace）' });
  if ((await recover.count()) > 0) {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('重新建立现场画布'),
      );
      btn?.click();
    });
    await page.waitForTimeout(6000);
    return true;
  }
  return false;
}

async function waitCanvas() {
  await page.waitForSelector('.react-flow', { timeout: 30000 });
  await page.waitForTimeout(6000);
}

async function switchSurface(key) {
  await page.evaluate((k) => {
    const btn = document.querySelector(`[data-lcos-surface="${k}"]`);
    btn?.click();
  }, key);
  await page.waitForTimeout(1500);
  const recovered = await recoverIfNeeded();
  await page.waitForTimeout(800);
  return recovered;
}

// ---------- 1) 打开 Project → 恢复 Main ----------
await page.goto(`${BASE}/projects/${PROJECT}/main`, { waitUntil: 'domcontentloaded', timeout: 20000 });
const recoveredMain = await recoverIfNeeded();
await waitCanvas();
out.steps.openProject = {
  mainWorksite: await has('[data-lcos-main-worksite]'),
  canvas: await has('.react-flow'),
  recoveredCanvas: recoveredMain,
  speciesBodies: await count('[data-lcos-species-body]'),
  edges: await count('.react-flow__edge'),
  speciesList: await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-lcos-species-body]'))
      .map((el) => el.getAttribute('data-lcos-species') ?? 'glyth')
      .slice(0, 8),
  ),
};
await page.screenshot({ path: `${SHOTS}/wave10_01_main.png` });

// ---------- 2) Assembly：接收材料 / 阅读 / 投放 Main ----------
await switchSurface('assembly');
out.steps.assembly = {
  open: await has('[data-lcos-assembly]'),
  items: await count('[data-lcos-assembly-kind]'),
  firstKind: await txt('[data-lcos-assembly-kind]'),
  hasDrop: await has('[data-lcos-assembly-drop]'),
  hasAdd: await has('[data-lcos-assembly-add]'),
};
await page.screenshot({ path: `${SHOTS}/wave10_02_assembly.png` });

// 阅读第一项真材料（artifact 类；scene/conversation 不是 Artifact，会如实读取失败）
out.steps.artifactItemCount = await count('[data-lcos-assembly-item-kind="artifact"]');
await page.evaluate(() => {
  const card = document.querySelector('[data-lcos-assembly-item-kind="artifact"]');
  card?.querySelector('button[title="阅读"]')?.click();
});
await page.waitForTimeout(2500);
out.steps.reader = {
  open: await has('[data-lcos-reader]'),
  title: await txt('[data-lcos-reader] h3'),
  meta: await txt('[data-lcos-reader] p'),
};
await page.screenshot({ path: `${SHOTS}/wave10_03_reader.png` });

// 投放 Main（真实 apply 回执，可能 partial/failed —— 如实记录）
// 注意：上一步「阅读」把专业窗口切到了 reader tab，Assembly body 已卸载 → 先切回 assembly tab。
await page.evaluate(() => document.querySelector('[data-lcos-window-tab="assembly"]')?.click());
await page.waitForTimeout(1500);
out.steps.assemblyTabRestored = await has('[data-lcos-assembly]');
await page.evaluate(() => {
  const card = document.querySelector('[data-lcos-assembly-item-kind="artifact"]');
  card?.querySelector('[data-lcos-assembly-drop]')?.click();
});
await page.waitForTimeout(4000);
out.steps.applyReceipt = {
  present: await has('[data-lcos-assembly-receipt]'),
  text: await txt('[data-lcos-assembly-receipt]'),
};
await page.screenshot({ path: `${SHOTS}/wave10_04_apply_receipt.png` });

// 把一项真 Artifact 加入 Composer 草稿（Assembly → 草稿；供后面真实 Run 提交做合法 contextArtifactId）
await page.evaluate(() => {
  const card = document.querySelector('[data-lcos-assembly-item-kind="artifact"]');
  card?.querySelector('[data-lcos-assembly-add]')?.click();
});
await page.waitForTimeout(800);
out.steps.assemblyToComposer = { composerRefs: await count('[data-lcos-composer-ref]') };

// 关闭专业窗口（Esc 栈）
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);

// ---------- 3) Context + Atlas + Temporal Rail ----------
const recoveredContext = await switchSurface('context');
out.steps.context = {
  worksite: await has('[data-lcos-context-worksite]'),
  canvas: await has('.react-flow'),
  rail: await has('[data-lcos-temporal-rail]'),
  recoveredCanvas: recoveredContext,
};
await page.evaluate(() => document.querySelector('[data-lcos-context-instrument="atlas"]')?.click());
await page.waitForTimeout(3000);
out.steps.atlas = {
  open: await has('[data-lcos-context-atlas]'),
  cards: await count('[data-lcos-atlas-card]'),
  kinds: await page.evaluate(() =>
    Array.from(new Set(Array.from(document.querySelectorAll('[data-lcos-atlas-card]')).map((el) => el.getAttribute('data-lcos-atlas-card')))),
  ),
};
await page.screenshot({ path: `${SHOTS}/wave10_05_context_atlas.png` });
// 点第一张卡进入（scene → 真实 worksite 切换；其它 → 关 Atlas 保持现场）
await page.evaluate(() => document.querySelector('[data-lcos-atlas-card]')?.click());
await page.waitForTimeout(2500);
out.steps.atlasEnter = {
  atlasClosed: (await has('[data-lcos-context-atlas]')) === false,
  contextStillThere: await has('[data-lcos-context-worksite]'),
};

// ---------- 4) Workflow 手牌 / 卡池 / 取用 → Composer ----------
const recoveredWorkflow = await switchSurface('workflow');
out.steps.workflow = {
  worksite: await has('[data-lcos-workflow-worksite]'),
  handToggle: await has('[data-lcos-workflow-hand-toggle]'),
  recoveredCanvas: recoveredWorkflow,
};
await page.evaluate(() => document.querySelector('[data-lcos-workflow-hand-toggle]')?.click());
await page.waitForTimeout(3000);
out.steps.hand = {
  open: await has('[data-lcos-workflow-hand]'),
  cards: await count('[data-lcos-workflow-card]'),
  takeButtons: await count('[data-lcos-card-take]'),
};
await page.screenshot({ path: `${SHOTS}/wave10_06_workflow_hand.png` });
await page.evaluate(() => document.querySelector('[data-lcos-card-take]')?.click());
await page.waitForTimeout(1500);
out.steps.takeToComposer = {
  composerRefs: await count('[data-lcos-composer-ref]'),
  composerPresent: await has('[data-lcos-composer]'),
};

// ---------- 5) Composer 提交真实 Run ----------
const instruction = `Wave10 Golden Path 校验 · ${new Date().toISOString().slice(0, 19)}`;
const composerInput = page.locator('[data-lcos-composer-input]');
// 逐字输入（真实 key 事件）——`fill()` 走原生 setter，React 受控组件不会更新 state，
// 提交按钮会一直是 disabled，看起来像"快捷键没反应"。
await composerInput.pressSequentially(instruction, { delay: 8 });
await page.waitForTimeout(300);
out.steps.composerFilled = await composerInput.inputValue();
out.steps.composerSubmitDisabled = await page.evaluate(
  () => document.querySelector('[data-lcos-composer] button[aria-label="提交"]')?.hasAttribute('disabled') ?? null,
);
await composerInput.press('Control+Enter');
await page.waitForTimeout(6000);
out.steps.composerSubmit = {
  text: await page.evaluate(() => {
    const el = document.querySelector('[data-lcos-composer]');
    const raw = el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return raw.slice(-200);
  }),
  created: await page.evaluate(() =>
    (document.querySelector('[data-lcos-composer]')?.textContent ?? '').includes('Run 已创建'),
  ),
  inputCleared: (await composerInput.inputValue()) === '',
  blocked: await has('[data-lcos-composer-blocked]'),
};
await page.screenshot({ path: `${SHOTS}/wave10_07_composer_run.png` });

// 关闭手牌 → 回 Main
await page.evaluate(() => document.querySelector('[data-lcos-workflow-hand] button[aria-label="关闭手牌"]')?.click());
await page.waitForTimeout(800);
await switchSurface('main');
await waitCanvas();
out.steps.backToMain = {
  mainWorksite: await has('[data-lcos-main-worksite]'),
  speciesBodies: await count('[data-lcos-species-body]'),
};

// ---------- 6) Glyth Work View：Run / waiting / 复核 / 续工 ----------
// 5 个会话只有部分带 Run（Wave 8 实测），逐个打开直到命中带 Run 的会话（最多 5 个）。
const openGlyth = async (index) =>
  page.evaluate((i) => {
    const els = Array.from(document.querySelectorAll('[data-lcos-glyth-body]'));
    const el = els[i];
    if (!el) return false;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        clientX: r.x + r.width / 2,
        clientY: r.y + r.height / 2,
      }),
    );
    return true;
  }, index);

const closeWindow = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
};

await openGlyth(0);
await page.waitForSelector('[data-lcos-conversation-work-view]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(4000);

let best = null;
const probes = [];
for (let i = 0; i < 5; i += 1) {
  if (i > 0) {
    await closeWindow();
    await openGlyth(i);
    await page.waitForSelector('[data-lcos-conversation-work-view]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(4000);
  }
  const probe = await page.evaluate(() => {
    const root = document.querySelector('[data-lcos-conversation-work-view]');
    return {
      open: !!root,
      runStatuses: Array.from(root?.querySelectorAll('span') ?? [])
        .map((el) => el.textContent ?? '')
        .filter((t) => ['created', 'queued', 'running', 'waiting_input', 'review', 'completed', 'failed', 'cancelled'].includes(t)),
      waiting: !!document.querySelector('[data-lcos-waiting-input]'),
      reviewSection: !!document.querySelector('[data-lcos-artifact-return]'),
      capabilityTexts: Array.from(document.querySelectorAll('[data-lcos-review-capability]')).map((el) => el.textContent),
      returns: document.querySelectorAll('[data-lcos-return]').length,
      recovery: !!document.querySelector('[data-lcos-recovery-section]'),
      recoveryText: document.querySelector('[data-lcos-recovery-section]')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 160) ?? null,
      title: document.querySelector('[data-lcos-window-tab="conversation"]')?.textContent ?? null,
    };
  });
  probes.push(probe);
  if (probe.reviewSection) {
    await page.screenshot({ path: `${SHOTS}/wave10_08b_work_view_review.png` });
  }
  const score = (p) =>
    (p.waiting ? 100 : 0) + p.returns * 10 + (p.reviewSection ? 5 : 0) + (p.recovery ? 2 : 0) + p.runStatuses.length;
  if (best === null || score(probe) > score(best)) best = probe;
}
out.steps.workViewProbes = probes;
out.steps.workView = best ?? { open: false };
await page.screenshot({ path: `${SHOTS}/wave10_08_work_view.png` });

// waiting 回答（真实通道；本 dev 库的 pending request 已被前一次尝试消费 →
// Core 返回 404「This task is not waiting for more information」，UI 必须如实显示）
if (out.steps.workView.waiting) {
  const waitingArea = page.locator('[data-lcos-waiting-input] textarea');
  if ((await waitingArea.count()) === 0) {
    out.failures.waitingAnswer = {
      staleWaitingRun: true,
      text: await txt('[data-lcos-waiting-input]'),
    };
    await page.screenshot({ path: `${SHOTS}/wave10_09_waiting_answer.png` });
  } else {
  await waitingArea.pressSequentially('Wave10 回答：按方案 A', { delay: 8 });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('[data-lcos-waiting-input] button')).find((b) =>
      (b.textContent ?? '').includes('提交回答'),
    );
    btn?.click();
  });
  await page.waitForTimeout(5000);
  out.failures.waitingAnswer = {
    text: await txt('[data-lcos-waiting-input]'),
    inputRetained: await page.evaluate(() => {
      const ta = document.querySelector('[data-lcos-waiting-input] textarea');
      return ta ? ta.value : null;
    }),
  };
  await page.screenshot({ path: `${SHOTS}/wave10_09_waiting_answer.png` });
  }
}

// ---------- 7) 重启恢复（reload 后回到同一现场与画布） ----------
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);
await page.reload({ waitUntil: 'domcontentloaded' });
const recoveredAfterReload = await recoverIfNeeded();
await waitCanvas();
out.restart = {
  url: page.url(),
  mainWorksite: await has('[data-lcos-main-worksite]'),
  canvas: await has('.react-flow'),
  speciesBodies: await count('[data-lcos-species-body]'),
  recoveredCanvas: recoveredAfterReload,
  projectPill: await txt('a[title="返回项目列表"]'),
};
await page.screenshot({ path: `${SHOTS}/wave10_10_after_reload.png` });

// ---------- 8) 失败路径：Core 断开（网络级） ----------
const offlinePage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await offlinePage.route('**/lcos-core/**', (route) => route.abort());
await offlinePage.goto(`${BASE}/projects/${PROJECT}/main`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await offlinePage.waitForTimeout(6000);
out.failures.coreOffline = {
  offlineText: (await offlinePage.evaluate(() => document.body.textContent ?? '')).includes('Local Core 未连接'),
  retryButton: await offlinePage.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').trim() === '重试'),
  ),
};
await offlinePage.screenshot({ path: `${SHOTS}/wave10_11_core_offline.png` });
await offlinePage.close();

// ---------- 9) 失败路径：不存在的画布（stale canvasId → 真实 404 恢复入口） ----------
const stalePage = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await stalePage.goto(`${BASE}/projects/${PROJECT}/main`, { waitUntil: 'domcontentloaded', timeout: 20000 });
await stalePage.waitForTimeout(8000);
out.failures.staleCanvasEntry = {
  recoverButtonPresent: await stalePage.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some((b) => (b.textContent ?? '').includes('重新建立现场画布')),
  ),
  canvas: await stalePage.evaluate(() => !!document.querySelector('.react-flow')),
};
await stalePage.close();

await browser.close();
out.consoleErrors = out.consoleErrors.slice(0, 12);

// 紧凑摘要
for (const [k, v] of Object.entries(out.steps)) console.log(`[step] ${k} ${JSON.stringify(v)}`);
for (const [k, v] of Object.entries(out.failures)) console.log(`[fail] ${k} ${JSON.stringify(v)}`);
console.log(`[restart] ${JSON.stringify(out.restart)}`);
console.log(`[console] errors=${out.consoleErrors.length} ${JSON.stringify(out.consoleErrors.slice(0, 4))}`);
console.log(JSON.stringify(out, null, 2));
