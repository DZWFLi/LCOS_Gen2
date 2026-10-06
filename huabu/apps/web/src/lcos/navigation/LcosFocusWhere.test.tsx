import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { LcosFocusWhere } from './LcosFocusWhere';

import type * as WebGen2 from '@local-creative-os/web-gen2';
const mocks = vi.hoisted(() => ({ list: vi.fn(), workspaces: vi.fn(), requestLocate: vi.fn(), switchWorksite: vi.fn(), wait: vi.fn(),
  focusWhereRequest: undefined as { reqId: string; entityId: string; entityType: string; title?: string } | undefined,
  consumeFocusWhere: vi.fn(),
  refs: new Map<string, { entityId: string; entityType: string }>(),
  canvas: { canvasId: 'current', nodes: [] as Array<{ id: string; selected?: boolean }> } }));
vi.mock('@local-creative-os/web-gen2', async (original) => ({ ...await original<typeof WebGen2>(), SqliteBindingStore: class { list = mocks.list; } }));
vi.mock('./waitForProjectedEntity', () => ({ waitForProjectedEntity: mocks.wait }));
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {}, projects: { getWorkspaces: mocks.workspaces } }) }));
vi.mock('../app/useLcosWorksiteNav', () => ({ useLcosWorksiteNav: () => ({ switchWorksite: mocks.switchWorksite }) }));
vi.mock('../lcosReferenceState', () => ({ useLcosReferenceStore: { getState: () => ({ nodeEntityRefs: mocks.refs }) } }));
vi.mock('@/store/canvasStore', () => ({ default: { getState: () => mocks.canvas } }));
vi.mock('../shell/lcosShellStore', () => ({ SURFACE_LABEL: { main: '主画布' }, useLcosShellStore: (select: (s: unknown) => unknown) => select({
  activeSurface: 'main', windowEnvironment: null, requestLocate: mocks.requestLocate,
  focusWhereRequest: mocks.focusWhereRequest, consumeFocusWhere: mocks.consumeFocusWhere,
}) }));
const roots: ReturnType<typeof createRoot>[] = [];
const mounted = new Map<HTMLElement, ReturnType<typeof createRoot>>();
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  mounted.clear(); document.body.replaceChildren(); vi.resetAllMocks(); mocks.refs.clear(); mocks.canvas.nodes = []; mocks.canvas.canvasId = 'current'; mocks.focusWhereRequest = undefined;
});
function view(projectId: string): React.JSX.Element {
  return <LcosFocusWhere projectId={projectId} canvasBySurface={{ context: 'root-context' }} surfaceByWorkspace={new Map()} ensureCanvas={async () => undefined} />;
}
async function render(options: { readonly projectId?: string; readonly request?: { reqId: string; entityId: string; entityType: string; title?: string }; readonly openWithKeyboard?: boolean } = {}) {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); roots.push(root);
  mocks.refs.set('selected', { entityId: 'a', entityType: 'artifact' }); mocks.canvas.nodes.push({ id: 'selected', selected: true });
  mocks.focusWhereRequest = options.request;
  mounted.set(container, root);
  await act(async () => root.render(view(options.projectId ?? 'p')));
  if (options.openWithKeyboard !== false) await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })));
  return container;
}
async function rerenderProject(container: HTMLElement, projectId: string): Promise<void> {
  const root = mounted.get(container);
  if (!root) throw new Error('root not mounted');
  await act(async () => root.render(view(projectId)));
}
function required<T extends Element>(container: ParentNode, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector}`);
  return element;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred value was not initialized'); };
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
it.each([false, true])('keeps exact child workspace and projection, cancellation=%s', async (cancel) => {
  mocks.list.mockResolvedValue([{ projectId: 'p', entityId: 'a', entityType: 'artifact', spatialKind: 'node', spatialId: 'exact-second', canvasId: 'child-canvas' }]);
  mocks.workspaces.mockResolvedValue([{ id: 'child', canvasId: 'child-canvas', preferredSurface: 'context', name: '子现场' }]);
  mocks.switchWorksite.mockImplementation(async () => { mocks.canvas.canvasId = 'child-canvas'; return true; });
  let finish: (value: string) => void = () => {};
  mocks.wait.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const container = await render();
  await act(async () => required<HTMLButtonElement>(container, '[data-lcos-occurrence="exact-second"]').click());
  expect(mocks.switchWorksite).toHaveBeenCalledExactlyOnceWith('context', { canvasId: 'child-canvas', workspaceId: 'child' });
  expect(mocks.wait).toHaveBeenCalledWith(expect.objectContaining({ canvasId: 'child-canvas', nodeId: 'exact-second' }));
  if (cancel) await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await act(async () => finish('exact-second'));
  if (cancel) expect(mocks.requestLocate).not.toHaveBeenCalled();
  else expect(mocks.requestLocate).toHaveBeenCalledWith(expect.objectContaining({ canvasId: 'child-canvas', nodeId: 'exact-second', preserveSelection: true }));
});
it('does not substitute another projection of the same entity', async () => {
  mocks.list.mockResolvedValue([]); mocks.workspaces.mockResolvedValue([]); mocks.wait.mockResolvedValue('wrong-node');
  const container = await render();
  await act(async () => required<HTMLButtonElement>(container, '[data-lcos-occurrence="selected"]').click());
  expect(mocks.requestLocate).not.toHaveBeenCalled(); expect(container.textContent).toContain('所选投影尚未就绪');
});
it('does not reopen on late bindings after Escape', async () => {
  let finish: (value: never[]) => void = () => {};
  mocks.list.mockImplementation(() => new Promise((resolve) => { finish = resolve; })); mocks.workspaces.mockResolvedValue([]);
  const container = await render();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await act(async () => finish([]));
  expect(container.querySelector('[data-lcos-focus-where]')?.getAttribute('data-open')).toBe('false');
});
it('starts a shell request after stale-slot invalidation and resolves all live occurrences', async () => {
  const bindingList = deferred<Array<{ projectId: string; entityId: string; entityType: string; spatialKind: string; spatialId: string; canvasId: string }>>();
  const workspaceList = deferred<Array<{ id: string; canvasId: string; preferredSurface: string; name: string }>>();
  mocks.list.mockReturnValue(bindingList.promise); mocks.workspaces.mockReturnValue(workspaceList.promise);
  const container = await render({ request: { reqId: 'search-where', entityId: 'a', entityType: 'artifact', title: '施工纪律' }, openWithKeyboard: false });

  expect(mocks.consumeFocusWhere).toHaveBeenCalledExactlyOnceWith();
  expect(mocks.list).toHaveBeenCalledExactlyOnceWith();
  expect(mocks.workspaces).toHaveBeenCalledExactlyOnceWith('p');
  expect(container.querySelector('[data-lcos-focus-where][data-open="true"]')).not.toBeNull();
  expect(container.textContent).toContain('正在查找全部位置');

  await act(async () => {
    bindingList.resolve([{ projectId: 'p', entityId: 'a', entityType: 'artifact', spatialKind: 'node', spatialId: 'remote-node', canvasId: 'child-canvas' }]);
    workspaceList.resolve([{ id: 'child', canvasId: 'child-canvas', preferredSurface: 'context', name: '子现场' }]);
    await Promise.all([bindingList.promise, workspaceList.promise]);
  });

  expect(container.textContent).not.toContain('正在查找全部位置');
  expect(container.querySelectorAll('[data-lcos-occurrence]')).toHaveLength(2);
  expect(container.querySelector('[data-lcos-occurrence="selected"]')).not.toBeNull();
  expect(container.querySelector('[data-lcos-occurrence="remote-node"]')?.textContent).toContain('子现场');
});
it('does not publish a deferred search request after the Where dialog closes', async () => {
  const bindingList = deferred<Array<{ projectId: string; entityId: string; entityType: string; spatialKind: string; spatialId: string; canvasId: string }>>();
  const workspaceList = deferred<Array<{ id: string; canvasId: string; preferredSurface: string; name: string }>>();
  mocks.list.mockReturnValue(bindingList.promise); mocks.workspaces.mockReturnValue(workspaceList.promise);
  const container = await render({ request: { reqId: 'search-where', entityId: 'a', entityType: 'artifact', title: '施工纪律' }, openWithKeyboard: false });

  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="关闭对象位置"]')?.click());
  expect(container.querySelector('[data-lcos-focus-where][data-open="true"]')).toBeNull();

  await act(async () => {
    bindingList.resolve([{ projectId: 'p', entityId: 'a', entityType: 'artifact', spatialKind: 'node', spatialId: 'late-node', canvasId: 'child-canvas' }]);
    workspaceList.resolve([{ id: 'child', canvasId: 'child-canvas', preferredSurface: 'context', name: '子现场' }]);
    await Promise.all([bindingList.promise, workspaceList.promise]);
  });

  expect(container.querySelector('[data-lcos-focus-where][data-open="true"]')).toBeNull();
  expect(container.querySelector('[data-lcos-occurrence="late-node"]')).toBeNull();
});
it('ignores the old project response after switching projects while a search is pending', async () => {
  const oldBindings = deferred<Array<{ projectId: string; entityId: string; entityType: string; spatialKind: string; spatialId: string; canvasId: string }>>();
  const newBindings = deferred<Array<{ projectId: string; entityId: string; entityType: string; spatialKind: string; spatialId: string; canvasId: string }>>();
  const oldWorkspaces = deferred<Array<{ id: string; canvasId: string; preferredSurface: string; name: string }>>();
  const newWorkspaces = deferred<Array<{ id: string; canvasId: string; preferredSurface: string; name: string }>>();
  mocks.list.mockReturnValueOnce(oldBindings.promise).mockReturnValueOnce(newBindings.promise);
  mocks.workspaces.mockReturnValueOnce(oldWorkspaces.promise).mockReturnValueOnce(newWorkspaces.promise);
  const container = await render({ request: { reqId: 'search-where', entityId: 'a', entityType: 'artifact', title: '施工纪律' }, openWithKeyboard: false });
  expect(mocks.list).toHaveBeenCalledTimes(1);

  await rerenderProject(container, 'p2');
  expect(mocks.list).toHaveBeenCalledTimes(2);
  await act(async () => {
    oldBindings.resolve([{ projectId: 'p', entityId: 'a', entityType: 'artifact', spatialKind: 'node', spatialId: 'old-project-node', canvasId: 'old-canvas' }]);
    oldWorkspaces.resolve([{ id: 'old-workspace', canvasId: 'old-canvas', preferredSurface: 'context', name: '旧现场' }]);
    await Promise.all([oldBindings.promise, oldWorkspaces.promise]);
  });
  expect(container.querySelector('[data-lcos-occurrence="old-project-node"]')).toBeNull();
  expect(container.textContent).toContain('正在查找全部位置');

  await act(async () => {
    newBindings.resolve([{ projectId: 'p2', entityId: 'a', entityType: 'artifact', spatialKind: 'node', spatialId: 'new-project-node', canvasId: 'new-canvas' }]);
    newWorkspaces.resolve([{ id: 'new-workspace', canvasId: 'new-canvas', preferredSurface: 'context', name: '新现场' }]);
    await Promise.all([newBindings.promise, newWorkspaces.promise]);
  });
  expect(container.querySelector('[data-lcos-occurrence="old-project-node"]')).toBeNull();
  expect(container.querySelector('[data-lcos-occurrence="new-project-node"]')?.textContent).toContain('新现场');
  expect(container.textContent).not.toContain('正在查找全部位置');
});
it('keeps all remote projections, without the five-location search-summary limit', async () => {
  mocks.list.mockResolvedValue(Array.from({ length: 9 }, (_, index) => ({ projectId: 'p', entityId: 'a', entityType: 'artifact', spatialKind: 'node', spatialId: `n${index}`, canvasId: 'child-canvas' })));
  mocks.workspaces.mockResolvedValue([{ id: 'child', canvasId: 'child-canvas', preferredSurface: 'context', name: '子现场' }]);
  const container = await render();
  expect(container.querySelectorAll('[data-lcos-occurrence]')).toHaveLength(10);
});

it('does not omit a same-canvas binding just because its exact projection is not live yet', async () => {
  mocks.list.mockResolvedValue([{ projectId: 'p', entityId: 'a', entityType: 'artifact', spatialKind: 'node', spatialId: 'waiting-local', canvasId: 'current' }]);
  mocks.workspaces.mockResolvedValue([]); mocks.wait.mockResolvedValue(undefined);
  const container = await render();
  const target = container.querySelector<HTMLButtonElement>('[data-lcos-occurrence="waiting-local"]');
  expect(target).not.toBeNull();
  if (target === null) throw new Error('Expected waiting local occurrence');
  await act(async () => target.click());
  expect(mocks.switchWorksite).not.toHaveBeenCalled();
  expect(mocks.wait).toHaveBeenCalledWith(expect.objectContaining({ canvasId: 'current', nodeId: 'waiting-local' }));
  expect(mocks.requestLocate).not.toHaveBeenCalled();
  expect(container.textContent).toContain('尚未就绪');
});
