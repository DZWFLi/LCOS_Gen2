import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LcosSpatialNavigator } from './LcosSpatialNavigator';
import { useLcosShellStore } from '../shell/lcosShellStore';

import type { CanvasSpatialNavigatorControls } from '@/lcos-seam/types';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const callbacks = () => ({
  toggleInteractivity: vi.fn(),
  toggleMinimap: vi.fn(),
  toggleGrid: vi.fn(),
  toggleEdges: vi.fn(),
});

describe('LcosSpatialNavigator', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    useLcosShellStore.setState({ cameraRequest: null });
  });

  async function render(overrides: Partial<CanvasSpatialNavigatorControls> = {}) {
    const controls = callbacks();
    let props: CanvasSpatialNavigatorControls = {
      zoom: 0.72,
      minimapEnabled: true,
      gridEnabled: true,
      edgesVisible: false,
      interactivityLocked: false,
      miniMap: <div data-test-minimap>map</div>,
      ...controls,
      ...overrides,
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<LcosSpatialNavigator {...props} />));
    const element = host.querySelector<HTMLElement>('[data-lcos-spatial-navigator]');
    if (!element) throw new Error('spatial navigator missing');
    return { element, controls, rerender: async (updates: Partial<CanvasSpatialNavigatorControls>) => {
      props = { ...props, ...updates };
      await act(async () => root?.render(<LcosSpatialNavigator {...props} />));
    }};
  }

  it('opens as a compact camera toolbar without forcing the minimap owner on', async () => {
    const { element, controls } = await render({ minimapEnabled: false, miniMap: null });
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="打开空间导航"]')?.click());
    expect(element.dataset.lcosExpanded).toBe('true');
    expect(element.dataset.lcosMapExpanded).toBe('false');
    expect(element.querySelector('[data-lcos-spatial-navigator-map]')).toBeNull();
    expect(controls.toggleMinimap).not.toHaveBeenCalled();
    expect(element.querySelector('[data-lcos-spatial-navigator-zoom]')?.textContent).toBe('72%');
  });

  it('reveals the map only on explicit request and enables Huabu minimap if needed', async () => {
    const { element, controls, rerender } = await render({ minimapEnabled: false, miniMap: null });
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="打开空间导航"]')?.click());
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="展开小地图"]')?.click());
    expect(element.dataset.lcosMapExpanded).toBe('true');
    expect(controls.toggleMinimap).toHaveBeenCalledOnce();
    await rerender({ minimapEnabled: true, miniMap: <div data-test-minimap>map</div> });
    expect(element.querySelector('[data-test-minimap]')?.textContent).toBe('map');
  });

  it('does not rewrite an already enabled minimap preference', async () => {
    const { element, controls } = await render({ minimapEnabled: true });
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="打开空间导航"]')?.click());
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="展开小地图"]')?.click());
    expect(element.querySelector('[data-test-minimap]')?.textContent).toBe('map');
    expect(controls.toggleMinimap).not.toHaveBeenCalled();
  });

  it('dispatches Huabu-owned camera and presentation controls without a second owner', async () => {
    const { element, controls } = await render({ interactivityLocked: true });
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="打开空间导航"]')?.click());
    for (const [label, kind] of [['缩小','zoom-out'],['放大','zoom-in'],['适合画面','fit']] as const) {
      await act(async () => element.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click());
      expect(useLcosShellStore.getState().cameraRequest?.kind).toBe(kind);
    }
    await act(async () => element.querySelector<HTMLButtonElement>('[data-lcos-spatial-navigator-zoom]')?.click());
    expect(useLcosShellStore.getState().cameraRequest?.kind).toBe('reset');
    for (const label of ['解锁画布','隐藏网格','显示连线']) {
      await act(async () => element.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.click());
    }
    expect(controls.toggleInteractivity).toHaveBeenCalledOnce();
    expect(controls.toggleGrid).toHaveBeenCalledOnce();
    expect(controls.toggleEdges).toHaveBeenCalledOnce();
  });

  it('Escape closes the map first, then the compact toolbar', async () => {
    const { element } = await render();
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="打开空间导航"]')?.click());
    await act(async () => element.querySelector<HTMLButtonElement>('[aria-label="展开小地图"]')?.click());
    const mapButton = element.querySelector<HTMLButtonElement>('[aria-label="收起小地图"]');
    if (!mapButton) throw new Error('map button missing');
    await act(async () => mapButton.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    expect(element.dataset.lcosExpanded).toBe('true');
    expect(element.dataset.lcosMapExpanded).toBe('false');
    const collapse = element.querySelector<HTMLButtonElement>('[aria-label="收起空间导航"]');
    if (!collapse) throw new Error('collapse button missing');
    await act(async () => collapse.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true})));
    expect(element.dataset.lcosExpanded).toBe('false');
  });
});
