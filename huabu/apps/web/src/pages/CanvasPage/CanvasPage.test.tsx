import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCanvas: vi.fn(),
  switchCanvas: vi.fn(),
  navigate: vi.fn(),
  state: {
    canvasId: 'source',
    isLoading: false,
    canvasNotFound: false,
    canvasLoadFailure: null as { canvasId: string; kind: 'not-found' | 'error'; message: string } | null,
    nodes: [],
  },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({
  useParams: () => ({ canvasId: 'target' }),
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/canvas/target', search: '', hash: '', state: null }),
  Link: ({ children }: { children: ReactNode }) => <a href="/spaces">{children}</a>,
}));
vi.mock('../../store/canvasStore', () => {
  const useStore = (selector: (state: typeof mocks.state & { loadCanvas: typeof mocks.loadCanvas; switchCanvas: typeof mocks.switchCanvas }) => unknown) =>
    selector({ ...mocks.state, loadCanvas: mocks.loadCanvas, switchCanvas: mocks.switchCanvas });
  return { default: useStore, dismissVersionConflictToast: vi.fn() };
});
vi.mock('../../store/canvasSyncStore', () => ({ useCanvasSyncStore: (selector: (state: { connect: () => void; disconnect: () => void }) => unknown) => selector({ connect: vi.fn(), disconnect: vi.fn() }) }));
vi.mock('../../store/workspaceStore', () => ({ useWorkspaceStore: (selector: (state: { worldCanvasId: null; refreshSpaceTitles: () => Promise<void> }) => unknown) => selector({ worldCanvasId: null, refreshSpaceTitles: vi.fn(async () => undefined) }) }));
vi.mock('../../store/toolStore', () => ({ useToolStore: (selector: (state: { setPendingNodeType: Mock }) => unknown) => selector({ setPendingNodeType: vi.fn() }) }));
vi.mock('../../store/shortcutsUiStore', () => ({ useShortcutsUiStore: (selector: (state: { isOpen: boolean; open: Mock }) => unknown) => selector({ isOpen: false, open: vi.fn() }) }));
vi.mock('../../hooks/useGlobalSearchHotkey', () => ({ useGlobalSearchHotkey: vi.fn() }));
vi.mock('../../store/canvasAttentionStore', () => ({ useTrackCanvasAttention: vi.fn() }));
vi.mock('../../store/previewWorkspace/actions', () => ({ openPreviewNode: vi.fn() }));
vi.mock('../../components/Common/Loading', () => ({ Loading: () => <div>loading</div> }));
vi.mock('../../components/Common/Toast', () => ({ toast: vi.fn() }));
vi.mock('../../components/Panels/CanvasLayerPanel', () => ({ CanvasLayerPanel: () => null }));
vi.mock('../../components/Panels/Header/CanvasHeader.tsx', () => ({ CanvasHeader: () => null }));
vi.mock('../../components/Panels/PreviewWorkspace/PreviewWorkspacePanel', () => ({ PreviewWorkspacePanel: () => null }));
vi.mock('@/pages/CanvasPage/CenterArea.tsx', () => ({ CenterArea: () => <div>canvas</div> }));
vi.mock('@/pages/CanvasPage/MainLayout.tsx', () => ({ MainLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

import CanvasPage from './CanvasPage';

import type { ReactNode } from 'react';
import type { Mock } from 'vitest';

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  mocks.state.canvasLoadFailure = null;
  mocks.state.canvasNotFound = false;
  mocks.loadCanvas.mockReset();
  mocks.switchCanvas.mockReset();
});

it('matches failures to the route and does not show another canvas error', async () => {
  mocks.state.canvasLoadFailure = { canvasId: 'other', kind: 'error', message: 'offline' };
  const host = document.createElement('div');
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<CanvasPage />));
  expect(host.textContent).toContain('loading');
  expect(host.textContent).not.toContain('画布加载失败');
});

it('shows a matching read error and retries through switchCanvas', async () => {
  mocks.state.canvasLoadFailure = { canvasId: 'target', kind: 'error', message: 'offline' };
  const host = document.createElement('div');
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<CanvasPage />));
  expect(host.textContent).toContain('offline');
  const retry = host.querySelector('button');
  expect(retry).not.toBeNull();
  await act(async () => retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(mocks.switchCanvas).toHaveBeenCalledWith('target');
});
