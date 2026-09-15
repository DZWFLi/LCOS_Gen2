#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { runScenario } from './_harness.mjs';

const BASE = process.env.LCOS_E2E_WEB_URL ?? 'http://localhost:5273';
const PROJECT = process.env.LCOS_E2E_PROJECT ?? 'lcos-gen2-dev';
const SHOTS = resolve(process.env.LCOS_E2E_SHOT_DIR ?? '.e2e-data/shots');
mkdirSync(SHOTS, { recursive: true });

const result = await runScenario({
  name: 'GEN2-ux-runtime-contract',
  baseUrl: BASE,
  viewport: { width: 1440, height: 900 },
  async body(h) {
    await h.goto(`/projects/${PROJECT}/main`);
    await h.requireSelector('[data-lcos-project-shell]', { timeout: 30_000 });
    await h.requireSelector('.react-flow');
    await h.requireSelector('[data-lcos-species-body]', { timeout: 60_000 });

    const shell = await h.evaluate(() => ({
      projectShells: document.querySelectorAll('[data-lcos-project-shell]').length,
      canvases: document.querySelectorAll('.react-flow').length,
      docks: document.querySelectorAll('[data-lcos-surface-dock]').length,
      dockButtons: Array.from(document.querySelectorAll('[data-lcos-surface-dock] button')).map((button) => ({
        surface: button.getAttribute('data-lcos-surface'),
        label: button.getAttribute('aria-label'),
      })),
      railwayItems: Array.from(document.querySelectorAll('[data-lcos-railway-item]')).map((button) => button.getAttribute('data-lcos-railway-item')),
      assemblyEntries: document.querySelectorAll('[data-lcos-assembly-entry]').length,
      assemblyInsideDock: document.querySelectorAll('[data-lcos-surface-dock] [data-lcos-assembly-entry]').length,
      composers: document.querySelectorAll('[data-lcos-composer]').length,
      controls: document.querySelectorAll('.react-flow__controls').length,
      minimaps: document.querySelectorAll('.react-flow__minimap').length,
      nativeEditorsInsideLcos: document.querySelectorAll('[data-lcos-species-body] .milkdown').length,
      oldFixedChat: document.querySelectorAll('[data-testid="preview-workspace-panel"] [data-testid="chat-panel"]').length,
    }));

    h.requireEqual(shell.projectShells, 1, 'production route 必须只有一棵 Project Shell');
    h.requireEqual(shell.canvases, 1, 'production route 必须只有一份 Huabu Canvas');
    h.requireEqual(shell.docks, 1, 'SurfaceDock 必须唯一');
    h.requireEqual(
      JSON.stringify(shell.dockButtons),
      JSON.stringify([
        { surface: 'main', label: 'Main' },
        { surface: 'context', label: 'Context' },
        { surface: 'workflow', label: 'Workflow' },
      ]),
      'SurfaceDock 必须只含三个一级现场',
    );
    // real-dev fixture 不再把三个 root workspace 自动写成 Railway。
    h.requireEqual(shell.railwayItems.length, 0, '空 Railway 不得生成第二套三现场入口');
    h.requireEqual(shell.assemblyEntries, 1, 'Assembly 必须有且只有一个项目级入口');
    h.requireEqual(shell.assemblyInsideDock, 0, 'Assembly 不是第四 Surface，不得塞进 SurfaceDock');
    h.requireEqual(shell.composers, 0, '未发对象级 intent 时 Composer 不得常驻');
    h.requireEqual(shell.controls, 0, 'LCOS route 不挂 Huabu Controls');
    h.requireEqual(shell.minimaps, 0, 'LCOS route 不挂 Huabu MiniMap');
    h.requireEqual(shell.nativeEditorsInsideLcos, 0, 'LCOS body 下不得叠 native editor');
    h.requireEqual(shell.oldFixedChat, 0, 'LCOS route 不挂旧固定 Chat sidebar');

    // Assembly 是独立功能入口；Professional Window 只是它与其它专业 body
    // 共用的窗口宿主。先验证 Assembly，再关闭窗口继续节点近场路径。
    await h.page.locator('[data-lcos-assembly-entry]').click();
    await h.requireSelector('[data-lcos-professional-stage] [data-lcos-assembly]');
    h.requireEqual(
      await h.count('[data-lcos-professional-stage]'),
      1,
      'Assembly 不得创建第二套专业窗口宿主',
    );
    await h.page.locator('[data-lcos-window-icon-button]').click();
    await h.page.waitForSelector('[data-lcos-professional-stage][data-empty="true"]', { timeout: 10_000 });

    const target = await h.evaluate(() => {
      const body = document.querySelector('[data-lcos-species-body]');
      const node = body?.closest('.react-flow__node');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    h.requireTrue(target !== null, '找不到可选择的 LCOS 节点');
    await h.page.mouse.click(target.x, target.y);
    await h.requireSelector('[data-lcos-action-arc]');
    h.requireEqual(
      await h.count('.text-fg-muted.shadow-bottom.bg-surface'),
      0,
      '已覆盖物种不得同时显示旧 Huabu 节点工具条',
    );
    h.requireEqual(await h.count('[data-lcos-composer]'), 0, '选中本身不能自动打开 Composer');

    const compose = h.page.locator('[data-lcos-arc-primary="compose"]');
    h.requireEqual(await compose.count(), 1, '对象级 Composer 命令缺失');
    await compose.click();
    await h.requireSelector('[data-lcos-composer]');
    h.requireEqual(await h.count('[data-lcos-composer]'), 1, 'Composer 必须单实例');

    const geometry = await h.evaluate(() => {
      const composer = document.querySelector('[data-lcos-composer]');
      const dock = document.querySelector('[data-lcos-surface-dock]');
      const node = document.querySelector('.react-flow__node.selected');
      if (!composer || !dock || !node) return null;
      const c = composer.getBoundingClientRect();
      const d = dock.getBoundingClientRect();
      const n = node.getBoundingClientRect();
      return {
        composerBottom: c.bottom,
        dockTop: d.top,
        horizontalGap: Math.max(n.left - c.right, c.left - n.right, 0),
        verticalGap: Math.max(n.top - c.bottom, c.top - n.bottom, 0),
      };
    });
    h.requireTrue(geometry !== null, 'Composer 几何无法读取');
    h.requireTrue(geometry.composerBottom < geometry.dockTop, 'Composer 不得覆盖底部 SurfaceDock');
    h.requireTrue(
      Math.min(geometry.horizontalGap, geometry.verticalGap) <= 96,
      `Composer 必须靠近目标节点：${JSON.stringify(geometry)}`,
    );

    await h.screenshot(resolve(SHOTS, 'gen2-ux-runtime-contract-1440.png'));
  },
});

if (!result.ok) process.exitCode = 1;
