// Wave 9 验收：响应式（1440×900 / 1366×768 / 1024×768 / 390×844）+ reduced-motion +
// 键盘焦点 + Esc 栈 + 相机移动暂停复杂动画 + 密度阶梯（屏幕像素单一来源）。
import { chromium } from 'playwright-core';

const SHOTS = 'C:/Users/1/AppData/Local/Temp/trae/screenshots';
const EXE = 'C:/Users/1/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
const URL = 'http://localhost:5173/projects/lcos-gen2-dev/main';
const out = { viewports: {}, reducedMotion: {}, keyboard: {}, escStack: {}, cameraMove: {}, density: {} };

const browser = await chromium.launch({ executablePath: EXE, headless: true });
const consoleErrors = [];

async function boot(page) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
  const recover = page.getByRole('button', { name: '重新建立现场画布（回写 workspace）' });
  if ((await recover.count()) > 0) {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('重新建立现场画布'),
      );
      btn?.click();
    });
    await page.waitForTimeout(6000);
  }
  await page.waitForSelector('.react-flow', { timeout: 30000 });
  await page.waitForTimeout(9000);
}

async function layoutProbe(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const shell = document.querySelector('[data-lcos-project-shell]');
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const overflowing = [];
    for (const sel of [
      '[data-lcos-railway]',
      '[data-lcos-surface-dock]',
      '[data-lcos-navigator-island]',
      '[data-lcos-focus-where]:not([data-open="false"])',
      '[data-lcos-camera-controls]',
      '[data-lcos-canvas-commands]',
      '[data-lcos-composer]',
      '[data-lcos-professional-stage]:not([data-empty])',
    ]) {
      const r = rect(sel);
      if (!r) continue;
      if (r.x < -1 || r.y < -1 || r.x + r.w > vw + 1 || r.y + r.h > vh + 1) overflowing.push({ sel, r });
    }
    return {
      viewport: `${vw}x${vh}`,
      docScrollW: document.documentElement.scrollWidth,
      shellScrollW: shell ? shell.scrollWidth : null,
      horizontalOverflow: (shell ? shell.scrollWidth : document.documentElement.scrollWidth) > vw + 1,
      shell: !!shell,
      canvas: !!document.querySelector('.react-flow'),
      islands: {
        railway: rect('[data-lcos-railway]'),
        dock: rect('[data-lcos-surface-dock]'),
        navigator: rect('[data-lcos-navigator-island]'),
        focusWhere: rect('[data-lcos-focus-where]'),
      },
      overflowingIslands: overflowing,
      speciesBodies: document.querySelectorAll('[data-lcos-species-body]').length,
    };
  });
}

async function densityProbe(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('.react-flow__viewport');
    const m = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : null;
    const zoom = m ? m.a : 1;
    // 旧 host 侧纯 zoom 阶梯（Wave 9 已废弃，仅用于对照证明密度不再由它决定）
    const zoomOnly = zoom < 0.25 ? 'mark' : zoom < 0.55 ? 'summary' : zoom < 0.9 ? 'working' : 'reading';
    const rows = Array.from(document.querySelectorAll('[data-lcos-species-body]')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        species: el.getAttribute('data-lcos-species') ?? (el.hasAttribute('data-lcos-glyth-body') ? 'glyth' : '?'),
        density: el.getAttribute('data-lcos-density'),
        screenW: Math.round(r.width),
        screenH: Math.round(r.height),
      };
    });
    return { zoom: Math.round(zoom * 100) / 100, zoomOnly, count: rows.length, rows };
  });
}

// ---------- 1) 三档视口布局 ----------
for (const [name, size] of [
  ['1440x900', { width: 1440, height: 900 }],
  ['1366x768', { width: 1366, height: 768 }],
  ['1024x768', { width: 1024, height: 768 }],
  ['390x844', { width: 390, height: 844 }],
]) {
  const page = await browser.newPage({ viewport: size });
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${name}: ${m.text().slice(0, 180)}`);
  });
  await boot(page);
  out.viewports[name] = await layoutProbe(page);
  await page.screenshot({ path: `${SHOTS}/wave9_${name}_main.png`, fullPage: false });
  await page.close();
}

// ---------- 2) 密度阶梯 + 相机移动（1366） ----------
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await boot(page);
  const zoomOf = () => page.evaluate(() => {
    const el = document.querySelector('.react-flow__viewport');
    const m = el ? getComputedStyle(el).transform : '';
    return m;
  });
  out.density.atRest = await densityProbe(page);
  out.density.transformAtRest = await zoomOf();

  // 相机移动：滚轮（Huabu 配置为 panOnScroll）→ 相机移动属性应在短窗口内出现
  const box = await page.locator('.react-flow').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  let sawMoving = false;
  for (let i = 0; i < 12; i += 1) {
    const has = await page.evaluate(() =>
      document.querySelector('[data-lcos-project-shell]')?.hasAttribute('data-lcos-camera-moving'),
    );
    if (has) { sawMoving = true; break; }
    await page.waitForTimeout(25);
  }
  out.cameraMove.sawAttrDuringWheel = sawMoving;
  await page.waitForTimeout(1200);
  const stillMoving = await page.evaluate(() =>
    document.querySelector('[data-lcos-project-shell]')?.hasAttribute('data-lcos-camera-moving'),
  );
  out.cameraMove.attrClearedAfterSettle = stillMoving === false;
  out.density.afterPan = await densityProbe(page);

  // 用 LCOS 相机岛真实放大 → 屏幕像素变大 → 密度应升级（同一来源判定）
  for (let i = 0; i < 5; i += 1) {
    await page.getByRole('button', { name: '放大' }).click();
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(1500);
  out.density.afterZoomIn = await densityProbe(page);
  out.density.transformAfterZoomIn = await zoomOf();
  out.density.zoomLabelAfterZoomIn = await page
    .locator('[data-lcos-camera-controls] span')
    .first()
    .textContent();
  await page.screenshot({ path: `${SHOTS}/wave9_density_zoomin_1366.png` });

  // 缩小到最小 → 应回到 mark
  for (let i = 0; i < 9; i += 1) {
    await page.getByRole('button', { name: '缩小' }).click();
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  out.density.afterZoomOut = await densityProbe(page);
  out.density.transformAfterZoomOut = await zoomOf();
  await page.screenshot({ path: `${SHOTS}/wave9_density_zoomout_1366.png` });

  // 复位
  await page.getByRole('button', { name: '适合画面' }).click();
  await page.waitForTimeout(1500);
  out.density.afterFit = await densityProbe(page);

  // ---------- 3) 键盘焦点 ----------
  const focusRows = [];
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    focusRows.push(await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cs = getComputedStyle(el);
      const inShell = !!el.closest('[data-lcos-project-shell]');
      return {
        tag: el.tagName.toLowerCase(),
        label: (el.getAttribute('aria-label') ?? el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40),
        inShell,
        role: el.getAttribute('role'),
        tabindex: el.getAttribute('tabindex'),
        focusVisible: el.matches(':focus-visible'),
        roleBtnMatch: el.matches("[data-lcos-project-shell] [role='button']:focus-visible"),
        buttonMatch: el.matches('[data-lcos-project-shell] button:focus-visible'),
        cls: (el.getAttribute('class') ?? '').slice(0, 60),
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      };
    }));
  }
  out.keyboard.tabTrail = focusRows;
  out.keyboard.shellFocusWithOutline = focusRows.filter(
    (r) => r && r.inShell && r.outline.includes('solid') && r.outline.includes('2px'),
  ).length;
  out.keyboard.canvasTextareaRing = focusRows.filter((r) => r && r.tag === 'textarea' && r.outline.startsWith('solid 2px')).length;
  out.keyboard.tabTrailNonCanvas = focusRows
    .filter((r) => r && !/react-flow__/.test(r.cls))
    .map((r) => `${r.tag}:${r.label}:${r.outline}`);

  // HUD 控件逐个落焦（键盘交互后 :focus-visible 生效）→ 必须有 2px 可见轮廓
  out.keyboard.hudControls = [];
  for (const label of ['返回项目列表', '放大']) {
    const el = page.locator(
      label === '返回项目列表'
        ? 'a[title="返回项目列表"]'
        : '[data-lcos-camera-controls] button[aria-label="放大"]',
    );
    if ((await el.count()) === 0) {
      out.keyboard.hudControls.push({ label, present: false });
      continue;
    }
    await el.first().focus();
    // Tailwind `transition-colors` 把 outline-color 也纳入过渡，落焦瞬间读到的
    // 仍是 currentColor——等过渡结束再读真实轮廓色。
    await page.waitForTimeout(300);
    out.keyboard.hudControls.push(await page.evaluate((needle) => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return {
        label: needle,
        present: true,
        focusVisible: el.matches(':focus-visible'),
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
        minSize: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
      };
    }, label));
  }

  // 等过渡结束后复核 dock 按钮（transition-colors 会把 outline-color 一起过渡）
  await page.waitForTimeout(300);
  out.keyboard.dockButtonFocus = await page.evaluate(() => {
    const el = document.querySelector('[data-lcos-surface="context"]');
    if (!el) return null;
    el.focus();
    const cs = getComputedStyle(el);
    return {
      focusVisible: el.matches(':focus-visible'),
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      size: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
    };
  });
  await page.waitForTimeout(300);
  out.keyboard.dockButtonFocusSettled = await page.evaluate(() => {
    const el = document.querySelector('[data-lcos-surface="context"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`;
  });

  // ---------- 4) Esc 栈（专业窗口） ----------
  const opened = await page.evaluate(() => {
    const el = document.querySelector('[data-lcos-glyth-body]');
    if (!el) return false;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2,
    }));
    return true;
  });
  out.escStack.openedVia = opened;
  await page.waitForSelector('[data-lcos-professional-stage]:not([data-empty])', { timeout: 15000 })
    .catch(() => { out.escStack.windowMissing = true; });
  await page.waitForTimeout(2500);
  out.escStack.windowOpenBeforeEsc = await page.evaluate(() =>
    !!document.querySelector('[data-lcos-professional-stage]:not([data-empty])'));
  // 窗口内控件的键盘焦点轮廓
  await page.locator('[data-lcos-professional-stage] button[aria-label="关闭窗口"]').first().focus();
  out.escStack.closeButtonFocus = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return {
      focusVisible: el.matches(':focus-visible'),
      outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`,
      size: `${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`,
    };
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
  out.escStack.windowOpenAfterEsc = await page.evaluate(() =>
    !!document.querySelector('[data-lcos-professional-stage]:not([data-empty])'));
  out.escStack.canvasStillThere = await page.evaluate(() => !!document.querySelector('.react-flow'));
  await page.screenshot({ path: `${SHOTS}/wave9_esc_stack_1366.png` });
  await page.close();
}

// ---------- 5) reduced-motion ----------
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' });
  await boot(page);
  out.reducedMotion = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'lcos-static-pulse';
    probe.textContent = 'probe';
    document.querySelector('[data-lcos-project-shell]')?.appendChild(probe);
    const cs = getComputedStyle(probe);
    const result = { animationName: cs.animationName, animationDuration: cs.animationDuration, opacity: cs.opacity };
    probe.remove();
    const island = document.querySelector('[data-lcos-railway]');
    result.islandTransitionDuration = island ? getComputedStyle(island).transitionDuration : null;
    result.pulseNodes = document.querySelectorAll('.lcos-static-pulse').length;
    return result;
  });
  await page.screenshot({ path: `${SHOTS}/wave9_reduced_motion_1366.png` });
  await page.close();
}

await browser.close();
out.consoleErrors = consoleErrors.slice(0, 10);

// 紧凑摘要（便于逐档比对；详细 JSON 在后）
for (const [name, v] of Object.entries(out.viewports)) {
  console.log(
    `[layout] ${name} viewport=${v.viewport} overflow=${v.horizontalOverflow} shellScrollW=${v.shellScrollW} ` +
      `islands=${JSON.stringify(v.overflowingIslands)} bodies=${v.speciesBodies}`,
  );
}
console.log(
  `[camera] duringWheel=${out.cameraMove.sawAttrDuringWheel} clearedAfterSettle=${out.cameraMove.attrClearedAfterSettle}`,
);
console.log(
  `[density] atRest(zoom=${out.density.atRest.zoom}, zoomOnly=${out.density.atRest.zoomOnly}) ` +
    `${JSON.stringify(out.density.atRest.rows.map((r) => `${r.screenW}x${r.screenH}:${r.density}`))} ` +
    `zoomIn(${out.density.zoomLabelAfterZoomIn}, zoomOnly=${out.density.afterZoomIn.zoomOnly})=${JSON.stringify(out.density.afterZoomIn.rows.map((r) => `${r.screenW}x${r.screenH}:${r.density}`))} ` +
    `zoomOut(zoom=${out.density.afterZoomOut.zoom}, zoomOnly=${out.density.afterZoomOut.zoomOnly})=${JSON.stringify(out.density.afterZoomOut.rows.map((r) => `${r.screenW}x${r.screenH}:${r.density}`))} ` +
    `fit=${JSON.stringify(out.density.afterFit.rows.map((r) => `${r.screenW}x${r.screenH}:${r.density}`))}`,
);
console.log(
  `[reducedMotion] ${JSON.stringify(out.reducedMotion)}`,
);
console.log(
  `[keyboard] textareaRings=${out.keyboard.canvasTextareaRing} hud=${JSON.stringify(out.keyboard.hudControls)} ` +
    `nonCanvasTrail=${JSON.stringify(out.keyboard.tabTrailNonCanvas)}`,
);
console.log(`[escStack] ${JSON.stringify(out.escStack)}`);
console.log(`[dockFocus] ${JSON.stringify(out.keyboard.dockButtonFocus)} settled=${out.keyboard.dockButtonFocusSettled}`);
console.log(JSON.stringify(out, null, 2));

