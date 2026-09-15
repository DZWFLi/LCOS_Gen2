// R1 共享组件族测试（happy-dom）：每族都渲染出 Figma 的全部 variant，
// 并暴露统一的 `data-lcos-family` + `data-lcos-variant` 契约。
// 这是「gallery 覆盖全部 variant」的自动化对照；浏览器侧证据见 R1 的 gallery 脚本。

import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { createLcosNodePresentationSeam } from '../../nodes/createLcosNodePresentationSeam';
import { LcosSurfaceFeedback } from '../LcosSurfaceFeedback';
import { LcosCollectionSurface } from './LcosCollectionSurface';
import { LcosNavigatorIslandView, type LcosNavigatorIslandState } from './LcosNavigatorIslandView';
import { LcosPortalPreview, type LcosPortalPreviewState } from './LcosPortalPreview';
import { LcosRailwayView } from './LcosRailwayView';
import { LcosTaskCard, type LcosTaskCardState } from './LcosTaskCard';
import { LcosWindowChrome, type LcosWindowLayout } from './LcosWindowChrome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];

function render(element: React.JSX.Element): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => {
    root.render(element);
  });
  return container;
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  document.body.replaceChildren();
});

const NAV_STATES: readonly LcosNavigatorIslandState[] = [
  '静息',
  '彩色标',
  '搜索',
  'hover',
  'pressed',
  'focus',
  'disabled',
  'loading',
  'error',
  'degraded',
  'selected',
];

const FEEDBACK: readonly string[] = ['loading', 'empty', 'normal', 'focus', 'disabled', 'error', 'recovery'];
const WINDOW_LAYOUTS: readonly LcosWindowLayout[] = ['浮动', '停靠', '分组'];
const TASK_STATES: readonly LcosTaskCardState[] = [
  '静息',
  '悬停',
  '预览',
  '已选目标',
  '草稿中',
  '不可用',
  '键盘焦点',
];
const PORTAL_STATES: readonly LcosPortalPreviewState[] = [
  '可预览',
  '加载中',
  '旧缓存',
  '部分预览',
  '预览失败',
  '目标缺失',
];

describe('R1 共享组件族', () => {
  it('NavigatorIsland 覆盖 Figma 11 状态；搜索态渲染输入，彩色标渲染 Pin', () => {
    for (const state of NAV_STATES) {
      const el = render(
        <LcosNavigatorIslandView
          state={state}
          query={state === '搜索' ? 'x' : ''}
          pins={
            state === '搜索' || state === '彩色标'
              ? [
                  { id: 'a', tone: 'violet', label: '紫' },
                  { id: 'b', tone: 'teal', label: '青' },
                  { id: 'c', tone: 'amber', label: '琥' },
                ]
              : []
          }
        />,
      );
      const root = el.querySelector('[data-lcos-family="navigator-island"]');
      expect(root?.getAttribute('data-lcos-variant')).toBe(state);
      expect(el.querySelectorAll('[data-lcos-nav-part="search"]')).toHaveLength(1);
      const isSearch = state === '搜索';
      expect(el.querySelectorAll('[data-lcos-nav-part="input"]')).toHaveLength(isSearch ? 1 : 0);
      // Figma 尺寸：静息 52（宽 hug）＝ pad8 + 键 36 + pad8；搜索 402 = 36+210+36×3+gap8×4+pad16
      expect(el.querySelectorAll('[data-lcos-pin-mark]')).toHaveLength(isSearch || state === '彩色标' ? 3 : 0);
      const searchBtn = el.querySelector<HTMLButtonElement>('[data-lcos-nav-part="search"]');
      expect(searchBtn?.disabled).toBe(state === 'disabled');
    }
  });

  it('Railway 目的地数量即变体轴（1 / 4）', () => {
    const one = render(
      <LcosRailwayView items={[{ key: 'main', label: '主', icon: () => <span />, selected: true }]} />,
    ).querySelector('[data-lcos-family="railway"]');
    expect(one?.getAttribute('data-lcos-variant-count')).toBe('1');
    expect(one?.getAttribute('style')).toContain('height: 52px');

    const four = render(
      <LcosRailwayView
        items={[
          { key: 'a', label: 'a', icon: () => <span />, selected: true },
          { key: 'b', label: 'b', icon: () => <span /> },
          { key: 'c', label: 'c', icon: () => <span /> },
          { key: 'd', label: 'd', icon: () => <span />, disabled: true },
        ]}
      />,
    ).querySelector('[data-lcos-family="railway"]');
    expect(four?.getAttribute('data-lcos-variant-count')).toBe('4');
    expect(four?.getAttribute('style')).toContain('height: 178px');
    expect(four?.querySelectorAll('[data-lcos-railway-item]')).toHaveLength(4);
    expect(four?.querySelector('[data-lcos-railway-item="a"]')?.getAttribute('data-lcos-variant')).toBe('selected');
    expect(four?.querySelector<HTMLButtonElement>('[data-lcos-railway-item="d"]')?.disabled).toBe(true);
  });

  it('ProfessionalWindowChrome 覆盖 浮动/停靠/分组，并渲染窗口标题与 tab', () => {
    for (const layout of WINDOW_LAYOUTS) {
      const el = render(<LcosWindowChrome layout={layout} title="阅读 · 创意简报" />);
      const root = el.querySelector('[data-lcos-family="window-chrome"]');
      expect(root?.getAttribute('data-lcos-variant')).toBe(layout);
      expect(el.querySelector('[data-lcos-window-title]')?.textContent).toBe('阅读 · 创意简报');
    }
    const withTabs = render(
      <LcosWindowChrome
        layout="浮动"
        title="阅读"
        tabs={[
          { key: 'reader', value: 'w1', label: '阅读', selected: true },
          { key: 'assembly', value: 'w2', label: 'Assembly' },
        ]}
      />,
    );
    expect(withTabs.querySelectorAll('[data-lcos-window-tab]')).toHaveLength(2);
    expect(withTabs.querySelector('[data-lcos-window-tab="reader"]')?.getAttribute('data-lcos-window-tab-value')).toBe('w1');
  });

  it('SurfaceFeedback 覆盖 Figma 7 呈现', () => {
    for (const presentation of FEEDBACK) {
      const el = render(<LcosSurfaceFeedback presentation={presentation as 'loading'} />);
      const root = el.querySelector('[data-lcos-family="surface-feedback"]');
      expect(root?.getAttribute('data-lcos-variant')).toBe(presentation);
    }
  });

  it('Collection 覆盖 组织×呈现 六组合 + 工作流跨视图三组合', () => {
    const combos = [
      ['事情', '总览'],
      ['事情', '主画布'],
      ['事情', '装配'],
      ['时间', '总览'],
      ['时间', '主画布'],
      ['时间', '装配'],
    ] as const;
    for (const [organize, rendition] of combos) {
      const el = render(
        <LcosCollectionSurface organize={organize} rendition={rendition} title="集合" />,
      );
      const root = el.querySelector('[data-lcos-family="collection-surface"]');
      expect(root?.getAttribute('data-lcos-organize')).toBe(organize);
      expect(root?.getAttribute('data-lcos-rendition')).toBe(rendition);
    }
    for (const rendition of ['工作流现场', '主画布', '装配'] as const) {
      const el = render(<LcosCollectionSurface organize="事情" rendition={rendition} title="工作流集合" />);
      expect(
        el.querySelector('[data-lcos-family="collection-surface"]')?.getAttribute('data-lcos-rendition'),
      ).toBe(rendition);
    }
  });

  it('TaskCard 覆盖 Figma 7 状态（已选目标 / 草稿中 / 不可用 等）', () => {
    for (const state of TASK_STATES) {
      const el = render(<LcosTaskCard state={state} title="创意简报 v3" meta="材料" />);
      const root = el.querySelector('[data-lcos-family="task-card"]');
      expect(root?.getAttribute('data-lcos-variant')).toBe(state);
    }
  });

  it('Portal 覆盖 Figma 6 状态；目标缺失给真实解释而不是空白', () => {
    for (const state of PORTAL_STATES) {
      const el = render(<LcosPortalPreview state={state} title="入口目标预览" />);
      const root = el.querySelector('[data-lcos-family="portal-preview"]');
      expect(root?.getAttribute('data-lcos-variant')).toBe(state);
    }
    const missing = render(<LcosPortalPreview state="目标缺失" title="入口目标预览" />);
    expect(missing.textContent).toContain('没有可解析的目标');
  });

  it('原生 canvasRef 节点 → portal 物种 body（Portal 族的生产入口可达）', () => {
    const seam = createLcosNodePresentationSeam();
    // 无 Core 绑定的原生 Portal 节点也必须能解析出 body（否则 Portal 族永不可达）
    expect(seam.resolve({ nodeId: 'n-portal', nodeType: 'canvasRef', data: { targetCanvasId: 'c-1' } })).toBeDefined();
    // 非 portal 的原生节点仍然诚实回退到 native（不误判物种）
    expect(seam.resolve({ nodeId: 'n-note', nodeType: 'note', data: {} })).toBeUndefined();
  });
});
