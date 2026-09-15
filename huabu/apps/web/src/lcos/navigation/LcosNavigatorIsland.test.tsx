import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { LcosNavigatorIsland } from './LcosNavigatorIsland';

const search = vi.hoisted(() => vi.fn());
const requestLocate = vi.hoisted(() => vi.fn());
const nodeEntityRefs = vi.hoisted(() => new Map<string, { entityId: string; entityType: string }>());
const canvasNodes = vi.hoisted(() => [] as Array<{ id: string }>);
const navigation = vi.hoisted(() => ({ switchWorksite: vi.fn(), wait: vi.fn() }));
vi.mock('../app/useLcosWorksiteNav', () => ({ useLcosWorksiteNav: () => ({ switchWorksite: navigation.switchWorksite }) }));
vi.mock('./waitForProjectedEntity', () => ({ waitForProjectedEntity: navigation.wait }));
vi.mock('@local-creative-os/web-gen2', () => ({
  CoreSearchClient: class { searchProject = search; },
  HttpError: class extends Error {},
}));
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));
vi.mock('../lcosReferenceState', () => ({ useLcosReferenceStore: { getState: () => ({ nodeEntityRefs }) } }));
vi.mock('../shell/lcosShellStore', () => ({
  useLcosShellStore: (selector: (state: { activeSurface: string; requestLocate: typeof requestLocate }) => unknown) =>
    selector({ activeSurface: 'main', requestLocate }),
}));
vi.mock('@/store/canvasStore', () => ({ default: { getState: () => ({ nodes: canvasNodes, canvasId: 'canvas-context' }) } }));

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  search.mockReset();
  requestLocate.mockReset();
  nodeEntityRefs.clear();
  canvasNodes.length = 0;
  navigation.switchWorksite.mockReset(); navigation.wait.mockReset();
});

async function chooseCrossLocation() {
  vi.useFakeTimers();
  search.mockResolvedValue({ hits: [{ entityType: 'artifact', entityId: 'cross-object', title: '跨现场材料', locationRefs: [{ kind: 'workspace', id: 'ws-context', name: '研究现场' }] }] });
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<LcosNavigatorIsland projectId="p" canvasBySurface={{ context: 'canvas-context' }} surfaceByWorkspace={new Map([['ws-context', 'context']])} ensureCanvas={async () => undefined} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
  const input = container.querySelector('input');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!input || !setter) throw new Error('Input missing');
  await act(async () => { setter.call(input, '材料'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => vi.advanceTimersByTime(300));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-lcos-navigator-results] button')?.click());
  const destination = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('前往并定位'));
  if (!destination) throw new Error('Explicit destination missing');
  await act(async () => destination.click());
  return container;
}

it('switches the explicit workspace then locates its real projected node', async () => {
  navigation.switchWorksite.mockResolvedValue(true);
  navigation.wait.mockResolvedValue('cross-node');
  const container = await chooseCrossLocation();
  expect(navigation.switchWorksite).toHaveBeenCalledExactlyOnceWith('context');
  expect(navigation.wait).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p', canvasId: 'canvas-context', entityId: 'cross-object' }));
  expect(requestLocate).toHaveBeenCalledWith(expect.objectContaining({ surface: 'context', canvasId: 'canvas-context', nodeId: 'cross-node' }));
  expect(container.querySelector('input')).toBeNull();
});

it('keeps search and the destination available when projection has not arrived', async () => {
  navigation.switchWorksite.mockResolvedValue(true); navigation.wait.mockResolvedValue(undefined);
  const container = await chooseCrossLocation();
  expect(requestLocate).not.toHaveBeenCalled();
  expect(container.querySelector('input')).not.toBeNull();
  expect(container.textContent).toContain('投影尚未就绪');
});

it('ignores a late arrival after Escape closes the search', async () => {
  navigation.switchWorksite.mockResolvedValue(true);
  let finish: (id: string) => void = () => {};
  navigation.wait.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const container = await chooseCrossLocation();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await act(async () => finish('late-node'));
  expect(requestLocate).not.toHaveBeenCalled();
  expect(container.querySelector('input')).toBeNull();
});

it('keeps search editable while empty, loading and failed, and closes with Escape', async () => {
  vi.useFakeTimers();
  let rejectSearch: (reason: Error) => void = () => {};
  search.mockImplementation(() => new Promise((_, reject) => { rejectSearch = reject; }));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<LcosNavigatorIsland projectId="p" canvasBySurface={{}} ensureCanvas={async () => undefined} />));
  const toggle = container.querySelector<HTMLButtonElement>('button');
  if (!toggle) throw new Error('Search toggle missing');
  await act(async () => toggle.click());
  const input = container.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error('Search input missing');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setValue) throw new Error('Input setter missing');
  await act(async () => {
    setValue.call(input, '山');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(300));
  expect(search).toHaveBeenCalled();
  expect(container.querySelector('input')).toBe(input);
  await act(async () => rejectSearch(new Error('offline')));
  expect(container.querySelector('input')).toBe(input);
  expect(input.value).toBe('山');
  expect(container.textContent).toContain('搜索失败');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(container.querySelector('input')).toBeNull();
});

it('restores the resting island after locating a projected search result', async () => {
  vi.useFakeTimers();
  nodeEntityRefs.set('node-1', { entityId: 'entity-1', entityType: 'artifact' });
  canvasNodes.push({ id: 'node-1' });
  search.mockResolvedValue({
    hits: [{ entityType: 'artifact', entityId: 'entity-1', title: '参考稿', snippet: '', source: 'title', score: 1 }],
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<LcosNavigatorIsland projectId="p" canvasBySurface={{}} ensureCanvas={async () => undefined} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
  const input = container.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error('Search input missing');
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setValue) throw new Error('Input setter missing');
    setValue.call(input, '参考');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(300));
  await act(async () => Promise.resolve());
  const result = container.querySelector<HTMLButtonElement>('[data-lcos-navigator-results] button');
  if (!result) throw new Error('Search result missing');
  await act(async () => result.click());
  expect(requestLocate).toHaveBeenCalledWith(expect.objectContaining({ surface: 'main', nodeId: 'node-1', status: 'projected' }));
  expect(container.querySelector('input')).toBeNull();
  expect(container.querySelector('[data-lcos-navigator-results]')).toBeNull();
});

it('keeps search open when a binding is stale and the node is gone from the current canvas', async () => {
  vi.useFakeTimers();
  nodeEntityRefs.set('stale-node', { entityId: 'entity-1', entityType: 'artifact' });
  search.mockResolvedValue({
    hits: [{ entityType: 'artifact', entityId: 'entity-1', title: '已移除节点', snippet: '', source: 'title', score: 1 }],
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<LcosNavigatorIsland projectId="p" canvasBySurface={{}} ensureCanvas={async () => undefined} />));
  await act(async () => container.querySelector<HTMLButtonElement>('button')?.click());
  const input = container.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error('Search input missing');
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!setValue) throw new Error('Input setter missing');
    setValue.call(input, '已移除');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => vi.advanceTimersByTime(300));
  await act(async () => Promise.resolve());
  const result = container.querySelector<HTMLButtonElement>('[data-lcos-navigator-results] button');
  if (!result) throw new Error('Search result missing');
  await act(async () => result.click());
  expect(requestLocate).not.toHaveBeenCalled();
  expect(container.querySelector('input')).toBe(input);
  expect(container.textContent).toContain('尚无可定位的位置');
});
