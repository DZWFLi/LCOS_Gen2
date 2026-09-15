import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { useLcosWorksiteNav } from './useLcosWorksiteNav';

import type { WorksiteNavHandle } from './useLcosWorksiteNav';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), switchCanvas: vi.fn(), setActiveSurface: vi.fn(),
  canvasLoadFailure: null as { canvasId: string; kind: 'error' | 'not-found'; message: string } | null,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/store/canvasStore', () => ({ default: { getState: () => mocks } }));
vi.mock('../shell/lcosShellStore', () => ({
  useLcosShellStore: Object.assign(
    (select: (s: { setActiveSurface: typeof mocks.setActiveSurface }) => unknown) => select(mocks),
    { getState: () => ({ activeSurface: 'main' }) },
  ),
}));

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.clearAllMocks();
  mocks.canvasLoadFailure = null;
});

it('serializes same-turn navigation and releases the lock after failure', async () => {
  let fail: (error: Error) => void = () => {};
  mocks.switchCanvas.mockImplementationOnce(() => new Promise<void>((_, reject) => { fail = reject; }));
  let handle: WorksiteNavHandle | undefined;
  function Probe() {
    handle = useLcosWorksiteNav({ projectId: 'p', canvasBySurface: { main: 'm', context: 'c', workflow: 'w' }, ensureCanvas: async () => undefined });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  await act(async () => { root.render(<Probe />); });
  if (!handle) throw new Error('Navigation hook did not mount');
  const nav = handle;
  await act(async () => {
    const first = nav.switchWorksite('context');
    expect(await nav.switchWorksite('workflow')).toBe(false);
    expect(mocks.switchCanvas).toHaveBeenCalledTimes(1);
    fail(new Error('offline'));
    expect(await first).toBe(false);
  });
  expect(mocks.navigate).not.toHaveBeenCalled();
  mocks.switchCanvas.mockResolvedValueOnce(true);
  await act(async () => { expect(await nav.switchWorksite('workflow')).toBe(true); });
  expect(mocks.switchCanvas).toHaveBeenLastCalledWith('w');
  expect(mocks.navigate).toHaveBeenCalledWith('/projects/p/workflow', { replace: true });
});

it('does not navigate back to a project after its pending canvas switch completes', async () => {
  let finish: () => void = () => {};
  mocks.switchCanvas.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  let handle: WorksiteNavHandle | undefined;
  function Probe({ projectId }: { projectId: string }) {
    handle = useLcosWorksiteNav({ projectId, canvasBySurface: { context: 'c' }, ensureCanvas: async () => undefined });
    return null;
  }
  const root = createRoot(document.createElement('div')); roots.push(root);
  await act(async () => root.render(<Probe projectId="a" />));
  let pending: Promise<boolean> | undefined;
  await act(async () => { pending = handle?.switchWorksite('context'); });
  await act(async () => root.render(<Probe projectId="b" />));
  await act(async () => { finish(); expect(await pending).toBe(false); });
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(mocks.setActiveSurface).not.toHaveBeenCalled();
});

it('keeps the current route when the loader resolves false and exposes its real failure', async () => {
  mocks.switchCanvas.mockResolvedValueOnce(false);
  mocks.canvasLoadFailure = { canvasId: 'c', kind: 'error', message: '连接已断开' };
  let handle: WorksiteNavHandle | undefined;
  function Probe() {
    handle = useLcosWorksiteNav({ projectId: 'p', canvasBySurface: { context: 'c' }, ensureCanvas: async () => undefined });
    return null;
  }
  const root = createRoot(document.createElement('div')); roots.push(root);
  await act(async () => root.render(<Probe />));
  await act(async () => { expect(await handle?.switchWorksite('context')).toBe(false); });
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(handle?.transitionError).toBe('连接已断开');
  expect(mocks.setActiveSurface).not.toHaveBeenCalledWith('context');
});
