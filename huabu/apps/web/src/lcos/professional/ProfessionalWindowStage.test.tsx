import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';
import { useCanvasAttentionStore } from '@/store/canvasAttentionStore';

import { ProfessionalWindowStage } from './ProfessionalWindowStage';
import { composerInputKey } from '../composer/composerInputJourney';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { windowIdsForRegion } from '../shell/windowRegionTopology';

vi.mock('./ArtifactReaderBody', () => ({
  ArtifactReaderBody: ({
    artifactId,
    revisionId,
    onReturnToSource,
    onReturnToComposer,
  }: {
    artifactId?: string;
    revisionId?: string;
    onReturnToSource?: () => void;
    onReturnToComposer?: () => void;
  }) => (
    <>
      <button
        type="button"
        data-reader-artifact={artifactId}
        data-reader-revision={revisionId}
        onClick={onReturnToSource}
      />
      {onReturnToComposer ? <button type="button" data-reader-input-return={artifactId}
        onClick={onReturnToComposer}>返回当前输入</button> : null}
    </>
  ),
}));
vi.mock('./AssemblyBody', () => ({
  AssemblyBody: ({ onReturnComposer }: { onReturnComposer?: () => void }) => onReturnComposer
    ? <button type="button" data-lcos-assembly-resume-input onClick={onReturnComposer}>返回输入</button>
    : null,
}));
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

function openComposerAssembly(withConversationOwner = false, withIndependentReader = false) {
  const store = useLcosShellStore.getState();
  const target = withConversationOwner ? {
    nodeId: 'conversation-node', title: '施工纪律', anchor: { x: 20, y: 30, width: 140, height: 44 },
    intent: 'continue' as const, receiverConversationId: 'conversation-a',
    continuationOperationId: 'operation-a', messageId: 'message-a',
  } : {
    nodeId: 'main-node', title: '施工纪律', anchor: { x: 20, y: 30, width: 140, height: 44 },
    intent: 'delegate' as const, workspaceId: 'workspace-main',
  };
  store.setProject('p');
  if (withConversationOwner) store.openWindow('conversation', '施工纪律', 'conversation-a');
  store.openComposer(target);
  const prompt = '施工纪律原始草稿';
  store.setComposerPrompt(prompt);
  const inputKey = composerInputKey(target);
  if (inputKey === undefined) throw new Error('Composer input key is missing');
  const caret = { projectId: 'p', targetKey: inputKey, text: prompt, start: 2, end: 7 };
  store.rememberComposerCaret(caret);

  const referenceStore = useLcosReferenceStore.getState();
  referenceStore.setProject('p');
  expect(referenceStore.addEntityToDraft({ entityType: 'artifact', entityId: 'artifact-existing', displayLabel: '已有引用' }, target.intent)).toBe(true);
  const references = useLcosReferenceStore.getState().draft.orderedEntityRefs;
  if (withIndependentReader) store.openReader('无关材料', 'artifact-independent');
  store.openAssembly(withConversationOwner ? { kind: 'conversation', id: 'conversation-a' } : { kind: 'main' },
    '装配 · 施工纪律', false, inputKey);
  useCanvasAttentionStore.getState().setCanvasEngaged(true);
  return {
    target, prompt, inputKey, caret, references,
    focusVersion: useLcosShellStore.getState().composerFocusVersion,
    withConversationOwner, withIndependentReader,
  };
}

function openComposerReader(withIndependentWindows = false) {
  const store = useLcosShellStore.getState();
  const target = {
    nodeId: 'main-node', title: '施工纪律', anchor: { x: 20, y: 30, width: 140, height: 44 },
    intent: 'delegate' as const, workspaceId: 'workspace-main',
  };
  store.setProject('p');
  store.openComposer(target);
  const prompt = 'Reader 返回后继续原输入';
  store.setComposerPrompt(prompt);
  const inputKey = composerInputKey(target);
  if (inputKey === undefined) throw new Error('Composer input key is missing');
  const caret = { projectId: 'p', targetKey: inputKey, text: prompt, start: 3, end: 7 };
  store.rememberComposerCaret(caret);

  const referenceStore = useLcosReferenceStore.getState();
  referenceStore.setProject('p');
  expect(referenceStore.addEntityToDraft({ entityType: 'artifact', entityId: 'artifact-existing', displayLabel: '已有引用' }, target.intent)).toBe(true);
  referenceStore.registerNodeEntity('source-node', { entityType: 'artifact', entityId: 'artifact-composer-reader' });
  const references = useLcosReferenceStore.getState().draft.orderedEntityRefs;
  if (withIndependentWindows) {
    store.openReader('独立材料 Reader', 'artifact-independent');
    store.openWindow('assembly', '独立 Assembly');
  }
  store.openReader('Reader · 本次引用', 'artifact-composer-reader', {
    composerOriginKey: inputKey,
    revisionId: 'revision-composer-reader',
    source: { surface: 'main', nodeId: 'source-node' },
  });
  useCanvasAttentionStore.getState().setCanvasEngaged(false);
  return {
    target, prompt, inputKey, caret, references, withIndependentWindows,
    focusVersion: useLcosShellStore.getState().composerFocusVersion,
    locateRequest: useLcosShellStore.getState().locateRequest,
  };
}

function expectComposerRestoredFromReader(snapshot: ReturnType<typeof openComposerReader>): void {
  const state = useLcosShellStore.getState();
  expect(state.windows.some((window) => window.bodyKey === 'reader' && window.target === 'artifact-composer-reader')).toBe(false);
  expect(state.windows.some((window) => window.bodyKey === 'reader' && window.target === 'artifact-independent'))
    .toBe(snapshot.withIndependentWindows);
  expect(state.windows.some((window) => window.bodyKey === 'assembly' && window.title === '独立 Assembly'))
    .toBe(snapshot.withIndependentWindows);
  expect(state.composerOpen).toBe(true);
  expect(state.composerTarget).toEqual(snapshot.target);
  expect(state.composerPrompt).toBe(snapshot.prompt);
  expect(state.composerCaret).toEqual(snapshot.caret);
  expect(state.composerFocusVersion).toBe(snapshot.focusVersion + 1);
  expect(useLcosReferenceStore.getState().draft.orderedEntityRefs).toEqual(snapshot.references);
  expect(useCanvasAttentionStore.getState().isCanvasEngaged).toBe(true);
  expect(state.locateRequest).toEqual(snapshot.locateRequest);
}

function readerWindowCloseButton(target: string): HTMLButtonElement {
  const state = useLcosShellStore.getState();
  const reader = state.windows.find((window) => window.bodyKey === 'reader' && window.target === target);
  if (!reader) throw new Error(`Reader ${target} missing`);
  const region = state.windowRegions.find((candidate) => windowIdsForRegion(candidate).includes(reader.id));
  const button = region === undefined ? null : host.querySelector<HTMLButtonElement>(
    `[data-lcos-window-region-id="${region.id}"] [aria-label="关闭窗口"]`,
  );
  if (!button) throw new Error(`Reader ${target} close action missing`);
  return button;
}

function replaceComposerInput() {
  const store = useLcosShellStore.getState();
  const target = {
    nodeId: 'new-main-node', title: '新的施工目标', anchor: { x: 42, y: 64, width: 160, height: 48 },
    intent: 'delegate' as const, workspaceId: 'workspace-new',
  };
  const prompt = '保留切换后的新输入';
  store.openComposer(target);
  store.setComposerPrompt(prompt);
  const inputKey = composerInputKey(target);
  if (inputKey === undefined) throw new Error('New Composer input key is missing');
  const caret = { projectId: 'p', targetKey: inputKey, text: prompt, start: 3, end: 8 };
  store.rememberComposerCaret(caret);
  const referenceStore = useLcosReferenceStore.getState();
  expect(referenceStore.addEntityToDraft({ entityType: 'artifact', entityId: 'artifact-new', displayLabel: '新引用' }, target.intent)).toBe(true);
  return {
    target, prompt, caret,
    references: useLcosReferenceStore.getState().draft.orderedEntityRefs,
    focusVersion: useLcosShellStore.getState().composerFocusVersion,
    locateRequest: useLcosShellStore.getState().locateRequest,
  };
}

function expectReplacementComposerDraftUntouched(snapshot: ReturnType<typeof replaceComposerInput>): void {
  const state = useLcosShellStore.getState();
  expect(state.composerOpen).toBe(true);
  expect(state.composerTarget).toEqual(snapshot.target);
  expect(state.composerPrompt).toBe(snapshot.prompt);
  expect(state.composerCaret).toEqual(snapshot.caret);
  expect(state.composerFocusVersion).toBe(snapshot.focusVersion);
  expect(useLcosReferenceStore.getState().draft.orderedEntityRefs).toEqual(snapshot.references);
}

function expectReplacementComposerUntouched(snapshot: ReturnType<typeof replaceComposerInput>): void {
  expectReplacementComposerDraftUntouched(snapshot);
  const state = useLcosShellStore.getState();
  expect(state.locateRequest).toEqual(snapshot.locateRequest);
}

function expectComposerRestored(snapshot: ReturnType<typeof openComposerAssembly>): void {
  const state = useLcosShellStore.getState();
  expect(state.windows.some((window) => window.bodyKey === 'assembly')).toBe(false);
  expect(state.windows.some((window) => window.bodyKey === 'conversation' && window.target === 'conversation-a' && window.active))
    .toBe(snapshot.withConversationOwner);
  expect(state.windows.some((window) => window.bodyKey === 'reader' && window.target === 'artifact-independent'))
    .toBe(snapshot.withIndependentReader);
  if (snapshot.withIndependentReader) {
    expect(state.windows.find((window) => window.bodyKey === 'reader' && window.target === 'artifact-independent')?.active).toBe(true);
  }
  expect(state.composerOpen).toBe(true);
  expect(state.composerTarget).toEqual(snapshot.target);
  expect(state.composerPrompt).toBe(snapshot.prompt);
  expect(state.composerCaret).toEqual(snapshot.caret);
  expect(state.composerFocusVersion).toBe(snapshot.focusVersion + 1);
  expect(useLcosReferenceStore.getState().draft.orderedEntityRefs).toEqual(snapshot.references);
  expect(useCanvasAttentionStore.getState().isCanvasEngaged).toBe(!snapshot.withConversationOwner);
  expect(host.querySelector('[data-composer-open="true"]') !== null).toBe(snapshot.withConversationOwner);
}
it('renders every independent region and publishes every region as occupied', async () => {
  const oldWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  try {
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
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth });
  }
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

it('returns from a Composer-origin Reader input action while preserving independent Reader and Assembly windows', async () => {
  const snapshot = openComposerReader(true);
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const returnButton = host.querySelector<HTMLButtonElement>('[data-reader-input-return="artifact-composer-reader"]');
  if (!returnButton) throw new Error('Composer-origin Reader input action missing');
  await act(async () => returnButton.click());

  expectComposerRestoredFromReader(snapshot);
});

it('keeps the Composer-origin Reader source action distinct after the Composer target changes', async () => {
  openComposerReader();
  const replacement = replaceComposerInput();
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const sourceButton = host.querySelector<HTMLButtonElement>('[data-reader-artifact="artifact-composer-reader"]');
  if (!sourceButton) throw new Error('Reader source action missing');
  await act(async () => sourceButton.click());

  expect(useLcosShellStore.getState().windows.some((window) => window.bodyKey === 'reader' && window.target === 'artifact-composer-reader')).toBe(false);
  expectReplacementComposerDraftUntouched(replacement);
  expect(useLcosShellStore.getState().locateRequest).toMatchObject({
    surface: 'main', nodeId: 'source-node', status: 'projected',
  });
});

it('returns from a Composer-origin Reader through window close', async () => {
  const snapshot = openComposerReader();
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  await act(async () => readerWindowCloseButton('artifact-composer-reader').click());

  expectComposerRestoredFromReader(snapshot);
});

it('returns from a Composer-origin Reader through Escape', async () => {
  const snapshot = openComposerReader();
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  await escape();

  expectComposerRestoredFromReader(snapshot);
});

it('closes a stale Composer-origin Reader without taking over the replacement target or draft', async () => {
  const snapshot = openComposerReader(true);
  const replacement = replaceComposerInput();
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  await act(async () => readerWindowCloseButton('artifact-composer-reader').click());

  expect(useLcosShellStore.getState().windows.some((window) => window.bodyKey === 'reader' && window.target === 'artifact-composer-reader')).toBe(false);
  expect(useLcosShellStore.getState().windows.some((window) => window.bodyKey === 'reader' && window.target === 'artifact-independent')).toBe(true);
  expect(useLcosShellStore.getState().windows.some((window) => window.bodyKey === 'assembly' && window.title === '独立 Assembly')).toBe(true);
  expectReplacementComposerUntouched(replacement);
  expect(useLcosShellStore.getState().projectId).toBe('p');
  expect(useLcosReferenceStore.getState().draft.orderedEntityRefs).not.toEqual(snapshot.references);
});

it('rejects a stale Assembly return but lets its close action remove only that old window', async () => {
  openComposerAssembly();
  const replacement = replaceComposerInput();
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const returnButton = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-resume-input]');
  if (!returnButton) throw new Error('Assembly return control missing');
  await act(async () => returnButton.click());
  expect(useLcosShellStore.getState().windows.some((window) => window.bodyKey === 'assembly')).toBe(true);
  expectReplacementComposerUntouched(replacement);

  const closeButton = host.querySelector<HTMLButtonElement>('[data-lcos-window-region-id="region-assembly"] [aria-label="关闭窗口"]');
  if (!closeButton) throw new Error('Assembly close action missing');
  await act(async () => closeButton.click());
  expect(useLcosShellStore.getState().windows.some((window) => window.bodyKey === 'assembly')).toBe(false);
  expectReplacementComposerUntouched(replacement);
});

it('rejects a cross-project Reader origin and closes only that old Reader', async () => {
  const snapshot = openComposerReader();
  const replacement = replaceComposerInput();
  await act(async () => root.render(<ProfessionalWindowStage projectId="other-project" />));

  await act(async () => readerWindowCloseButton('artifact-composer-reader').click());

  expect(useLcosShellStore.getState().windows).toHaveLength(0);
  expectReplacementComposerUntouched(replacement);
  expect(useLcosShellStore.getState().projectId).toBe('p');
  expect(useLcosReferenceStore.getState().draft.orderedEntityRefs).not.toEqual(snapshot.references);
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
    await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true, clientX: 250, clientY: 130 })));
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

it('opens Assembly in the fixed right dock without exposing window dragging', async () => {
  useLcosShellStore.getState().openWindow('assembly', '装配');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const region = useLcosShellStore.getState().windowRegions[0];
  expect(region?.layout).toBe('docked-right');
  expect(region?.dockWidth).toBe(420);
  const element = host.querySelector<HTMLElement>('[data-lcos-window-layout="docked-right"]');
  expect(element?.querySelector('[data-lcos-assembly-fixed-right="true"]')).not.toBeNull();
  expect(element?.querySelector('[data-lcos-window-drag-handle]')).toBeNull();
  expect(element?.querySelector('[data-lcos-window-resize]')?.getAttribute('aria-label')).toBe('调整停靠宽度');
});

it('uses existing compact presentation for a single Assembly below the protected width budget', async () => {
  const oldWidth = window.innerWidth;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });
  try {
    useLcosShellStore.getState().openWindow('assembly', '装配');
    await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

    const stage = host.querySelector<HTMLElement>('[data-lcos-professional-stage]');
    const region = host.querySelector<HTMLElement>('[data-lcos-window-layout="docked-right"]');
    expect(stage?.getAttribute('data-compact')).toBe('true');
    expect(region?.style.left).toBe('24px');
    expect(region?.style.width).toBe('552px');
    expect(useLcosShellStore.getState().windowRegions[0]?.layout).toBe('docked-right');
    expect(host.querySelector('[aria-label="关闭窗口"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="调整窗口 · e"]')).not.toBeNull();
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: oldWidth });
  }
});

it('closes the fixed Assembly dock back to the active canvas', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('assembly', '装配');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const closeButton = host.querySelector<HTMLButtonElement>('[aria-label="关闭窗口"]');
  if (!closeButton) throw new Error('Assembly close action missing');
  await act(async () => closeButton.click());

  expect(useLcosShellStore.getState().windows).toHaveLength(0);
  expect(useLcosShellStore.getState().windowRegions).toHaveLength(0);
  expect(useLcosShellStore.getState().activeSurface).toBe('main');
});

it('returns from Composer-owned Assembly through its return control with the original draft intact', async () => {
  const snapshot = openComposerAssembly();
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const returnButton = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-resume-input]');
  if (!returnButton) throw new Error('Assembly return control missing');
  await act(async () => returnButton.click());

  expectComposerRestored(snapshot);
});

it('closes Composer-owned Assembly through window chrome and restores only its original Composer', async () => {
  const snapshot = openComposerAssembly();
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const closeButton = host.querySelector<HTMLButtonElement>('[data-lcos-window-region-id="region-assembly"] [aria-label="关闭窗口"]');
  if (!closeButton) throw new Error('Assembly window close action missing');
  await act(async () => closeButton.click());

  expectComposerRestored(snapshot);
});

it('returns from Composer-owned Assembly through Escape with the original draft intact', async () => {
  const snapshot = openComposerAssembly();
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  await escape();

  expectComposerRestored(snapshot);
});

it('does not steal canvas attention from a live matching Conversation Composer', async () => {
  const snapshot = openComposerAssembly(true);
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const returnButton = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-resume-input]');
  if (!returnButton) throw new Error('Assembly return control missing');
  await act(async () => returnButton.click());

  expectComposerRestored(snapshot);
});

it('returns the Main Composer above an unrelated Reader without closing that Reader', async () => {
  const snapshot = openComposerAssembly(false, true);
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  const returnButton = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-resume-input]');
  if (!returnButton) throw new Error('Assembly return control missing');
  await act(async () => returnButton.click());

  expectComposerRestored(snapshot);
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
  const [initialA, b, initialC] = useLcosShellStore.getState().windowRegions;
  if (!initialA || !b || !initialC) throw new Error('three regions required');
  let a = initialA;
  let c = initialC;
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
  await act(async () => tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true, pointerId: 4, clientX: 200, clientY: 120 })));
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
  await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true, pointerId: 2, clientX: 250, clientY: 130 })));
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
  const splitter = host.querySelector<HTMLElement>('[data-lcos-window-splitter]');
  const primaryGroupId = useLcosShellStore.getState().windowRegions.find((region) => region.id === a.id)?.groups[0]?.id;
  expect(splitter?.getAttribute('role')).toBe('separator');
  expect(splitter?.getAttribute('aria-label')).toBe('调整分屏比例');
  expect(splitter?.getAttribute('aria-controls')).toBe(`lcos-professional-pane-${primaryGroupId}`);
  const controlsId = splitter?.getAttribute('aria-controls');
  expect([...host.querySelectorAll<HTMLElement>('[id]')].some((pane) => pane.id === controlsId)).toBe(true);
});
