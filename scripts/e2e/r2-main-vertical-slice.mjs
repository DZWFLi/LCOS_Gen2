#!/usr/bin/env node
/**
 * R2 Main 垂直切片浏览器证据（fail-fast harness）。
 *
 * 场景 1（placement）：全新隔离数据上打开 Main —— 投影节点两两不重叠（旧实现是 40px 级联）。
 * 场景 2（junction/chrome/命令面）：单一 LCOS body、旧 Huabu 产品壳不挂载、右键出 Action Arc、
 *                                    Action Arc 覆盖 进入/关系/编辑/视图/未接线 五组命令。
 *
 * 用法（隔离环境先 reset + up，保证落位是"新投影"路径）：
 *   node scripts/e2e/r2-main-vertical-slice.mjs
 * 环境变量：LCOS_E2E_WEB_URL / LCOS_E2E_PROJECT / LCOS_E2E_SHOT_DIR
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const BASE = process.env.LCOS_E2E_WEB_URL ?? 'http://localhost:5273';
const PROJECT = process.env.LCOS_E2E_PROJECT ?? 'lcos-gen2-dev';
const SHOTS = resolve(process.env.LCOS_E2E_SHOT_DIR ?? '.e2e-data/shots');
mkdirSync(SHOTS, { recursive: true });

const measure = () =>
  Array.from(document.querySelectorAll('.react-flow__node')).map((el) => {
    const node = el;
    const r = node.getBoundingClientRect();
    return {
      id: node.dataset.id ?? '',
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });

/**
 * 前置：全新隔离数据里 Core 的 workspace.canvasId 指向一张本环境 Huabu 画布库里不存在的画布
 * （R0 已记录的真实路径）。首次进入会出现「重新建立现场画布」恢复入口 —— 本场景只负责把它点开，
 * 让后面的 R2 场景在一个真实存在的画布上运行（不复用 R0 脚本，避免耦合）。
 */
const bootstrap = await runScenario({
  name: 'R2-bootstrap-canvas',
  baseUrl: BASE,
  allowHttp: [404],
  allowConsoleErrorsMatching: [/404/, /Failed to load resource/],
  async body(h) {
    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-project-shell]', { timeout: 30000 });
    if (await h.has('.react-flow')) return;
    await h.requireSelector('[data-lcos-recover-canvas]', {
      timeout: 30000,
      message: '既无画布也无「重新建立现场画布」入口',
    });
    await h.page.locator('[data-lcos-recover-canvas]').first().click();
    await h.requireSelector('.react-flow', { timeout: 60000, message: '重建后仍未挂载画布' });
    await h.wait(2000);
  },
});

const placement = await runScenario({
  name: 'R2-main-placement',
  baseUrl: BASE,
  async body(h) {
    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-project-shell]', { timeout: 30000 });
    await h.requireSelector('.react-flow__node', { timeout: 30000 });
    await h.wait(1500); // 等 reconcile 投影落位完成

    const nodes = await h.evaluate(measure);
    h.requireNonEmpty(nodes, 'Main 上应出现投影节点');
    console.log('[r2] 节点数 =', nodes.length, JSON.stringify(nodes.slice(0, 6)));

    // 两两不重叠（旧 index*40 级联在这里必然失败）
    const overlaps = [];
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        if (!apart) overlaps.push(`${a.id || i} × ${b.id || j}`);
      }
    }
    h.requireTrue(overlaps.length === 0, `投影节点重叠：${overlaps.join(', ')}`);

    await h.screenshot(resolve(SHOTS, 'r2-main-1440.png'));
  },
});

const commandSurface = await runScenario({
  name: 'R2-main-junction-chrome-commands',
  baseUrl: BASE,
  async body(h) {
    // 确定性等待点：dev-only 的「bindings registered」信号说明节点身份已进入 reference store。
    let bindingsReady = null;
    const ready = new Promise((resolve) => {
      bindingsReady = resolve;
    });
    h.page.on('console', (m) => {
      if (m.text().includes('[lcos] bindings registered')) bindingsReady();
    });

    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-project-shell]', { timeout: 30000 });
    await h.requireSelector('.react-flow__node', { timeout: 30000 });
    await Promise.race([ready, h.wait(20000)]);
    await h.wait(300);

    // 旧 Huabu 产品壳不得挂载（chromeMode=lcos）
    const legacy = await h.evaluate(() => ({
      minimap: document.querySelectorAll('.react-flow__minimap').length,
      controls: document.querySelectorAll('.react-flow__controls').length,
    }));
    console.log('[r2] 旧壳探测 =', JSON.stringify(legacy));
    h.requireEqual(legacy.minimap, 0, 'LCOS 模式下不应挂载 Huabu MiniMap');
    h.requireEqual(legacy.controls, 0, 'LCOS 模式下不应挂载 Huabu Controls');

    // 右键节点 → T3 Action Arc。
    // 必须先挑一个**没有被 HUD 盖住**的节点（底部的 Composer/Dock 是屏幕空间浮层）：
    // 用 elementFromPoint 反查命中的是不是这个节点本身，避免"点到了 Composer"这种假失败。
    const first = await h.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('.react-flow__node'));
      for (const el of nodes) {
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2);
        const cy = Math.round(r.top + Math.min(24, Math.max(4, r.height / 2)));
        if (cx < 8 || cy < 8 || cx > window.innerWidth - 8 || cy > window.innerHeight - 8) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit.closest('.react-flow__node') === el) return { x: cx, y: cy };
      }
      return null;
    });
    h.requireTrue(first !== null, '找不到未被 HUD 遮挡、可右键的节点');
    await h.page.mouse.move(first.x, first.y);
    await h.page.mouse.click(first.x, first.y, { button: 'right' });
    await h.requireSelector('[data-lcos-action-arc]', { timeout: 8000 });

    const menu = await h.evaluate(() => {
      const arc = document.querySelector('[data-lcos-action-arc]');
      return {
        groups: Array.from(document.querySelectorAll('[data-lcos-action-group]')).map((g) =>
          g.getAttribute('data-lcos-action-group'),
        ),
        commands: Array.from(document.querySelectorAll('[data-lcos-command]')).map((b) => ({
          id: b.getAttribute('data-lcos-command'),
          disabled: b.hasAttribute('disabled'),
          reason: b.querySelector('[data-lcos-command-reason]')?.textContent ?? null,
        })),
      };
    });
    console.log('[r2] Action Arc =', JSON.stringify(menu));
    for (const group of ['进入', '关系', '编辑', '视图', '未接线']) {
      h.requireTrue(menu.groups.includes(group), `Action Arc 缺命令组：${group}`);
    }
    h.requireTrue(menu.commands.length >= 8, `命令数不足（${menu.commands.length}）`);
    // 已绑定的 Core 投影节点：打开与引用必须真的可用（串起 reconcile→binding→descriptor→store→命令）
    const open = menu.commands.find((c) => c.id === 'open');
    const reference = menu.commands.find((c) => c.id === 'reference');
    h.requireEqual(open?.disabled, false, `投影节点的「打开」应可用，实际原因：${open?.reason ?? '（无）'}`);
    h.requireEqual(
      reference?.disabled,
      false,
      `投影节点的「引用」应可用，实际原因：${reference?.reason ?? '（无）'}`,
    );
    // 未接线命令必须显式标注原因，不允许静默的假按钮
    const gapCommands = menu.commands.filter((c) => c.reason === '尚未接线（GAP）');
    h.requireTrue(gapCommands.length >= 4, '缺口命令未标注 GAP');
    for (const c of gapCommands) {
      h.requireTrue(c.disabled === true, `GAP 命令「${c.id}」应为禁用`);
    }

    await h.screenshot(resolve(SHOTS, 'r2-action-arc-1440.png'));

    // Esc 关闭
    await h.page.keyboard.press('Escape');
    await h.wait(200);
    h.requireEqual(await h.count('[data-lcos-action-arc]'), 0, 'Esc 后 Action Arc 应关闭');

    // 单一 junction：物种 body 或 native body 其一，不允许叠两套
    const bodies = await h.evaluate(() => ({
      species: document.querySelectorAll('[data-lcos-species-body]').length,
      densityAttrs: document.querySelectorAll('[data-lcos-density]').length,
      lcosChrome: document.querySelectorAll('[data-lcos-railway]').length,
    }));
    console.log('[r2] body 探测 =', JSON.stringify(bodies));
    h.requireEqual(bodies.lcosChrome, 1, 'Railway 应挂载一次');
  },
});

console.log(
  JSON.stringify(
    {
      ok: bootstrap.ok && placement.ok && commandSurface.ok,
      scenarios: [bootstrap.scenario, placement.scenario, commandSurface.scenario],
      shots: [resolve(SHOTS, 'r2-main-1440.png'), resolve(SHOTS, 'r2-action-arc-1440.png')],
    },
    null,
    2,
  ),
);
