import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { ApiError } from '@/api/_client';

import { PortalPreviewBody } from './PortalPreviewBody';

import type { SpacePreviewSceneSnapshot } from '@/store/spacePreviewSceneCache';
import type { GetSpacePreviewSceneResponse } from '@huabu/shared';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), retry: vi.fn(), camera: vi.fn() }));
vi.mock('@/store/spacePreviewSceneCache', () => ({ useSpacePreviewScene: mocks.preview }));
vi.mock('@/store/canvasStore', () => ({ default: (select: (s: { canvasId: string; setViewport: typeof mocks.camera }) => unknown) => select({ canvasId: 'canvas-main', setViewport: mocks.camera }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const scene: GetSpacePreviewSceneResponse = {
  canvasId: 'canvas-target', title: '目标现场', version: 1,
  bounds: { x: 0, y: 0, width: 400, height: 240 },
  nodes: [{ id: 'node-text', kind: 'content', x: 0, y: 0, width: 100, height: 100, previewText: '真实预览正文' }],
  edges: [], truncated: { nodes: false, edges: false },
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.clearAllMocks();
});
async function render(snapshot: SpacePreviewSceneSnapshot) {
  mocks.preview.mockReturnValue({ ...snapshot, retry: mocks.retry });
  await act(async () => root.render(<PortalPreviewBody projectId="p" target="canvas-target" targetKind="canvas" />));
}
function variant() { return host.querySelector('[data-lcos-family="portal-preview"]')?.getAttribute('data-lcos-variant'); }

it('does not reinterpret untyped entity ids as canvas addresses', async () => {
  await act(async () => root.render(<PortalPreviewBody projectId="p" target="canvas-looking-entity" />));
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(variant()).toBe('目标缺失');
});

it('renders the existing viewport and zooms locally without moving Main', async () => {
  await render({ scene, loading: false, stale: false, error: null });
  expect(variant()).toBe('可预览');
  expect(host.textContent).toContain('真实预览正文');
  const viewport = host.querySelector('[aria-label="spacePreview.viewport"]');
  const svg = viewport?.querySelector('svg');
  if (!viewport || !svg) throw new Error('Real preview viewport missing');
  const before = svg.getAttribute('viewBox');
  await act(async () => { viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true })); });
  expect(svg.getAttribute('viewBox')).not.toBe(before);
  expect(mocks.camera).not.toHaveBeenCalled();
});

it('derives loading, partial, cached, failure and missing states from the donor snapshot', async () => {
  await render({ scene: null, loading: true, stale: false, error: null }); expect(variant()).toBe('加载中');
  await render({ scene: { ...scene, truncated: { nodes: true, edges: false } }, loading: false, stale: false, error: null }); expect(variant()).toBe('部分预览');
  await render({ scene, loading: false, stale: true, error: new Error('offline') }); expect(variant()).toBe('旧缓存');
  expect(host.textContent).toContain('真实预览正文');
  const retry = [...host.querySelectorAll('button')].find((button) => button.textContent === '重试');
  if (!retry) throw new Error('Retry missing');
  await act(async () => retry.click()); expect(mocks.retry).toHaveBeenCalledOnce();
  await render({ scene: null, loading: false, stale: false, error: new Error('offline') }); expect(variant()).toBe('预览失败');
  await render({ scene, loading: false, stale: true, error: new ApiError(404, {}, 'missing') }); expect(variant()).toBe('目标缺失');
  expect(host.querySelector('[data-lcos-real-portal-preview]')).toBeNull();
});
