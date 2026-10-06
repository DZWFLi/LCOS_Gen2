import { rectsOverlapV1 } from '@local-creative-os/web-gen2';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';

import { useAvoidingHudPosition } from './useAvoidingHudPosition';
import { useLcosShellStore } from '../shell/lcosShellStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let latest = { x: 192, y: 706, width: 104, height: 48 };
function Host({ avoidSelector }: { avoidSelector?: string } = {}) {
  const placement = useAvoidingHudPosition({ x: 192, y: 706, width: 104, height: 48 }, {}, avoidSelector);
  latest = placement.rect;
  return <div ref={placement.ref}>辅助入口</div>;
}
function ProjectIdentityHost() {
  const placement = useAvoidingHudPosition({ x: 24, y: 24, width: 256, height: 44 });
  latest = placement.rect;
  return <div ref={placement.ref} data-lcos-shell-project-cluster>项目身份</div>;
}
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined; document.body.replaceChildren(); useLcosShellStore.getState().clear();
});
it('starts observing a canvas HUD peer mounted after the shell and releases it on unmount', async () => {
  const el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  await act(async () => root?.render(<Host avoidSelector="[data-test-hud-peer]" />));
  const initial = latest;
  const obstacle = { x: 24, y: 506, width: 232, height: 248 };
  expect(rectsOverlapV1(initial, obstacle)).toBe(true);
  const peer = document.createElement('div'); peer.dataset.testHudPeer = '';
  peer.getBoundingClientRect = () => new DOMRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
  await act(async () => { document.body.append(peer); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(rectsOverlapV1(latest, obstacle)).toBe(false);
  await act(async () => { peer.remove(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(latest).toEqual(initial);
});

it('avoids a peer moved by its positioning wrapper without changing its size', async () => {
  const wrapper = document.createElement('div');
  const peer = document.createElement('div'); peer.dataset.testHudPeer = '';
  let obstacle = { x: 24, y: 24, width: 232, height: 248 };
  peer.getBoundingClientRect = () => new DOMRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
  wrapper.append(peer); document.body.append(wrapper);
  const el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  await act(async () => root?.render(<Host avoidSelector="[data-test-hud-peer]" />));
  const initial = latest;
  await act(async () => {
    obstacle = { ...obstacle, y: 506 };
    wrapper.style.top = '506px';
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(rectsOverlapV1(initial, obstacle)).toBe(true);
  expect(rectsOverlapV1(latest, obstacle)).toBe(false);
});

it('uses the project identity as a default prior peer for floating HUDs', async () => {
  const project = document.createElement('div');
  project.dataset.lcosShellProjectCluster = '';
  const obstacle = { x: 150, y: 680, width: 190, height: 72 };
  project.getBoundingClientRect = () => new DOMRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
  document.body.append(project);
  const el = document.createElement('div'); document.body.append(el); root = createRoot(el);

  await act(async () => root?.render(<Host avoidSelector={undefined} />));
  expect(rectsOverlapV1(latest, obstacle)).toBe(false);
});

it('excludes the project identity element itself from its default peer set', async () => {
  const el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  await act(async () => root?.render(<ProjectIdentityHost />));
  expect(latest).toEqual({ x: 24, y: 24, width: 256, height: 44 });
});
