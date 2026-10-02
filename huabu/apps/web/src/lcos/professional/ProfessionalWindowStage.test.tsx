import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';
import { useCanvasAttentionStore } from '@/store/canvasAttentionStore';

import { ProfessionalWindowStage } from './ProfessionalWindowStage';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { windowIdsForRegion } from '../shell/windowRegionTopology';

vi.mock('./ArtifactReaderBody', () => ({
  ArtifactReaderBody: ({
    artifactId,
    revisionId,
    onReturnToSource,
  }: {
    artifactId?: string;
    revisionId?: string;
    onReturnToSource?: () => void;
  }) => (
    <button
      type="button"
      data-reader-artifact={artifactId}
      data-reader-revision={revisionId}
      onClick={onReturnToSource}
    />
  ),
}));
vi.mock('./AssemblyBody', () => ({ AssemblyBody: () => null }));
vi.mock('./PortalPreviewBody', () => ({
  PortalPreviewBody: ({
    portalTargetResolution,
    onOpenPortalTarget,
  }: {
    portalTargetResolution?: { canvasId: string; workspaceId: string; targetSurface: string } | null;
    onOpenPortalTarget?: (target: { canvasId: string; workspaceId: string; targetSurface: string }) => void;
  }) => (
    <button
      data-portal-target-resolution={portalTargetResolution === null ? 'missing' : portalTargetResolution?.workspaceId}
      type="button"
      onClick={() => {
        if (portalTargetResolution && onOpenPortalTarget) onOpenPortalTarget(portalTargetResolution);
      }}
    />
  ),
}));
vi.mock('./ConversationWorkViewBody', () => ({ ConversationWorkViewBody: InlineComposerFixture }));

// Reproduce the production child's Escape registration using the real Huabu hook.
function InlineComposerFixture({ connectedConversationId }: { connectedConversationId?: string }) {
  const open = useLcosShellStore((s) => s.composerOpen && s.composerTarget?.receiverConversationId === connectedConversationId);
  useCloseOnEscape(open, () => useLcosShellStore.getState().closeComposer());
  return <div data-composer-open={open} />;
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useLcosShellStore.getState().clear();
  useLcosReferenceStore.getState().reset();
  window.sessionStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  useLcosReferenceStore.getState().reset();
  host.remove();
});
async function escape() {
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
}
it('renders every independent region and publishes every region as occupied', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('reader', '材料 A', 'artifact-a');
  store.openWindow('reader', '材料 B', 'artifact-b');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  expect(host.querySelectorAll('[data-lcos-professional-stage]')).toHaveLength(1);
  const regions = host.querySelectorAll('[data-lcos-window-region-id]');
  expect(regions).toHaveLength(2);
  expect((regions[0] as HTMLElement | undefined)?.style.left).not.toBe((regions[1] as HTMLElement | undefined)?.style.left);
  expect(new Set(Array.from(regions, (element) => element.getAttribute('data-lcos-window-region-id')))).toEqual(
    new Set(useLcosShellStore.getState().windowRegions.map((region) => region.id)),
  );
  expect(host.querySelectorAll('[data-reader-artifact]')).toHaveLength(2);
  expect(useLcosShellStore.getState().windowEnvironment?.occupiedRects).toHaveLength(2);
  expect(useLcosShellStore.getState().windowEnvironment?.activeRegionId).toBe(
    useLcosShellStore.getState().windowRegions[1]?.id,
  );
});
it('passes the shell-owned Reader revision target into the body without changing Stage geometry ownership', async () => {
  useLcosShellStore.getState().openReader('阅读 · 指定版本', 'artifact-target', {
    revisionId: 'revision-target',
    source: { surface: 'context', nodeId: 'node-target' },
  });
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  expect(host.querySelector('[data-reader-artifact="artifact-target"][data-reader-revision="revision-target"]')).not.toBeNull();
  expect(useLcosShellStore.getState().windows[0]).toMatchObject({
    readerRevisionId: 'revision-target',
    readerSource: { surface: 'context', nodeId: 'node-target' },
  });
  expect(useLcosShellStore.getState().windowRegions).toHaveLength(1);
  expect(useLcosShellStore.getState().windowRegions[0]?.layout).toBe('floating');
});

it('closes a Reader and returns to its exact live source for both body action and Escape', async () => {
  const store = useLcosShellStore.getState();
  store.openReader('材料 A', 'artifact-a', {
    revisionId: 'revision-a',
    source: { surface: 'context', nodeId: 'node-a' },
  });
  useLcosReferenceStore.getState().registerNodeEntity('node-a', { entityType: 'artifact', entityId: 'artifact-a' });
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  const reader = host.querySelector<HTMLButtonElement>('[data-reader-artifact="artifact-a"]');
  if (reader === null) throw new Error('Reader body missing');
  await act(async () => reader.click());
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
  expect(useLcosShellStore.getState().locateRequest).toMatchObject({
    surface: 'context', nodeId: 'node-a', status: 'projected',
  });

  store.consumeLocate();
  store.openReader('材料 A', 'artifact-a', {
    revisionId: 'revision-a',
    source: { surface: 'context', nodeId: 'node-a' },
  });
  await act(async () => {});
  await escape();
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
  expect(useLcosShellStore.getState().locateRequest).toMatchObject({
    surface: 'context', nodeId: 'node-a', status: 'projected',
  });
});
it('closes the inline Composer first and keeps its Work View until the next Escape', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('conversation', '会话', 'conversation-a');
  store.openComposer({ nodeId: 'n', title: '会话', receiverConversationId: 'conversation-a', anchor: { x: 0, y: 0, width: 1, height: 1 } });
  store.setComposerPrompt('保留这份草稿');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  await escape();
  expect(useLcosShellStore.getState().composerOpen).toBe(false);
  expect(useLcosShellStore.getState().composerPrompt).toBe('保留这份草稿');
  expect(useLcosShellStore.getState().windows).toHaveLength(1);
  await escape();
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
});
it('does not let a hidden Composer for another conversation block closing the current window', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('conversation', '会话 B', 'b');
  store.openComposer({ nodeId: 'n', title: 'A', receiverConversationId: 'a', anchor: { x: 0, y: 0, width: 1, height: 1 } });
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  await escape();
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
});

it('passes the Core-resolved Portal Workspace to the production open caller', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('portal-preview', '入口', 'canvas-target', 'canvas', {workspaceId:'workspace-target',sourceNodeId:'portal-node'});
  const open = vi.fn();
  await act(async () => root.render(
    <ProfessionalWindowStage
      projectId="p"
      resolvePortalTarget={(canvasId) => canvasId === 'canvas-target'
        ? { canvasId, workspaceId: 'workspace-target', targetSurface: 'context' }
        : undefined}
      onOpenPortalTarget={open}
    />,
  ));
  const portal = host.querySelector<HTMLButtonElement>('[data-portal-target-resolution="workspace-target"]');
  if (!portal) throw new Error('Resolved Portal target was not passed to the body');
  await act(async () => portal.click());
  expect(open).toHaveBeenCalledWith({ canvasId: 'canvas-target', workspaceId: 'workspace-target', targetSurface: 'context' });
});

it('switches narrow windows through existing tabs without merging or losing mounted bodies', async () => {
  const oldWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
  try {
    const store = useLcosShellStore.getState();
    store.openWindow('reader', '材料 A', 'artifact-a');
    store.openWindow('reader', '材料 B', 'artifact-b');
    const originalRegions = useLcosShellStore.getState().windowRegions;
    await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
    expect(host.querySelector('[data-lcos-professional-stage]')?.getAttribute('data-compact')).toBe('true');
    expect(host.querySelectorAll('[data-reader-artifact]')).toHaveLength(2);
    const visible = () => Array.from(host.querySelectorAll<HTMLElement>('[data-lcos-window-region-id]')).filter((element) => element.style.display !== 'none');
    expect(visible()).toHaveLength(1);
    expect(useLcosShellStore.getState().windowEnvironment?.occupiedRects).toHaveLength(1);
    const firstId = useLcosShellStore.getState().windows[0]?.id;
    const target = visible()[0]?.querySelector<HTMLButtonElement>(`[data-lcos-window-tab-value="${firstId}"]`);
    expect(target).not.toBeNull();
    await act(async () => target?.click());
    expect(visible()[0]?.querySelector('[data-reader-artifact="artifact-a"]')).not.toBeNull();
    expect(useLcosShellStore.getState().windowRegions.map(windowIdsForRegion)).toEqual(originalRegions.map(windowIdsForRegion));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(visible()).toHaveLength(2);
  } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth }); }
});

it('yields canvas chrome to a restored window and again when that window is clicked', async () => {
  useLcosShellStore.getState().openReader('材料 A', 'artifact-a');
  useCanvasAttentionStore.getState().setCanvasEngaged(true);
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  expect(useCanvasAttentionStore.getState().isCanvasEngaged).toBe(false);
  useCanvasAttentionStore.getState().setCanvasEngaged(true);
  await act(async () => host.querySelector('[data-lcos-window-region-id]')?.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true })));
  expect(useCanvasAttentionStore.getState().isCanvasEngaged).toBe(false);
});

it('activates the split reader reached by keyboard focus instead of keeping the other pane active', async () => {
  const store = useLcosShellStore.getState();
  store.openReader('材料 A', 'artifact-a');
  store.openReader('材料 B', 'artifact-b');
  const [a, b] = useLcosShellStore.getState().windowRegions;
  if (!a || !b) throw new Error('two regions required');
  store.groupWindowRegions(b.id, a.id);
  store.splitWindowRegion(a.id, 'vertical');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  for (const target of ['artifact-a', 'artifact-b']) {
    useCanvasAttentionStore.getState().setCanvasEngaged(true);
    await act(async () => host.querySelector<HTMLButtonElement>(`[data-reader-artifact="${target}"]`)?.focus());
    expect(useLcosShellStore.getState().windows.find((window) => window.active)?.target).toBe(target);
    expect(useCanvasAttentionStore.getState().isCanvasEngaged).toBe(false);
  }
});

it('restores both split readers after a narrow viewport without losing revision targets', async () => {
  const oldWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  try {
    const store = useLcosShellStore.getState();
    store.openReader('材料 A', 'artifact-a', { revisionId: 'revision-a' });
    store.openReader('材料 B', 'artifact-b', { revisionId: 'revision-b' });
    const [a, b] = useLcosShellStore.getState().windowRegions;
    if (!a || !b) throw new Error('two regions required');
    store.groupWindowRegions(b.id, a.id);
    store.splitWindowRegion(a.id, 'vertical');
    await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
    expect(host.querySelector('[data-lcos-professional-stage]')?.getAttribute('data-compact')).toBe('true');
    // Both readers remain mounted; narrow mode hides only the inactive projection.
    expect(host.querySelectorAll('[data-reader-artifact]')).toHaveLength(2);
    expect(host.querySelectorAll('.lcos-retained-reader:not([hidden])')).toHaveLength(1);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    await act(async () => window.dispatchEvent(new Event('resize')));
    expect(host.querySelectorAll('[data-reader-artifact]')).toHaveLength(2);
    expect(host.querySelector('[data-reader-artifact="artifact-a"][data-reader-revision="revision-a"]')).not.toBeNull();
    expect(host.querySelector('[data-reader-artifact="artifact-b"][data-reader-revision="revision-b"]')).not.toBeNull();
    expect(useLcosShellStore.getState().windowRegions[0]?.groups).toHaveLength(2);
  } finally { Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth }); }
});

it('publishes moving-window bounds before pointerup while the saved layout stays unchanged', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('reader', '材料 A', 'artifact-a');
  const regionId = useLcosShellStore.getState().windowRegions[0]?.id;
  if (regionId === undefined) throw new Error('missing region');
  store.setWindowRegionRect(regionId, { x: 200, y: 120, width: 400, height: 320 });
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  const region = host.querySelector<HTMLElement>('[data-lcos-window-region-id]');
  const handle = region?.querySelector<HTMLElement>('[data-lcos-window-drag-handle]');
  if (!region || !handle) throw new Error('missing drag handle');
  const rect = vi.spyOn(region, 'getBoundingClientRect').mockImplementation(() => new DOMRect(parseFloat(region.style.left), parseFloat(region.style.top), parseFloat(region.style.width), parseFloat(region.style.height)));
  let frame: FrameRequestCallback | undefined;
  const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frame = callback; return 100; });
  try {
    await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 250, clientY: 130 })));
    await act(async () => window.dispatchEvent(new PointerEvent('pointermove', { buttons: 1, clientX: 280, clientY: 155 })));
    expect(useLcosShellStore.getState().windowRegions[0]?.rect?.x).toBe(200);
    await act(async () => frame?.(0));
    expect(useLcosShellStore.getState().windowEnvironment?.occupiedRects[0]).toMatchObject({ x: 230, y: 145 });
    await act(async () => window.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: 280, clientY: 155 })));
    expect(useLcosShellStore.getState().windowRegions[0]?.rect?.x).toBe(230);
  } finally { raf.mockRestore(); rect.mockRestore(); }
});

it('window chrome exposes no topology menu or duplicate management buttons', async () => {
  const oldWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  try {
    useLcosShellStore.getState().openWindow('reader', '材料', 'a');
    await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
    expect(host.querySelector('[aria-label="关闭窗口"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="更多窗口操作"]')).toBeNull();
    expect(host.querySelector('[data-lcos-window-dock-toggle]')).toBeNull();
    expect(host.querySelector('[data-lcos-window-group]')).toBeNull();
    expect(host.querySelector('[data-lcos-window-ungroup]')).toBeNull();
    expect(host.querySelector('[data-lcos-window-splitter]')).toBeNull();
    expect(useLcosShellStore.getState().windows).toHaveLength(1);
  } finally {Object.defineProperty(window,'innerWidth',{configurable:true,value:oldWidth});}
});

it('respects Escape already consumed by a deeper interaction', async () => {
  useLcosShellStore.getState().openWindow('reader', '材料', 'a');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  const event=new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true});event.preventDefault();
  await act(async () => document.dispatchEvent(event));
  expect(useLcosShellStore.getState().windows).toHaveLength(1);
});


it('drops a dragged tab into the pane under the pointer, not an array-neighbor region', async () => {
  const store = useLcosShellStore.getState();
  store.openReader('材料 A', 'artifact-a');
  store.openReader('材料 A2', 'artifact-a2');
  store.openReader('材料 B', 'artifact-b');
  let [a, b, c] = useLcosShellStore.getState().windowRegions;
  if (!a || !b || !c) throw new Error('three regions required');
  store.groupWindowRegions(b.id, a.id);
  [a, c] = useLcosShellStore.getState().windowRegions;
  if (!a || !c) throw new Error('group and target regions required');
  store.setWindowRegionRect(a.id, { x: 100, y: 100, width: 500, height: 400 });
  store.setWindowRegionRect(c.id, { x: 700, y: 100, width: 500, height: 400 });
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  const sourceRegion = host.querySelector<HTMLElement>(`[data-lcos-window-region-id="${a.id}"]`);
  const targetRegion = host.querySelector<HTMLElement>(`[data-lcos-window-region-id="${c.id}"]`);
  const tab = sourceRegion?.querySelector<HTMLElement>('[data-lcos-window-tab-value]');
  if (!sourceRegion || !targetRegion || !tab) throw new Error('drag tab or pane missing');
  vi.spyOn(sourceRegion, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 500, 400));
  vi.spyOn(targetRegion, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 100, 500, 400));
  await act(async () => tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 4, clientX: 200, clientY: 120 })));
  await act(async () => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 4, buttons: 1, clientX: 900, clientY: 250 })));
  expect(host.querySelector('[data-lcos-window-drop-preview]')).not.toBeNull();
  await act(async () => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 4, clientX: 900, clientY: 250 })));
  const target = useLcosShellStore.getState().windowRegions.find((region) => region.id === c.id);
  expect(target?.groups.flatMap((group) => group.windowIds)).toContain(tab.getAttribute('data-lcos-window-tab-value'));
  expect(useLcosShellStore.getState().windowRegions).toHaveLength(2);
});

it('does not persist a cancelled window drag', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('reader', '材料 A', 'artifact-a');
  const regionId = useLcosShellStore.getState().windowRegions[0]?.id;
  if (regionId === undefined) throw new Error('missing region');
  store.setWindowRegionRect(regionId, { x: 200, y: 120, width: 400, height: 320 });
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  const region = host.querySelector<HTMLElement>('[data-lcos-window-region-id]');
  const handle = region?.querySelector<HTMLElement>('[data-lcos-window-drag-handle]');
  if (!region || !handle) throw new Error('missing drag handle');
  vi.spyOn(region, 'getBoundingClientRect').mockImplementation(() => new DOMRect(parseFloat(region.style.left), parseFloat(region.style.top), parseFloat(region.style.width), parseFloat(region.style.height)));
  await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 2, clientX: 250, clientY: 130 })));
  await act(async () => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, buttons: 1, clientX: 280, clientY: 155 })));
  await act(async () => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 2 })));
  expect(useLcosShellStore.getState().windowRegions[0]?.rect).toEqual({ x: 200, y: 120, width: 400, height: 320 });
});


it('IME Escape leaves the current Reader and revision intact', async () => {
  useLcosShellStore.getState().openReader('历史版本', 'artifact-a', { revisionId: 'old' });
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true })));
  expect(useLcosShellStore.getState().windows[0]?.readerRevisionId).toBe('old');
});

it('Reader split has one outer chrome and two independent content tab strips', async () => {
  const store = useLcosShellStore.getState();
  store.openReader('A', 'artifact-a'); store.openReader('B', 'artifact-b');
  const [a, b] = useLcosShellStore.getState().windowRegions;
  if (!a || !b) throw new Error('two regions required');
  store.groupWindowRegions(b.id, a.id); store.splitWindowRegion(a.id, 'vertical');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  expect(host.querySelectorAll('[data-lcos-family="window-chrome"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-lcos-reader-content-tabs]')).toHaveLength(2);
  expect(host.querySelector('[data-lcos-reader-merge-groups]')).not.toBeNull();
  expect(host.querySelector('[data-lcos-reader-detach-group]')).not.toBeNull();
});
