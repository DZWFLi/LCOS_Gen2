// Wave 2 机械回归验收（fail-fast；LCOS chromeMode 下 Huabu kernel 保留）。
//
// 依据：正本 `04_逐Wave施工卡与验收.md` Wave 2「机械回归」与「退出条件：LCOS Shell 下只有
// 一份 Canvas、一份 selection、一份 camera、一份 history；换壳后手感不倒退」。
//
// 断言必须贴合**本仓真实的输入语法**（`Canvas.tsx` 冻结的 Gen1 pointer grammar），不能按常识猜：
//   - 多选修饰键 = **Shift**（`multiSelectionKeyCode={'Shift'}`，Ctrl 专属 LCOS reference pick）
//   - 空区**左键拖框 = box-select**（`selectionOnDrag` 在 mouse+select 下为真）
//   - **中键拖 = pan**（`panOnDrag` 在 mouse+select 下是 `[1]`）
//   - **滚轮 = pan**（`panOnScroll` 为真），**缩放走 LCOS camera 浮岛**（`[data-lcos-camera-controls]`）
//   - undo = Ctrl+Z，redo = **Ctrl+Shift+Z**（`config/shortcuts.ts` 的 `edit.redo`）
//   - `.react-flow__attribution` 是 React Flow 归属角标（许可证义务，必须保留），不算"旧 Huabu chrome"
//
// 前置（必须与本次运行在同一条命令链里）：
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 reset
//   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/e2e/r0-e2e-env.ps1 up
// 运行：
//   node scripts/e2e/wave2-kernel.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.LCOS_E2E_BASE ?? 'http://localhost:5273';
const CORE = process.env.LCOS_E2E_CORE ?? 'http://127.0.0.1:43131';
const CORE_TOKEN = process.env.LCOS_E2E_CORE_TOKEN ?? 'dev-token';
const SHOTS = process.env.LCOS_E2E_SHOTS ?? 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE =
  process.env.LCOS_E2E_CHROMIUM ??
  'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const PROJECT_ID = process.env.LCOS_E2E_PROJECT ?? 'lcos-gen2-dev';

const failures = [];
const evidence = {};
const check = (ok, message) => {
  if (ok !== true) failures.push(message);
};

async function coreGet(path) {
  const res = await fetch(`${CORE}${path}`, { headers: { Authorization: `Bearer ${CORE_TOKEN}` } });
  if (!res.ok) throw new Error(`Core GET ${path} -> ${res.status}`);
  const body = await res.json();
  return body.value ?? body;
}

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 240));
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e.message).slice(0, 240)}`));
const failedResponses = [];
page.on('response', (r) => {
  if (r.status() >= 400) failedResponses.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 160)}`);
});

const snap = (name) => page.screenshot({ path: `${SHOTS}/${name}` });
const viewportTransform = () =>
  page.evaluate(() => {
    const el = document.querySelector('.react-flow__viewport');
    return el ? (el.getAttribute('style') ?? '') : '';
  });
/** 找一个确实落在 canvas pane 上空点（避开 LCOS 浮层：胶囊 / camera 岛 / Dock / Hand）。 */
const findEmptyPanePoint = () =>
  page.evaluate(() => {
    for (let y = 110; y < 660; y += 30) {
      for (let x = 130; x < 1240; x += 30) {
        const el = document.elementFromPoint(x, y);
        if (el && el.classList && el.classList.contains('react-flow__pane')) return { x, y };
      }
    }
    return null;
  });

/**
 * 读画布「已在别处被修改」冲突 toast（`common.json::contentConflict`）。
 * 它出现 = 服务端 canvas version CAS 失败（409 CANVAS_VERSION_MISMATCH），
 * 也就是**同一张画布存在第二个写 owner**；这是 Wave 2「一份 geometry/history owner」的反证。
 */
const readConflictToast = () =>
  page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('div.z-9999')).find((d) =>
      /已在别处被修改/.test(d.textContent ?? ''),
    );
    if (!el) return null;
    return {
      text: (el.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200),
      buttons: Array.from(el.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()),
    };
  });

/** 收起冲突 toast（否则它 fixed z-9999 会一直拦截后续 pointer）。 */
const dismissConflictToast = async () => {
  const el = page.locator('div.z-9999').first();
  if ((await el.count()) === 0) return;
  const keepMine = el.getByRole('button', { name: /保留/ }).first();
  const loadLatest = el.getByRole('button', { name: /加载最新/ }).first();
  if ((await keepMine.count()) > 0) await keepMine.click({ timeout: 5000 }).catch(() => undefined);
  else if ((await loadLatest.count()) > 0) await loadLatest.click({ timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
};

try {
  const projects = await coreGet('/projects');
  const projectId = projects.find((p) => p.id === PROJECT_ID)?.id ?? projects[0]?.id;
  check(!!projectId, 'Core 里没有可用项目');

  await page.goto(`${BASE}/projects/${projectId}/main`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await page.waitForSelector('[data-lcos-project-shell]', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(6000);

  if ((await page.locator('.react-flow').count()) === 0) {
    const recoverBtn = page.locator('[data-lcos-recover-canvas]').first();
    const emptyBtn = page.locator('[data-lcos-worksite-stage-empty] button').first();
    if ((await recoverBtn.count()) > 0) await recoverBtn.click({ timeout: 10000 }).catch(() => undefined);
    else if ((await emptyBtn.count()) > 0) await emptyBtn.click({ timeout: 10000 }).catch(() => undefined);
    else failures.push('现场没有画布，且找不到诚实建立/恢复入口');
    await page.waitForSelector('.react-flow', { timeout: 30000 }).catch(() => undefined);
    await page.waitForTimeout(8000);
  }

  // ── 1) 只有一份 Canvas；LCOS mode 隐藏旧 Huabu chrome ─────────────────────
  evidence.chrome = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.react-flow__panel'));
    const nonAttribution = panels.filter((el) => !el.classList.contains('react-flow__attribution'));
    return {
      reactFlowCount: document.querySelectorAll('.react-flow').length,
      controls: document.querySelectorAll('.react-flow__controls').length,
      miniMap: document.querySelectorAll('.react-flow__minimap').length,
      panelCount: panels.length,
      attributionPanelCount: panels.length - nonAttribution.length,
      strayPanelHtml: nonAttribution.map((el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 160)),
      cameraControls: !!document.querySelector('[data-lcos-camera-controls]'),
    };
  });
  check(evidence.chrome.reactFlowCount === 1, `ReactFlow 不是唯一一份：${evidence.chrome.reactFlowCount}`);
  check(evidence.chrome.controls === 0, `LCOS mode 仍挂 Controls ×${evidence.chrome.controls}`);
  check(evidence.chrome.miniMap === 0, `LCOS mode 仍挂 MiniMap ×${evidence.chrome.miniMap}`);
  check(
    evidence.chrome.strayPanelHtml.length === 0,
    `LCOS mode 仍挂旧 Canvas 浮动工具条（非归属用 Panel）：${evidence.chrome.strayPanelHtml.join(' | ')}`,
  );
  check(evidence.chrome.cameraControls, 'LCOS camera 浮岛缺失（LCOS mode 应改用自有 camera affordance）');
  await snap('wave2_step1_chrome_1366.png');

  // ── 2) 真实节点（Core 夹具经 projection/reconcile 投影而来） ──────────────
  await page.waitForSelector('.react-flow__node', { timeout: 30000 }).catch(() => undefined);
  const nodeCount = await page.locator('.react-flow__node').count();
  evidence.nodeCount = nodeCount;
  const hasNodes = nodeCount > 0;
  check(hasNodes, `画布上没有投影出任何真实节点（nodeCount=${nodeCount}）`);
  if (!hasNodes) {
    evidence.noNodeDiagnostics = await page.evaluate(() => ({
      bodyText: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400),
      empty: !!document.querySelector('[data-lcos-worksite-stage-empty]'),
      loadError: (document.querySelector('[data-lcos-worksite-load-error]')?.textContent ?? '').slice(0, 200),
    }));
  }

  const firstNode = page.locator('.react-flow__node').first();

  // ── 3) click → select ────────────────────────────────────────────────────
  const firstBox = hasNodes ? await firstNode.boundingBox() : null;
  if (firstBox) {
    await page.mouse.click(firstBox.x + firstBox.width / 2, firstBox.y + firstBox.height / 2);
    await page.waitForTimeout(700);
  }
  evidence.clickSelected = hasNodes
    ? await firstNode.getAttribute('class').then((c) => (c ?? '').includes('selected')).catch(() => false)
    : false;
  check(evidence.clickSelected === true, 'click 未能选中节点');

  // ── 4) Shift+click 多选（本仓唯一的多选修饰键） ───────────────────────────
  if (nodeCount >= 2) {
    const secondBox = await page.locator('.react-flow__node').nth(1).boundingBox();
    if (secondBox) {
      await page.keyboard.down('Shift');
      await page.mouse.click(secondBox.x + secondBox.width / 2, secondBox.y + secondBox.height / 2);
      await page.keyboard.up('Shift');
      await page.waitForTimeout(800);
    }
  }
  evidence.shiftClickSelectedCount = await page.locator('.react-flow__node.selected').count();
  check(
    evidence.shiftClickSelectedCount >= 2,
    `Shift+click 多选未选中两个节点（${evidence.shiftClickSelectedCount}）`,
  );
  await snap('wave2_step2_select_1366.png');

  // ── 5) 空区左键拖框 = box-select（`selectionOnDrag`） ─────────────────────
  const emptyForBox = await findEmptyPanePoint();
  if (emptyForBox) {
    await page.mouse.move(emptyForBox.x, emptyForBox.y);
    await page.mouse.down();
    await page.mouse.move(emptyForBox.x + 420, emptyForBox.y + 300, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(900);
  }
  evidence.boxSelectPoint = emptyForBox;
  evidence.boxSelectSelectedCount = await page.locator('.react-flow__node.selected').count();
  check(!!emptyForBox, '找不到空 pane 落点，无法验证 box-select');
  check(evidence.boxSelectSelectedCount > 0, `空区拖框未选中任何节点（${evidence.boxSelectSelectedCount}）`);

  // ── 6) drag → geometry 变化；Ctrl+Z / Ctrl+Shift+Z 撤销重做 ───────────────
  // 用 `data-id` 锁定同一个节点读 transform：React Flow 会按选中/层级重排 DOM 顺序，
  // 用 `.first()` 读会在拖拽后读到另一个节点（v2 已证明 kernel 拖拽本身是好的）。
  // 先清空选区：有选中时 `SelectionOutlines` / `MultiSelectToolbar` / `StrokeSelectionToolbar`
  // 会浮在节点之上，拖拽的 mousedown 会被这些浮层吃掉（v5 实测：click 能选中、但拖不动）。
  // 用「点空 pane」而不是 Escape —— 这正是 Huabu 的 `onEmptyCanvasTap → selectNodes([])`。
  const emptyForDeselect = await findEmptyPanePoint();
  if (emptyForDeselect) {
    await page.mouse.click(emptyForDeselect.x, emptyForDeselect.y);
    await page.waitForTimeout(700);
  }
  evidence.selectedAfterDeselect = await page.locator('.react-flow__node.selected').count();
  check(
    evidence.selectedAfterDeselect === 0,
    `清空选区失败，仍选中 ${evidence.selectedAfterDeselect} 个（会让拖拽被浮层吃掉）`,
  );
  evidence.nodeIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.react-flow__node')).map((el) => el.getAttribute('data-id')),
  );
  const dragNodeId = hasNodes ? await firstNode.getAttribute('data-id') : null;
  const dragNodeBox = hasNodes ? await firstNode.boundingBox() : null;
  evidence.dragNode = { id: dragNodeId, box: dragNodeBox };
  check(!!dragNodeId, 'ReactFlow 节点上没有 data-id，无法稳定锁定拖拽目标');
  const readDraggedTransform = async () =>
    dragNodeId
      ? ((await page.locator(`.react-flow__node[data-id="${dragNodeId}"]`).getAttribute('style')) ?? '')
      : '';
  const transformBefore = await readDraggedTransform();
  if (dragNodeBox) {
    const cx = dragNodeBox.x + dragNodeBox.width / 2;
    const cy = dragNodeBox.y + dragNodeBox.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 140, cy + 70, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(2500); // 让 autosave 落盘，避免把落盘竞态误判成功能缺陷
  }
  const transformAfterDrag = await readDraggedTransform();
  evidence.drag = { before: transformBefore.slice(0, 70), after: transformAfterDrag.slice(0, 70) };
  check(transformBefore !== transformAfterDrag, 'drag 未改变节点 transform');

  // 拖拽后立刻看有没有版本冲突 toast —— 它会把后续 undo/redo 一起带偏，
  // 必须先单独断言，才能把「第二写 owner」和「history 失效」分开归因。
  evidence.conflictToastAfterDrag = await readConflictToast();
  check(
    evidence.conflictToastAfterDrag === null,
    `画布出现版本冲突 toast（409 CANVAS_VERSION_MISMATCH = 第二写 owner）：${evidence.conflictToastAfterDrag ? evidence.conflictToastAfterDrag.text : ''}`,
  );
  if (evidence.conflictToastAfterDrag) await dismissConflictToast();

  await page.keyboard.press('Control+z');
  await page.waitForTimeout(2500);
  const transformAfterUndo = await readDraggedTransform();
  evidence.undo = { after: transformAfterUndo.slice(0, 70) };
  evidence.conflictToastAfterUndo = await readConflictToast();
  check(transformAfterUndo !== transformAfterDrag, 'Ctrl+Z 撤销未生效');
  if (evidence.conflictToastAfterUndo) await dismissConflictToast();

  // 先让 undo 的 autosave 与 SSE 回显结算，再按 redo：拖拽/撤销各自都会触发一次
  // 结构落盘，落盘回显若在 redo 之前落地会重排 history 栈。
  await page.waitForTimeout(6000);
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(3000);
  const transformAfterRedo = await readDraggedTransform();
  evidence.redo = { after: transformAfterRedo.slice(0, 70) };
  check(
    transformAfterRedo === transformAfterDrag,
    `Ctrl+Shift+Z 重做未回到拖后几何（undo=${transformAfterUndo.slice(0, 40)} redo=${transformAfterRedo.slice(0, 40)} want=${transformAfterDrag.slice(0, 40)}）`,
  );
  await snap('wave2_step3_drag_undo_1366.png');

  // ── 7) zoom：LCOS camera 浮岛（唯一 Huabu camera） ───────────────────────
  const zoomLabel = () => page.locator('[data-lcos-camera-controls] span').first().textContent();
  const zoomBefore = await zoomLabel();
  await page.locator('[data-lcos-camera-controls] button[aria-label="放大"]').click({ timeout: 8000 });
  await page.waitForTimeout(900);
  const zoomAfter = await zoomLabel();
  evidence.zoom = { before: zoomBefore, after: zoomAfter };
  check(zoomBefore !== zoomAfter, `LCOS camera 放大未改变缩放（${zoomBefore} -> ${zoomAfter}）`);

  // ── 8) pan：中键拖（本仓 mouse+select 下 panOnDrag=[1]） ──────────────────
  const emptyForPan = await findEmptyPanePoint();
  const panBefore = await viewportTransform();
  if (emptyForPan) {
    await page.mouse.move(emptyForPan.x, emptyForPan.y);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(emptyForPan.x + 160, emptyForPan.y + 120, { steps: 12 });
    await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(900);
  }
  const panAfter = await viewportTransform();
  evidence.pan = { changed: panBefore !== panAfter, before: panBefore.slice(0, 70), after: panAfter.slice(0, 70) };
  check(panBefore !== panAfter, '中键拖 pan 未改变 viewport transform');
  evidence.wheelPan = null;
  await snap('wave2_step4_zoom_pan_1366.png');

  // ── 9) text input focus 优先于 Canvas 快捷键（LCOS Navigator 搜索） ──────
  await dismissConflictToast();
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(900);
  const searchInput = page.locator('[data-lcos-nav-part="input"]').first();
  if ((await searchInput.count()) > 0) {
    await searchInput.click({ timeout: 8000 }).catch(async () => {
      await dismissConflictToast();
      await searchInput.click({ timeout: 8000 }).catch(() => undefined);
    });
    await page.keyboard.type('abc');
    evidence.searchTyped = await searchInput.inputValue();
    check(evidence.searchTyped.includes('abc'), `文本输入未优先于 Canvas 快捷键（输入值=${evidence.searchTyped}）`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  } else {
    evidence.searchTyped = null;
    failures.push('找不到 LCOS 搜索输入框，无法验证 text input focus 优先');
  }

  // ── 10) reload 后几何/viewport 按现有 owner 恢复，chrome 仍隐藏 ──────────
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.react-flow__node', { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(7000);
  evidence.afterReload = await page.evaluate(() => {
    const panels = Array.from(document.querySelectorAll('.react-flow__panel'));
    return {
      nodes: document.querySelectorAll('.react-flow__node').length,
      reactFlowCount: document.querySelectorAll('.react-flow').length,
      controls: document.querySelectorAll('.react-flow__controls').length,
      miniMap: document.querySelectorAll('.react-flow__minimap').length,
      strayPanel: panels.filter((el) => !el.classList.contains('react-flow__attribution')).length,
    };
  });
  check(evidence.afterReload.nodes > 0, 'reload 后节点未恢复');
  check(evidence.afterReload.reactFlowCount === 1, 'reload 后 ReactFlow 不是唯一一份');
  check(
    evidence.afterReload.controls === 0 && evidence.afterReload.miniMap === 0 && evidence.afterReload.strayPanel === 0,
    'reload 后旧 Huabu chrome 又出现',
  );
  await snap('wave2_step5_reload_1366.png');

  check(
    !consoleErrors.some((t) => /Cannot update a component/.test(t)),
    '出现 "Cannot update a component ... while rendering" 违反项',
  );
  evidence.consoleErrors = consoleErrors;
  evidence.failedResponses = failedResponses;
} catch (error) {
  failures.push(`脚本异常：${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close().catch(() => undefined);
}

const ok = failures.length === 0;
console.log(JSON.stringify({ scenario: 'wave2-kernel', ok, failures, evidence }, null, 2));
if (!ok) {
  console.error('FAIL wave2-kernel');
  process.exitCode = 1;
}