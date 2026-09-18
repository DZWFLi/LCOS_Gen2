// Wave 1 源码组合树验收（正本 `04_逐Wave施工卡与验收.md` Wave 1 + `appendices\B_...`
// 「防止再次出现本次施工问题的验收规则」第一条）。
//
// 正本明文的两条组合树验收：
//   1) 「`CanvasPage` production return 中不再出现 `MainLayout`」
//   2) 「新 Shell 的 caller 唯一；`Canvas` 仍只有一份」
// 这里断言的是**源码结构**（正本自己规定的 gate），不是交互验证的替代品：
// 视觉/DOM/截图证据仍必须来自真实浏览器。
//
// 本文件只读源码文本，**不 import 任何会拖入 lottie-web / 浏览器 Canvas 运行时**的模块
// （`LcosAppRoutes` → `LcosProjectLauncherPage` → `lottie-web` 会在 vitest 环境抛
// `TypeError: ctx.fillRect is not a function`），因此全部使用文本/结构断言。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_SOURCE = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8');
const APP_ROUTES_SOURCE = readFileSync(join(__dirname, 'LcosAppRoutes.tsx'), 'utf8');
const CANVAS_PAGE_SOURCE = readFileSync(
  join(__dirname, '..', '..', 'pages', 'CanvasPage', 'CanvasPage.tsx'),
  'utf8',
);

/**
 * 旧三栏壳 + 旧产品列表页的组件名。断言只针对**代码形态**（import 说明符 / JSX 标签），
 * 不针对文档注释里对退役事实的说明，避免把"解释为什么退役"的文字误判成"仍在挂载"。
 */
const RETIRED_COMPONENTS = [
  'MainLayout',
  'CenterArea',
  'CanvasHeader',
  'CanvasLayerPanel',
  'PreviewWorkspacePanel',
  'CanvasListPage',
] as const;

describe('Wave 1 route composition', () => {
  it('LCOS 路由组接管 `/spaces`：产品前台入口不再是 Huabu CanvasListPage', () => {
    expect(APP_ROUTES_SOURCE).toContain("{ path: '/projects'");
    expect(APP_ROUTES_SOURCE).toContain("{ path: '/spaces'");
    expect(APP_ROUTES_SOURCE).toContain("{ path: '/projects/:projectId/:surface?'");
    expect(APP_ROUTES_SOURCE).toContain('<LcosProjectLauncherPage />');
    // `/spaces` 的路由注册必须已从 App.tsx 的路由表移除（注释不算）。
    expect(APP_SOURCE).not.toContain("path: '/spaces'");
  });

  it('App 生产路由表不再注册旧产品列表页', () => {
    expect(APP_SOURCE).not.toMatch(/from '\.\/pages\/CanvasListPage'/);
    expect(APP_SOURCE).not.toMatch(/import\(['"][^'"]*CanvasListPage/);
    expect(APP_SOURCE).not.toMatch(/<CanvasListPage/);
  });

  it('`/canvas/:canvasId` 由已退役的 CanvasPage（LCOS 入口）接管', () => {
    expect(APP_SOURCE).toContain("path: '/canvas/:canvasId'");
    expect(APP_SOURCE).toContain("import('./pages/CanvasPage/CanvasPage')");
  });

  it('旧三栏壳不再进入生产组合树：CanvasPage 不 import 也不渲染退役组件', () => {
    for (const component of RETIRED_COMPONENTS) {
      // 不 import
      expect(CANVAS_PAGE_SOURCE).not.toMatch(new RegExp(`from '[^']*${component}[^']*'`));
      // 不渲染
      expect(CANVAS_PAGE_SOURCE).not.toMatch(new RegExp(`<${component}\\b`));
    }
  });

  it('LCOS Shell 的组合根唯一：CanvasPage 只是把渲染交给 LcosProjectRoute', () => {
    expect(CANVAS_PAGE_SOURCE).toContain('LcosProjectRoute');
    expect(CANVAS_PAGE_SOURCE).toContain('useLcosCanvasBinding');
    // CanvasPage 不得自己挂 Canvas（第二份 ReactFlow / 第二份 camera 皆禁止）。
    expect(CANVAS_PAGE_SOURCE).not.toMatch(/from '@\/components\/Panels\/Canvas\/Canvas'/);
  });
});