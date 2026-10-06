import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { useLcosWorksite } from './useLcosWorksite';
import { useLcosShellStore } from '../shell/lcosShellStore';

import type { LcosWorksiteState } from './useLcosWorksite';
import type { Workspace } from '@local-creative-os/domain';

const mocks = vi.hoisted(() => ({ list: vi.fn(), graph: vi.fn(), projects: vi.fn(), update: vi.fn(), create: vi.fn() }));
vi.mock('./lcosCoreClient', () => ({ createLcosCoreSession: () => ({ projects: {
  listProjects: mocks.projects, getWorkspaces: mocks.list, getProjectGraph: mocks.graph,
  updateWorkspaceCanvasId: mocks.update,
} }) }));
vi.mock('@/api/canvas', () => ({ createCanvas: mocks.create }));

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.resetAllMocks();
  useLcosShellStore.getState().setSurfaceCanvasMap({});
});

function workspace(id: string, scopeId: string, canvasId?: string): Workspace {
  return { id: id as Workspace['id'], projectId: 'p' as Workspace['projectId'], scopeId: scopeId as Workspace['scopeId'],
    name: id, intent: null, viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'],
    contextPolicy: 'workspace-related', preferredSurface: 'context', updatedAt: '2026-10-06T00:00:00Z',
    ...(canvasId === undefined ? {} : { canvasId }) };
}

async function mount(): Promise<() => LcosWorksiteState> {
  mocks.projects.mockResolvedValue([{ id: 'p', name: 'Project' }]);
  mocks.graph.mockResolvedValue({ scopes: [{ id: 'root', kind: 'root' }] });
  mocks.list.mockResolvedValueOnce([workspace('root-workspace', 'root', 'root-canvas')]);
  let state: LcosWorksiteState | undefined;
  function Probe() { state = useLcosWorksite('p'); return null; }
  const root = createRoot(document.createElement('div')); roots.push(root);
  await act(async () => root.render(<Probe />));
  return () => { if (!state) throw new Error('Hook not mounted'); return state; };
}

it('resolves a newly saved workspace before using the original canvas owner and keeps root navigation separate', async () => {
  const state = await mount();
  mocks.list.mockResolvedValue([workspace('root-workspace', 'root', 'root-canvas'), workspace('new-child', 'child-scope')]);
  mocks.create.mockResolvedValue({ canvasId: 'child-canvas' });
  mocks.update.mockResolvedValue(workspace('new-child', 'child-scope', 'child-canvas'));
  await act(async () => expect(await state().ensureWorkspaceCanvas('new-child')).toBe('child-canvas'));
  expect(mocks.update).toHaveBeenCalledExactlyOnceWith('p', 'new-child', 'child-canvas');
  expect(state().surfaceByWorkspace.get('new-child')).toBe('context');
  expect(state().workspaces).toHaveLength(2);
  expect(useLcosShellStore.getState().surfaceCanvasId).toEqual({ context: 'root-canvas' });
});

it('reuses the fresh persisted canvas instead of creating another one', async () => {
  const state = await mount();
  mocks.list.mockResolvedValue([workspace('root-workspace', 'root', 'root-canvas'), workspace('new-child', 'child-scope', 'saved-child')]);
  await act(async () => expect(await state().ensureWorkspaceCanvas('new-child')).toBe('saved-child'));
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(state().surfaceByWorkspace.get('new-child')).toBe('context');
});

it('does not create a canvas for an absent workspace or a failed canonical reread', async () => {
  const state = await mount();
  mocks.list.mockResolvedValue([]);
  await act(async () => expect(await state().ensureWorkspaceCanvas('missing')).toBeUndefined());
  mocks.list.mockRejectedValue(new Error('offline'));
  await act(async () => expect(await state().ensureWorkspaceCanvas('missing')).toBeUndefined());
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(state().statusDetail).toBe('offline');
});
