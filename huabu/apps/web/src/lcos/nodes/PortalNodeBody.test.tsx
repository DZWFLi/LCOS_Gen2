import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PortalNodeBody } from './PortalNodeBody';
import { useLcosShellStore } from '../shell/lcosShellStore';

const state = vi.hoisted(() => ({ nodes: [{ id: 'portal-1', selected: true }] }));
vi.mock('@/store/canvasStore', () => ({ default: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock('./useLcosDensity', () => ({ useLcosDensity: () => 'reading' }));
vi.mock('./LcosSpeciesBodies', () => ({ SPECIES_ACCENT: { portal: '#888888' }, LcosSpeciesBodyContent: () => null }));
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  useLcosShellStore.getState().clear();
  state.nodes = [{ id: 'portal-1', selected: true }];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<PortalNodeBody nodeId="portal-1" nodeType="canvasRef" data={{ targetCanvasId: 'child-canvas', label: '资料现场' }} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function enter(target: EventTarget = window) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
}
it('selected Enter and double click resolve the same typed preview without duplicating windows', async () => {
  await enter();
  expect(useLcosShellStore.getState().windows).toHaveLength(1);
  expect(useLcosShellStore.getState().windows[0]).toMatchObject({ bodyKey: 'portal-preview', target: 'child-canvas', targetKind: 'canvas' });
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
  state.nodes.push({ id: 'other', selected: true });
  await act(async () => root.render(<PortalNodeBody nodeId="portal-1" nodeType="canvasRef" data={{ targetCanvasId: 'child-canvas' }} />));
  await enter();
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
});
