import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PortalNodeBody } from './PortalNodeBody';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { PortalDropWorkspaceProvider } from '../drop/PortalDropWorkspaceContext';
import { resolveDropIntent } from '../drop/dropIntentResolver';
import { useLcosDropStore } from '../lcosDropState';

const state = vi.hoisted(() => ({ canvasId:'source-canvas',viewport:{x:0,y:0,zoom:1},nodes: [{ id: 'portal-1', data:{},selected: true }] }));
vi.mock('@/store/spacePreviewSceneCache',()=>({useSpacePreviewScene:()=>({scene:null,stale:false,error:null,retry:()=>{}})}));
vi.mock('@/store/canvasStore', () => ({ default: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('./useLcosDensity', () => ({ useLcosDensity: () => 'reading' }));
vi.mock('./LcosSpeciesBodies', () => ({ SPECIES_ACCENT: { portal: '#888888' }, LcosSpeciesBodyContent: () => null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  useLcosShellStore.getState().clear();
  useLcosDropStore.getState().reset();
  state.nodes = [{ id: 'portal-1', data:{},selected: true }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<PortalDropWorkspaceProvider projectId="p" workspaces={[{ id: 'workspace-child', name: '资料现场', canvasId: 'child-canvas',preferredSurface:'context' }]}>
    <PortalNodeBody nodeId="portal-1" nodeType="canvasRef" data={{ targetCanvasId: 'child-canvas', label: '资料入口' }} />
  </PortalDropWorkspaceProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useLcosDropStore.getState().reset(); });
async function enter(target: EventTarget = window) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
}
it('selected Enter and double click resolve the same typed preview without duplicating windows', async () => {
  await enter();
  expect(useLcosShellStore.getState().windows).toHaveLength(1);
  expect(useLcosShellStore.getState().windows[0]).toMatchObject({ bodyKey: 'portal-preview', target: 'child-canvas', targetKind: 'canvas',portalWorkspaceId:'workspace-child',portalSourceNodeId:'portal-1' });
  const body = host.querySelector('[data-lcos-portal-body]');
  if (!body) throw new Error('Portal body missing');
  await act(async () => { body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(useLcosShellStore.getState().windows).toHaveLength(1);
});
it('does not steal Enter from text input or the Composer', async () => {
  const input = document.createElement('input'); host.append(input);
  await enter(input);
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
  useLcosShellStore.setState({ composerOpen: true });
  await enter();
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
});
it('does not open a portal on multi selection', async () => {
  state.nodes.push({ id: 'other', data:{},selected: true });
  await act(async () => root.render(<PortalNodeBody nodeId="portal-1" nodeType="canvasRef" data={{ targetCanvasId: 'child-canvas' }} />));
  await enter();
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
});

it('registers Portal as a receive target only when its canvas resolves to one real workspace', () => {
  const target = useLcosDropStore.getState().targets().find((entry) => entry.targetId === 'portal:portal-1');
  expect(target).toMatchObject({
    kind: 'portal-receive', enabled: true, label: '入口 · 资料入口 → 资料现场',
    semantic: { kind: 'portal-receive', targetRef: { kind: 'workspace', id: 'workspace-child' } },
  });
});

it('keeps an ambiguous Portal visible as an ineligible receiver instead of guessing a workspace', async () => {
  await act(async () => root.render(<PortalDropWorkspaceProvider projectId="p" workspaces={[
    { id: 'workspace-a', name: '现场 A', canvasId: 'child-canvas',preferredSurface:'context' },
    { id: 'workspace-b', name: '现场 B', canvasId: 'child-canvas',preferredSurface:'context' },
  ]}>
    <PortalNodeBody nodeId="portal-1" nodeType="canvasRef" data={{ targetCanvasId: 'child-canvas', label: '资料入口' }} />
  </PortalDropWorkspaceProvider>));
  const target = useLcosDropStore.getState().targets().find((entry) => entry.targetId === 'portal:portal-1');
  expect(target?.enabled).toBe(false);
  expect(resolveDropIntent({ kind: 'object', entityType: 'note', entityId: 'note-1' }, target!).status).toBe('ineligible');
});
