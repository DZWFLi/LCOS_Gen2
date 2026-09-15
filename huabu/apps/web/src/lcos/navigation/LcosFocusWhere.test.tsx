import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { LcosFocusWhere } from './LcosFocusWhere';

const search = vi.hoisted(() => vi.fn());
const requestLocate = vi.hoisted(() => vi.fn());
const switchWorksite = vi.hoisted(() => vi.fn());
const waitForArrival = vi.hoisted(() => vi.fn());
vi.mock('./waitForProjectedEntity', () => ({ waitForProjectedEntity: waitForArrival }));
const nodeEntityRefs = vi.hoisted(() => new Map<string, { entityId: string; entityType: string }>());
const canvasNodes = vi.hoisted(() => [] as Array<{ id: string; selected?: boolean }>);

vi.mock('@local-creative-os/web-gen2', () => ({
  SqliteBindingStore: class { list = search; },
  occurrenceRowLabel: ({ surface, workspaceName }: { surface?: string; workspaceName?: string }) => workspaceName ?? surface ?? '当前现场',
}));
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));
vi.mock('../app/useLcosWorksiteNav', () => ({ useLcosWorksiteNav: () => ({ switchWorksite }) }));
vi.mock('../lcosReferenceState', () => ({ useLcosReferenceStore: { getState: () => ({ nodeEntityRefs }) } }));
vi.mock('../shell/lcosShellStore', () => ({
  SURFACE_LABEL: { main: 'Main', context: 'Context', workflow: 'Workflow' },
  useLcosShellStore: (selector: (state: { activeSurface: string; requestLocate: typeof requestLocate }) => unknown) =>
    selector({ activeSurface: 'main', requestLocate }),
}));
vi.mock('@/store/canvasStore', () => ({ default: { getState: () => ({ nodes: canvasNodes, canvasId: 'canvas-context' }) } }));

const roots: ReturnType<typeof createRoot>[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  search.mockReset();
  requestLocate.mockReset();
  switchWorksite.mockReset();
  waitForArrival.mockReset();
  nodeEntityRefs.clear();
  canvasNodes.length = 0;
});

it.each([false, true])('waits for cross-surface arrival and respects cancellation=%s', async (cancel) => {
  nodeEntityRefs.set('selected-node', { entityId: 'entity-a', entityType: 'artifact' });
  canvasNodes.push({ id: 'selected-node', selected: true });
  search.mockResolvedValue([{ projectId: 'project-a', entityType: 'artifact', entityId: 'entity-a',
    spatialKind: 'node', spatialId: 'target-node', canvasId: 'canvas-other' }]);
  switchWorksite.mockResolvedValue(true);
  let finish: (value: string) => void = () => {};
  waitForArrival.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { container, root } = renderFocusWhere();
  await act(async () => root.render(<LcosFocusWhere {...props} canvasBySurface={{ context: 'canvas-other' }} />));
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })));
  const go = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('前往'));
  if (!go) throw new Error('cross-surface action missing');
  await act(async () => go.click());
  expect(switchWorksite).toHaveBeenCalledWith('context');
  expect(requestLocate).not.toHaveBeenCalled();
  if (cancel) await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await act(async () => finish('arrived-node'));
  if (cancel) expect(requestLocate).not.toHaveBeenCalled();
  else expect(requestLocate).toHaveBeenCalledWith(expect.objectContaining({ surface: 'context', canvasId: 'canvas-context', nodeId: 'arrived-node' }));
  expect(container.querySelector('[data-lcos-focus-where]')?.getAttribute('data-open')).toBe('false');
});

function renderFocusWhere() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  return { container, root };
}

const props = {
  projectId: 'project-a',
  surfaceByWorkspace: new Map(),
  canvasBySurface: {},
  ensureCanvas: async () => undefined,
};

it('does not reopen when a pending collection completes after Escape', async () => {
  nodeEntityRefs.set('selected-node', { entityId: 'entity-a', entityType: 'artifact' });
  canvasNodes.push({ id: 'selected-node', selected: true });
  let resolveSearch: (result: never[]) => void = () => {};
  search.mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve; }));
  const { container, root } = renderFocusWhere();

  await act(async () => root.render(<LcosFocusWhere {...props} />));
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })));
  expect(search).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await act(async () => resolveSearch([]));

  expect(container.querySelector('[data-lcos-focus-where]')?.getAttribute('data-open')).toBe('false');
});

it('locates the exact same-surface occurrence and closes the panel', async () => {
  nodeEntityRefs.set('selected-node', { entityId: 'entity-a', entityType: 'artifact' });
  nodeEntityRefs.set('other-node', { entityId: 'entity-a', entityType: 'artifact' });
  canvasNodes.push({ id: 'selected-node', selected: true }, { id: 'other-node' });
  search.mockResolvedValue([]);
  const { container, root } = renderFocusWhere();

  await act(async () => root.render(<LcosFocusWhere {...props} />));
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' })));
  await act(async () => Promise.resolve());
  const go = [...container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('前往'));
  if (!go) throw new Error('local occurrence action missing');
  await act(async () => go.click());

  expect(requestLocate).toHaveBeenCalledWith(expect.objectContaining({ surface: 'main', nodeId: 'other-node', status: 'projected' }));
  expect(container.querySelector('[data-lcos-focus-where]')?.getAttribute('data-open')).toBe('false');
});
