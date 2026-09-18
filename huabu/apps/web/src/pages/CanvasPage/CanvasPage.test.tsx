// Wave 1 行为验收（正本 `04` Wave 1 + `appendices\B` + HUABU_RETIREMENT_LEDGER 第 11 行）：
// `CanvasPage` 不再渲染旧三栏壳，而是解析 canonical 归属后把渲染交给唯一 LCOS Shell；
// 它自己只保留一次性 intent（新建画布默认工具 / 指定节点预览）。

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  binding: { kind: 'resolving' } as { kind: string; projectId?: string; workspaceId?: string; surface?: string; message?: string },
  routeProps: [] as Record<string, unknown>[],
  navigate: vi.fn(),
  location: {
    pathname: '/canvas/target',
    search: '',
    hash: '',
    state: null as unknown,
  },
  state: {
    canvasId: 'target',
    isLoading: false,
    canvasNotFound: false,
    nodes: [] as { id: string }[],
  },
  setPendingNodeType: vi.fn(),
  openPreviewNode: vi.fn(),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ canvasId: 'target' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => mocks.location,
  Link: ({ children }: { children: ReactNode }) => <a href="/projects">{children}</a>,
  Navigate: () => null,
}));
vi.mock('../../store/canvasStore', () => {
  const useStore = (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state);
  Object.assign(useStore, { getState: () => mocks.state });
  return { default: useStore, dismissVersionConflictToast: vi.fn() };
});
vi.mock('../../store/workspaceStore', () => ({
  useWorkspaceStore: (selector: (state: { worldCanvasId: null; refreshSpaceTitles: () => Promise<void> }) => unknown) =>
    selector({ worldCanvasId: null, refreshSpaceTitles: vi.fn(async () => undefined) }),
}));
vi.mock('../../store/toolStore', () => ({
  useToolStore: (selector: (state: { setPendingNodeType: typeof mocks.setPendingNodeType }) => unknown) =>
    selector({ setPendingNodeType: mocks.setPendingNodeType }),
}));
vi.mock('../../store/canvasAttentionStore', () => ({ useTrackCanvasAttention: vi.fn() }));
vi.mock('../../store/previewWorkspace/actions', () => ({ openPreviewNode: mocks.openPreviewNode }));
vi.mock('../../components/Common/Loading', () => ({ Loading: () => <div>loading</div> }));
vi.mock('../../components/Common/Toast', () => ({ toast: vi.fn() }));
vi.mock('../../lcos/app/useLcosCanvasBinding', () => ({ useLcosCanvasBinding: () => mocks.binding }));
vi.mock('../../lcos/app/LcosProjectRoute', () => ({
  LcosProjectRoute: (props: Record<string, unknown>) => {
    mocks.routeProps.push(props);
    return <div data-testid="lcos-project-route" />;
  },
}));

import CanvasPage from './CanvasPage';

const roots: ReturnType<typeof createRoot>[] = [];

beforeEach(() => {
  mocks.binding = { kind: 'resolving' };
  mocks.routeProps.length = 0;
  mocks.location = { pathname: '/canvas/target', search: '', hash: '', state: null };
  mocks.state.canvasId = 'target';
  mocks.state.isLoading = false;
  mocks.state.canvasNotFound = false;
  mocks.state.nodes = [];
  mocks.navigate.mockReset();
  mocks.setPendingNodeType.mockReset();
  mocks.openPreviewNode.mockReset();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

async function renderPage(): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<CanvasPage />));
  return host;
}

it('resolved 归属下把渲染交给唯一 LCOS Shell，且不再渲染旧三栏壳', async () => {
  mocks.binding = { kind: 'resolved', projectId: 'p1', workspaceId: 'w1', surface: 'main' };
  const host = await renderPage();
  expect(host.querySelector('[data-testid="lcos-project-route"]')).not.toBeNull();
  expect(mocks.routeProps.at(-1)).toEqual({
    projectIdOverride: 'p1',
    workspaceIdOverride: 'w1',
    surfaceOverride: 'main',
  });
  expect(host.textContent).not.toContain('loading');
});

it('未绑定项目时诚实展示，不伪造项目也不回落旧壳', async () => {
  mocks.binding = { kind: 'unbound' };
  const host = await renderPage();
  expect(host.querySelector('[data-lcos-canvas-binding="unbound"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="lcos-project-route"]')).toBeNull();
});

it('解析中显示加载态', async () => {
  mocks.binding = { kind: 'resolving' };
  const host = await renderPage();
  expect(host.textContent).toContain('loading');
  expect(host.querySelector('[data-testid="lcos-project-route"]')).toBeNull();
});

it('消费 newCanvasPlacement 一次性 intent：清 state，并在匹配画布加载完成后 arm 默认工具', async () => {
  mocks.binding = { kind: 'resolved', projectId: 'p1', workspaceId: 'w1', surface: 'main' };
  mocks.location = {
    ...mocks.location,
    state: { newCanvasPlacement: { canvasId: 'target', nodeType: 'note' } },
  };
  await renderPage();
  expect(mocks.navigate).toHaveBeenCalledWith('/canvas/target', { replace: true, state: null });
  expect(mocks.setPendingNodeType).toHaveBeenCalledWith('note');
});

it('消费 previewNode 一次性 intent：匹配画布加载完成且节点存在时打开预览', async () => {
  mocks.binding = { kind: 'resolved', projectId: 'p1', workspaceId: 'w1', surface: 'main' };
  mocks.state.nodes = [{ id: 'n1' }];
  mocks.location = {
    ...mocks.location,
    state: { previewNode: { canvasId: 'target', nodeId: 'n1' } },
  };
  await renderPage();
  expect(mocks.openPreviewNode).toHaveBeenCalledWith('n1');
});