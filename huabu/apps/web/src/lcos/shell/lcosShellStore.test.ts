import { describe, expect, it, vi } from 'vitest';

import { useLcosShellStore } from './lcosShellStore';

it('isolates project windows and drafts, restores them on return, and never replays old camera commands', () => {
  const store = useLcosShellStore.getState();
  store.clear();
  store.setProject('a');
  store.openWindow('reader', 'A', 'artifact-a');
  store.openComposer({ nodeId: 'a-node', title: 'A', anchor: { x: 1, y: 2, width: 3, height: 4 } });
  store.setComposerPrompt('draft A');
  store.setActiveWorkspaceId('workspace-a');
  store.setSurfaceCanvasId('main', 'canvas-a');
  store.requestCamera('fit');
  store.requestLocate({ reqId: 'a', surface: 'main', nodeId: 'a-node' });
  store.setProject('b');
  expect(useLcosShellStore.getState()).toMatchObject({ windows: [], composerPrompt: '', composerTarget: null, composerOpen: false, activeWorkspaceId: null, surfaceCanvasId: {}, cameraRequest: null, locateRequest: null });
  store.openWindow('reader', 'B', 'artifact-b');
  store.setComposerPrompt('draft B');
  store.setProject('b');
  expect(useLcosShellStore.getState().composerPrompt).toBe('draft B');
  store.setProject('a');
  expect(useLcosShellStore.getState()).toMatchObject({ composerPrompt: 'draft A', composerOpen: true, composerTarget: { nodeId: 'a-node' }, cameraRequest: null, locateRequest: null });
  expect(useLcosShellStore.getState().windows.map((w) => w.target)).toEqual(['artifact-a']);
  store.setProject('b');
  expect(useLcosShellStore.getState().composerPrompt).toBe('draft B');
  expect(useLcosShellStore.getState().windows.map((w) => w.target)).toEqual(['artifact-b']);
  store.clear();
  store.setProject('a');
  expect(useLcosShellStore.getState().windows).toEqual([]);
});

describe('Composer UI intent', () => {
  it('clears a completed submission only in its owning unchanged draft, including after leaving that project', () => {
    const store = useLcosShellStore.getState();
    store.clear(); store.setProject('a');
    const target = { nodeId: 'a-node', title: 'A', anchor: { x: 0, y: 0, width: 1, height: 1 } };
    store.openComposer(target); store.setComposerPrompt('sent A');
    store.setProject('b'); store.setComposerPrompt('new B');
    store.clearSubmittedComposerPrompt('a', target, 'sent A');
    expect(useLcosShellStore.getState().composerPrompt).toBe('new B');
    store.setProject('a');
    expect(useLcosShellStore.getState().composerPrompt).toBe('');
    store.setComposerPrompt('new A');
    store.clearSubmittedComposerPrompt('a', target, 'sent A');
    expect(useLcosShellStore.getState().composerPrompt).toBe('new A');
    store.openComposer({ ...target, nodeId: 'another-target' });
    store.clearSubmittedComposerPrompt('a', target, 'new A');
    expect(useLcosShellStore.getState().composerPrompt).toBe('new A');
  });
  it('opens for one explicit target and closes without clearing the prompt', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    store.setComposerPrompt('继续整理这份材料');
    store.openComposer({
      nodeId: 'node-1',
      title: '山野主视觉',
      anchor: { x: 10, y: 20, width: 160, height: 90 },
      workspaceId: 'workspace-main',
      receiverConversationId: 'connected-conversation-1',
    });

    expect(useLcosShellStore.getState()).toMatchObject({
      composerOpen: true,
      composerTarget: {
        nodeId: 'node-1',
        title: '山野主视觉',
        receiverConversationId: 'connected-conversation-1',
      },
      composerPrompt: '继续整理这份材料',
    });

    store.closeComposer();
    expect(useLcosShellStore.getState()).toMatchObject({
      composerOpen: false,
      composerPrompt: '继续整理这份材料',
    });
  });

  it('clear resets the ephemeral Composer intent', () => {
    const store = useLcosShellStore.getState();
    store.openComposer({
      nodeId: 'node-2',
      title: '访谈摘要',
      anchor: { x: 0, y: 0, width: 1, height: 1 },
    });
    store.setComposerPrompt('draft');
    store.clear();

    expect(useLcosShellStore.getState()).toMatchObject({
      composerOpen: false,
      composerTarget: null,
      composerPrompt: '',
    });
  });
});

describe('Assembly target intent', () => {
  it('keeps the caller-provided canonical target on the professional window', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    store.openAssembly(
      { kind: 'conversation', id: 'conversation-1' },
      'Assembly · 会话',
    );

    expect(useLcosShellStore.getState().windows).toHaveLength(1);
    expect(useLcosShellStore.getState().windows[0]).toMatchObject({
      bodyKey: 'assembly',
      title: 'Assembly · 会话',
      assemblyTargetRef: { kind: 'conversation', id: 'conversation-1' },
      active: true,
    });
  });
});

describe('Professional window topology', () => {
  it('creates one floating region per opened instance instead of an implicit global tab group', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    store.openWindow('reader', '材料 A', 'artifact-a');
    store.openWindow('reader', '材料 B', 'artifact-b');

    const state = useLcosShellStore.getState();
    expect(state.windowRegions).toHaveLength(2);
    expect(state.windowRegions.every((region) => region.layout === 'floating')).toBe(true);
    expect(state.windowRegions.every((region) => region.windowIds.length === 1)).toBe(true);
    expect(new Set(state.windowRegions.map((region) => region.activeWindowId)).size).toBe(2);
  });

  it('keeps region activeWindowId in sync and allows an explicit dock layout', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    store.openWindow('reader', '材料 A', 'artifact-a');
    const first = useLcosShellStore.getState().windows[0];
    if (!first) throw new Error('window must exist');
    const region = useLcosShellStore.getState().windowRegions[0];
    if (!region) throw new Error('region must exist');

    store.setWindowRegionLayout(region.id, 'docked-right');
    store.activateWindow(first.id);
    expect(useLcosShellStore.getState().windowRegions[0]).toMatchObject({
      id: region.id,
      layout: 'docked-right',
      activeWindowId: first.id,
    });
  });

  it('publishes and clears environment as ephemeral stage state', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    const environment = {
      safeRect: { x: 0, y: 0, width: 800, height: 600 },
      occupiedRects: [{ x: 400, y: 0, width: 400, height: 600 }],
      activeRegionId: 'region-a',
    };
    store.publishWindowEnvironment(environment);
    expect(useLcosShellStore.getState().windowEnvironment).toEqual(environment);
    store.clearWindowEnvironment();
    expect(useLcosShellStore.getState().windowEnvironment).toBeNull();
  });

  // R2-B：几何 override 与拓扑同住 windowRegions（唯一真相），并随工程会话一起往返。
  it('stores region geometry as a topology field, not body-local state', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    store.openWindow('reader', '材料 A', 'artifact-a');
    const region = useLcosShellStore.getState().windowRegions[0];
    if (!region) throw new Error('region must exist');

    store.setWindowRegionRect(region.id, { x: 120, y: 140, width: 640, height: 520 });
    expect(useLcosShellStore.getState().windowRegions[0]?.rect)
      .toEqual({ x: 120, y: 140, width: 640, height: 520 });

    store.setWindowRegionDockWidth(region.id, 520.4);
    expect(useLcosShellStore.getState().windowRegions[0]?.dockWidth).toBe(520);
    // 几何字段不影响拓扑身份
    expect(useLcosShellStore.getState().windowRegions[0]?.windowIds).toEqual([useLcosShellStore.getState().windows[0]!.id]);
  });

  it('geometry survives a project round-trip through the same session record', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    store.setProject('project-a');
    store.openWindow('reader', '材料 A', 'artifact-a');
    const region = useLcosShellStore.getState().windowRegions[0];
    if (!region) throw new Error('region must exist');
    store.setWindowRegionRect(region.id, { x: 60, y: 90, width: 700, height: 500 });

    store.setProject('project-b');
    expect(useLcosShellStore.getState().windowRegions).toHaveLength(0);
    store.setProject('project-a');
    expect(useLcosShellStore.getState().windowRegions[0]?.rect)
      .toEqual({ x: 60, y: 90, width: 700, height: 500 });
    store.clear();
  });

  // R2-B：只有显式 group/ungroup 才会把多个窗口合成/拆开 tab 组。
  it('groups two regions into one tabbed region and ungroups back out again', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    store.openWindow('reader', '材料 A', 'artifact-a');
    store.openWindow('assembly', 'Assembly');
    const before = useLcosShellStore.getState();
    expect(before.windowRegions).toHaveLength(2);
    expect(before.windowRegions.every((region) => region.windowIds.length === 1)).toBe(true);
    const [first, second] = before.windowRegions;
    if (!first || !second) throw new Error('two regions must exist');

    store.groupWindowRegions(second.id, first.id);
    const grouped = useLcosShellStore.getState();
    expect(grouped.windowRegions).toHaveLength(1);
    expect(grouped.windowRegions[0]?.windowIds).toHaveLength(2);
    expect(grouped.windowRegions[0]?.activeWindowId).toBe(second.activeWindowId);

    store.ungroupWindowRegion(grouped.windowRegions[0]!.id);
    const ungrouped = useLcosShellStore.getState();
    expect(ungrouped.windowRegions).toHaveLength(2);
    expect(ungrouped.windowRegions.every((region) => region.windowIds.length === 1)).toBe(true);
    expect(new Set(ungrouped.windowRegions.map((region) => region.activeWindowId)).size).toBe(2);
    store.clear();
  });

  it('group/ungroup is a no-op without an explicit topology change', () => {
    const store = useLcosShellStore.getState();
    store.clear();
    store.openWindow('reader', '材料 A', 'artifact-a');
    const region = useLcosShellStore.getState().windowRegions[0];
    if (!region) throw new Error('region must exist');
    // 单窗口不可取消分组；同一区域不可自我分组
    store.ungroupWindowRegion(region.id);
    store.groupWindowRegions(region.id, region.id);
    expect(useLcosShellStore.getState().windowRegions).toHaveLength(1);
    expect(useLcosShellStore.getState().windowRegions[0]?.windowIds).toEqual([useLcosShellStore.getState().windows[0]!.id]);
    store.clear();
  });
});

it('keeps an explicit child-worksite return context separate from project truth', () => {
  const store = useLcosShellStore.getState();
  store.clear();
  store.setProject('project-1');
  store.beginChildNavigation({
    projectId: 'project-1',
    sourceSurface: 'main',
    sourceWorkspaceId: 'workspace-main',
    sourceWasChild: false,
    sourceCanvasId: 'canvas-main',
    selectedNodeIds: ['node-a', 'node-b'],
  });
  expect(useLcosShellStore.getState().childReturn).toEqual(expect.objectContaining({
    projectId: 'project-1',
    sourceCanvasId: 'canvas-main',
    selectedNodeIds: ['node-a', 'node-b'],
  }));
  store.clearChildNavigation();
  expect(useLcosShellStore.getState().childReturn).toBeNull();
});

it('drops a child return context when changing project', () => {
  const store = useLcosShellStore.getState();
  store.clear();
  store.setProject('project-a');
  store.beginChildNavigation({ projectId: 'project-a', sourceSurface: 'main', sourceWasChild: false, selectedNodeIds: [] });
  store.setProject('project-b');
  expect(useLcosShellStore.getState().childReturn).toBeNull();
});

it('reuses a canvas preview without conflating an entity with the same id', () => {
  const store = useLcosShellStore.getState();
  store.clear();
  store.openWindow('portal-preview', 'entity', 'same-id');
  store.openWindow('portal-preview', 'canvas', 'same-id', 'canvas');
  store.openWindow('portal-preview', 'canvas', 'same-id', 'canvas');
  const windows = useLcosShellStore.getState().windows;
  expect(windows).toHaveLength(2);
  expect(new Set(windows.map((window) => window.id)).size).toBe(2);
  expect(windows.filter((window) => window.active)).toHaveLength(1);
  expect(windows.find((window) => window.active)?.targetKind).toBe('canvas');
  store.clear();
});

it('does not show a previously opened artifact when the next target is missing', () => {
  const store = useLcosShellStore.getState();
  store.clear();
  store.openWindow('reader', '材料 A', 'artifact-a');
  store.openWindow('reader', '缺失的材料');
  const windows = useLcosShellStore.getState().windows;
  expect(windows).toHaveLength(2);
  expect(windows.find((window) => window.active)?.target).toBeUndefined();
  store.openWindow('reader', '材料 A', 'artifact-a');
  expect(useLcosShellStore.getState().windows.find((window) => window.active)?.target).toBe('artifact-a');
});

it('keeps two Assembly destinations independently selectable and closable in the same millisecond', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(123);
  try {
    const store = useLcosShellStore.getState();
    store.clear();
    store.openAssembly({ kind: 'conversation', id: 'a' });
    store.openAssembly({ kind: 'conversation', id: 'b' });
    const [first, second] = useLcosShellStore.getState().windows;
    if (!first || !second) throw new Error('Both destinations must exist');
    expect(first.id).not.toBe(second.id);
    store.activateWindow(first.id);
    expect(useLcosShellStore.getState().windows.filter((window) => window.active)).toHaveLength(1);
    store.closeWindow(first.id);
    expect(useLcosShellStore.getState().windows).toEqual([{ ...second, active: true }]);
  } finally {
    clock.mockRestore();
  }
});
