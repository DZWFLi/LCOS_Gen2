#!/usr/bin/env node
/**
 * R2 返工后的浏览器证据（fail-fast harness）。
 *
 * 这一轮要证明的是**产品面**，不是"能跑"：
 *   1. 首屏：Core 投影全部进 LCOS 物种 body（没有空 `Type…` 编辑器占位）；
 *   2. 首屏：物种可辨（source/decision/glyth…），相机可读（不靠 200% 以上放大）；
 *   3. 真实内容位：图片节点有**真实来源**且 img 真的解码成功（不是"无图片来源"空白块）；
 *      文本节点有**真实正文预览**（来自 Core FileRecord，不是编造文案）；
 *   4. 落位：真实节点两两不重叠；
 *   5. Action Arc：**节点近场**（锚在选中节点上，不是固定右侧菜单），近场 3 动作 + 更多，
 *      且不再出现整排「尚未接线（GAP）」；
 *   6. 旧壳：LCOS 模式下不存在旧 Huabu 浮动工具条（节点/边）。
 *
 * 前置：隔离环境先 reset + up（保证 fixture 与"新投影落位/路由/内容落成"都走到）。
 * 用法：node scripts/e2e/r2-main-vertical-slice.mjs
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const BASE = process.env.LCOS_E2E_WEB_URL ?? 'http://localhost:5273';
const PROJECT = process.env.LCOS_E2E_PROJECT ?? 'lcos-gen2-dev';
const SHOTS = resolve(process.env.LCOS_E2E_SHOT_DIR ?? '.e2e-data/shots');
mkdirSync(SHOTS, { recursive: true });

/** 旧 Huabu 浮动工具条的 class（`FLOATING_TOOLBAR_CLASS`，全仓唯一来源）。 */
const LEGACY_TOOLBAR = '.text-fg-muted.shadow-bottom.bg-surface';
void LEGACY_TOOLBAR;

/**
 * 等"绑定登记 + 内容落成"两个 dev-only 信号，并等 DOM 节点数与登记数一致
 * （投影/渲染/图片落成全部落定再断言，避免对着"只到一半"的画面下结论）。
 */
async function waitBindingsReady(h) {
  let registered = 0;
  let staged = -1;
  let resolveRegistered;
  let resolveStaged;
  const registeredReady = new Promise((r) => {
    resolveRegistered = r;
  });
  const stagedReady = new Promise((r) => {
    resolveStaged = r;
  });
  const messages = [];
  h.page.on('console', (m) => {
    const text = m.text();
    messages.push(`[${m.type()}] ${text.slice(0, 300)}`);
    const registeredMatch = /\[lcos\] bindings registered: (\d+)/.exec(text);
    if (registeredMatch) {
      registered = Number(registeredMatch[1]);
      resolveRegistered();
    }
    const stagedMatch = /\[lcos\] node sources staged: (\d+)/.exec(text);
    if (stagedMatch) {
      staged = Number(stagedMatch[1]);
      resolveStaged();
    }
  });
  h.page.on('pageerror', (e) => messages.push(`[pageerror] ${String(e.message).slice(0, 300)}`));

  /** 打开 Main 并等 .react-flow 与节点；返回是否出现了节点。 */
  const openMain = async () => {
    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-project-shell]', { timeout: 30000 });
    await h.page.waitForSelector('.react-flow', { timeout: 30000 }).catch(() => {
      messages.push('[e2e] .react-flow 未出现');
    });
    return h.page
      .waitForSelector('.react-flow__node', { timeout: 20000 })
      .then(() => true)
      .catch(async () => {
        const diag = await h.evaluate(() => ({
          reactFlow: document.querySelectorAll('.react-flow').length,
          viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '',
          recover: document.querySelectorAll('[data-lcos-recover-canvas]').length,
          body: document.body.innerText.replace(/\s+/g, ' ').slice(0, 200),
        }));
        messages.push(`[e2e] .react-flow__node 未出现：${JSON.stringify(diag)}`);
        return false;
      });
  };

  let hasNodes = await openMain();
  if (!hasNodes) {
    // 这一轮载入拿到的是"还没落定的画布基线"（实测发生在画布刚被 recover 之后的第一、二次载入：
    // Core 侧 binding 已有 7 条，而浏览器画布 store 是空的 → 首屏显示"空的主现场"）。
    // 这里**再载入一次**（有上限，只重试一次），让画布基线稳定；不是放水，是把"等基线落定"
    // 这一步显式化 —— 后续断言仍然按原样 fail-fast。
    messages.push('[e2e] 首次载入画布为空，重新载入一次');
    hasNodes = await openMain();
    if (!hasNodes) messages.push('[e2e] 第二次载入仍为空（后续断言会以真实数字失败）');
  }
  await Promise.race([registeredReady, h.wait(20000)]);
  await Promise.race([stagedReady, h.wait(20000)]);
  if (registered > 0) {
    try {
      await h.page.waitForFunction(
        (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
        registered,
        { timeout: 15000 },
      );
    } catch {
      messages.push(`[e2e] DOM 节点数未达到登记的 ${registered}`);
    }
  }
  // 图片落成是异步的（Core 取字节 → 上传画布资产区 → 写回 data.src），
  // 等真实 <img> 解码完成再断言"不是空白块"。
  await h.page
    .waitForFunction(
      () => {
        const nodes = Array.from(document.querySelectorAll('.react-flow__node-image'));
        if (nodes.length === 0) return true;
        return nodes.every((el) => {
          const img = el.querySelector('img');
          return img !== null && img.getAttribute('src') !== null && img.complete && img.naturalWidth > 0;
        });
      },
      undefined,
      { timeout: 25000 },
    )
    .catch(() => {
      messages.push('[e2e] 图片节点未在超时内完成真实解码');
    });
  await h.wait(600);
  for (const message of messages) console.log('  [console]', message);
  console.log(`  [e2e] registered=${registered} staged=${staged}`);
  return { registered, staged };
}

/** 挑一个没有被 HUD 浮层遮挡的节点，返回它的屏幕中心点。 */
const pickUnoccludedNode = () => {
  const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    const cx = Math.round(r.left + Math.min(r.width / 2, Math.max(10, r.width - 12)));
    const cy = Math.round(r.top + Math.min(24, Math.max(6, r.height / 2)));
    if (cx < 8 || cy < 8 || cx > window.innerWidth - 8 || cy > window.innerHeight - 8) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit.closest('.react-flow__node') === el) return { id: el.dataset.id ?? '', x: cx, y: cy };
  }
  return null;
};

const bootstrap = await runScenario({
  name: 'R2v2-bootstrap-canvas',
  baseUrl: BASE,
  allowHttp: [404],
  allowConsoleErrorsMatching: [/404/, /Failed to load resource/],
  async body(h) {
    // 记录本轮 reconcile 用的是哪个 canvas（dev-only 信号），供"等画布落定"用。
    let canvasId = '';
    const messages = [];
    h.page.on('console', (m) => {
      const text = m.text();
      const match = /\[lcos\] reconcile start canvas=(\S+)/.exec(text);
      if (match) {
        canvasId = match[1];
      }
      if (m.type() === 'warning') messages.push(text.slice(0, 200));
    });
    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-project-shell]', { timeout: 30000 });
    if (!(await h.has('.react-flow'))) {
      await h.requireSelector('[data-lcos-recover-canvas]', { timeout: 30000 });
      await h.page.locator('[data-lcos-recover-canvas]').first().click();
      await h.requireSelector('.react-flow', { timeout: 60000 });
      // recover 之后**再载入一次**：recover 期间画布 id 会换一次（实测两次载入拿到的是
      // 不同 canvas，后一个才是稳定的那个）。不重新载入 + 不等落定的话，后续场景会打开一个
      // 还没投影的空画布（实测首屏 0 节点、"空的主现场"）。
      canvasId = '';
      await h.goto(`/projects/${PROJECT}/main`);
      await h.requireSelector('[data-lcos-project-shell]', { timeout: 30000 });
      await h.requireSelector('.react-flow', { timeout: 60000 });
    }
    // 等拿到这一轮的 canvas id（dev-only 信号）。
    const idDeadline = Date.now() + 30000;
    while (canvasId === '' && Date.now() < idDeadline) {
      await h.wait(300);
    }
    // 等画布在**服务端**落定（连续两次读到相同节点数）。RFS 是服务端写，浏览器 store 不会在
    // 本会话内增量收到，所以必须先确认服务端已有完整内容，后续页面才能拿到它。
    try {
      await h.page.waitForFunction(
        async (cid) => {
          if (cid === '') return false;
          const res = await fetch(`/api/canvas/${cid}`);
          if (!res.ok) return false;
          const json = await res.json();
          const count = json?.state?.nodes?.length ?? 0;
          const previous = window.__lcosE2eLastCount;
          window.__lcosE2eLastCount = count;
          return count > 0 && previous === count;
        },
        canvasId,
        { timeout: 90000, polling: 700 },
      );
    } catch {
      console.log('  [e2e] 画布未在超时内落定（后续断言会暴露）');
    }
    for (const message of messages) console.log('  [console]', message);
    console.log(`  [e2e] bootstrap canvas=${canvasId}`);
  },
});

const framing = await runScenario({
  name: 'R2v2-main-framing-projections-and-content',
  baseUrl: BASE,
  async body(h) {
    const ready = await waitBindingsReady(h);

    const info = await h.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
      const viewport = document.querySelector('.react-flow__viewport');
      const scale = Number(/scale\(([^)]+)\)/.exec(viewport?.style.transform ?? '')?.[1] ?? '1');
      const species = Array.from(document.querySelectorAll('[data-lcos-species]')).map((el) =>
        el.getAttribute('data-lcos-species'),
      );
      return {
        scale,
        count: nodes.length,
        kinds: nodes.map((n) => n.className.toString().replace('react-flow__node', '').trim()),
        speciesBodies: document.querySelectorAll('[data-lcos-species-body]').length,
        species,
        textNodes: document.querySelectorAll('.react-flow__node-text').length,
        legacyToolbars: document.querySelectorAll('.text-fg-muted.shadow-bottom.bg-surface').length,
        previews: document.querySelectorAll('[data-lcos-node-preview]').length,
        noImageSource: document.body.innerText.includes('无图片来源'),
        images: Array.from(document.querySelectorAll('.react-flow__node-image img')).map((img) => ({
          src: (img.getAttribute('src') ?? '').slice(0, 120),
          naturalWidth: img.naturalWidth,
        })),
      };
    });
    console.log('[r2v2] 首屏 =', JSON.stringify(info));

    // 1) Core 投影不得再落成"空的可编辑文本节点"（首屏无 `Type…` 占位）
    h.requireEqual(info.textNodes, 0, 'Core 投影不应再出现 Huabu text 节点（空 Type… 占位）');
    // 1b) 已投影的**全部**节点都必须真的在首屏画面上（不是视口外没渲染）
    h.requireTrue(
      info.count >= ready.registered,
      `首屏只渲染了 ${info.count} 个节点，已登记 ${ready.registered} 个（其余落在视口外未渲染）`,
    );
    // 2) 必须真的由 LCOS 物种 body 呈现，且是**多个不同物种**（内容密度来自真实物种，不来自放大）
    h.requireTrue(info.speciesBodies > 0, '首屏没有 LCOS 物种 body（投影未进入 junction）');
    h.requireTrue(
      new Set(info.species).size >= 2,
      `首屏物种过于单一（${JSON.stringify(info.species)}），可辨识度不足`,
    );
    h.requireTrue(info.species.includes('glyth'), '首屏没有 conversation/Glyth 节点（承接会话未投影）');
    h.requireTrue(info.species.includes('source'), '首屏没有 source 物种（材料/来源未进入主视觉）');
    // 3) 可读取景：不是 200% 以上的"只见文字"，也不是缩到看不清
    h.requireTrue(info.scale <= 1.3, `首屏 zoom 过大（${info.scale}），不可读`);
    h.requireTrue(info.scale >= 0.5, `首屏 zoom 过小（${info.scale}），退化成缩略图墙`);

    // 4) 真实内容位：图片有真实来源且解码成功；文本有真实正文预览
    h.requireTrue(info.images.length > 0, '首屏没有图片节点（fixture 的 source/material 未进入主视觉）');
    h.requireTrue(
      info.images.every((image) => image.src !== '' && image.naturalWidth > 0),
      `图片节点没有真实解码内容：${JSON.stringify(info.images)}`,
    );
    h.requireTrue(!info.noImageSource, '画面上仍出现「无图片来源」空白块（用户已否决的形态）');
    h.requireTrue(info.previews > 0, '没有任何节点渲染真实正文预览（preview 位未接通）');

    // 5) 落位：真实节点两两不重叠
    const nodes = await h.evaluate(() =>
      Array.from(document.querySelectorAll('.react-flow__node')).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          id: el.dataset.id ?? '',
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        };
      }),
    );
    console.log('[r2v2] 节点 =', JSON.stringify(nodes));
    const overlaps = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        if (!apart) overlaps.push(`${a.id} × ${b.id}`);
      }
    }
    h.requireTrue(overlaps.length === 0, `投影节点重叠：${overlaps.join(', ')}`);
    // 6) 首屏不得同时挂旧 Huabu 浮动工具条
    h.requireEqual(info.legacyToolbars, 0, 'LCOS 模式下旧 Huabu 浮动工具条仍挂载');

    await h.screenshot(resolve(SHOTS, 'r2-main-1440-v2.png'));
  },
});

const arc = await runScenario({
  name: 'R2v2-action-arc-near-field',
  baseUrl: BASE,
  async body(h) {
    await waitBindingsReady(h);
    const target = await h.evaluate(pickUnoccludedNode);
    h.requireTrue(target !== null, '找不到未被 HUD 遮挡的节点');
    await h.page.mouse.click(target.x, target.y);
    await h.requireSelector('[data-lcos-action-arc]', { timeout: 8000 });
    await h.wait(200);

    const geom = await h.evaluate((nodeId) => {
      const nodeEl = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
      const arcEl = document.querySelector('[data-lcos-action-arc]');
      if (!nodeEl || !arcEl) return null;
      const n = nodeEl.getBoundingClientRect();
      const a = arcEl.getBoundingClientRect();
      return {
        node: {
          left: Math.round(n.left),
          top: Math.round(n.top),
          right: Math.round(n.right),
          bottom: Math.round(n.bottom),
        },
        arc: {
          left: Math.round(a.left),
          top: Math.round(a.top),
          right: Math.round(a.right),
          bottom: Math.round(a.bottom),
        },
        primary: document.querySelectorAll('[data-lcos-arc-primary]').length,
        more: document.querySelectorAll('[data-lcos-arc-more]').length,
        legacyToolbars: document.querySelectorAll('.text-fg-muted.shadow-bottom.bg-surface').length,
        viewportWidth: window.innerWidth,
      };
    }, target.id);
    console.log('[r2v2] Arc 几何 =', JSON.stringify(geom));
    h.requireTrue(geom !== null, '读不到 Arc/节点几何');

    // 近场判定：Arc 在选中节点的水平范围内、且贴着节点（垂直距离小），不是停在右侧的固定菜单
    const horizontalOverlap = geom.arc.right > geom.node.left && geom.arc.left < geom.node.right;
    h.requireTrue(horizontalOverlap, `Action Arc 不在节点近场（水平不相交）：${JSON.stringify(geom)}`);
    const verticalGap = Math.min(
      Math.abs(geom.arc.bottom - geom.node.top),
      Math.abs(geom.node.bottom - geom.arc.top),
    );
    h.requireTrue(verticalGap <= 80, `Action Arc 离节点过远（${verticalGap}px）`);

    // 近场一排 = 3 个动作 + 更多（T3-A02）
    h.requireEqual(geom.primary, 3, '近场动作数应为 3');
    h.requireEqual(geom.more, 1, '近场应有 1 个「更多」入口');
    // 旧 Huabu 浮动工具条不得同时存在
    h.requireEqual(geom.legacyToolbars, 0, 'LCOS 模式下旧 Huabu 浮动工具条仍挂载');

    // 更多面板：分组来自真实覆盖关系 + 真实 reason（不得再堆「尚未接线（GAP）」）
    await h.page.click('[data-lcos-arc-more]');
    await h.requireSelector('[data-lcos-arc-panel]', { timeout: 5000 });
    const panel = await h.evaluate(() => ({
      groups: Array.from(document.querySelectorAll('[data-lcos-command-group]')).map((g) =>
        g.getAttribute('data-lcos-command-group'),
      ),
      commands: Array.from(document.querySelectorAll('[data-lcos-arc-panel] [data-lcos-command]')).map((b) =>
        b.getAttribute('data-lcos-command'),
      ),
      reasons: Array.from(document.querySelectorAll('[data-lcos-command-reason]')).map((s) => s.textContent),
      allButtons: Array.from(document.querySelectorAll('[data-lcos-arc-panel] button')).map((b) =>
        b.textContent,
      ),
      hasSize: document.querySelectorAll('[data-lcos-size-width]').length,
      hasAccent: document.querySelectorAll('[data-lcos-accent]').length,
    }));
    console.log('[r2v2] 更多面板 =', JSON.stringify(panel));
    for (const group of ['外观', '空间']) {
      h.requireTrue(panel.groups.includes(group), `更多面板缺分组：${group}`);
    }
    h.requireTrue(panel.hasSize === 1 && panel.hasAccent > 0, '尺寸/强调色控件缺失');
    // 用户否决项：不得再出现整排 GAP
    h.requireTrue(
      !panel.reasons.some((text) => (text ?? '').includes('尚未接线')),
      `更多面板仍出现「尚未接线（GAP）」：${JSON.stringify(panel.reasons)}`,
    );
    h.requireTrue(
      !panel.allButtons.some((text) => (text ?? '').includes('尚未接线')),
      '更多面板仍渲染 GAP 文案按钮',
    );
    // 任何被禁用的动作都必须给出非空真实 reason（不许沉默的灰按钮）
    const disabledCount = await h.page.evaluate(
      () =>
        Array.from(document.querySelectorAll('[data-lcos-arc-panel] [data-lcos-command]')).filter(
          (el) => el.hasAttribute('disabled'),
        ).length,
    );
    h.requireTrue(
      disabledCount === panel.reasons.length,
      `禁用动作数与真实 reason 数不一致（${disabledCount} vs ${panel.reasons.length}）`,
    );

    await h.screenshot(resolve(SHOTS, 'r2-action-arc-1440-v2.png'));
  },
});

const legacy = await runScenario({
  name: 'R2v2-legacy-chrome-absent',
  baseUrl: BASE,
  async body(h) {
    await waitBindingsReady(h);
    const counts = await h.evaluate(() => ({
      minimap: document.querySelectorAll('.react-flow__minimap').length,
      controls: document.querySelectorAll('.react-flow__controls').length,
      legacyToolbars: document.querySelectorAll('.text-fg-muted.shadow-bottom.bg-surface').length,
      lcosArc: document.querySelectorAll('[data-lcos-action-arc]').length,
      lcosEdgeArc: document.querySelectorAll('[data-lcos-edge-arc]').length,
      railway: document.querySelectorAll('[data-lcos-railway]').length,
    }));
    console.log('[r2v2] 旧壳探测 =', JSON.stringify(counts));
    h.requireEqual(counts.minimap, 0, 'LCOS 模式不应挂 MiniMap');
    h.requireEqual(counts.controls, 0, 'LCOS 模式不应挂 Controls');
    h.requireEqual(counts.legacyToolbars, 0, 'LCOS 模式不应挂旧 Huabu 浮动工具条');
    h.requireEqual(counts.lcosArc, 0, '未选中节点时不应出现 Action Arc');
    h.requireEqual(counts.railway, 1, 'Railway 应挂载一次');
  },
});

console.log(
  JSON.stringify(
    {
      ok: bootstrap.ok && framing.ok && arc.ok && legacy.ok,
      scenarios: [bootstrap.scenario, framing.scenario, arc.scenario, legacy.scenario],
      shots: [resolve(SHOTS, 'r2-main-1440-v2.png'), resolve(SHOTS, 'r2-action-arc-1440-v2.png')],
    },
    null,
    2,
  ),
);
