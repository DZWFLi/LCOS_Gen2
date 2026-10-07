import { buildLcosNodeCommands, primaryNodeCommands, describeProjectedEntity } from '@local-creative-os/web-gen2';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasAttentionStore } from '@/store/canvasAttentionStore';

import { LcosActionArc } from './LcosActionArc';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { GlythNodeBody } from '../nodes/GlythNodeBody';
import { useLcosShellStore } from '../shell/lcosShellStore';

import type { CollaborationSessionEntry } from '../collaboration/collaborationSessionStore';
import type { CollaborationSessionProjectionV1 } from '@local-creative-os/contracts';

const mocks = vi.hoisted(() => ({
  entry: undefined as CollaborationSessionEntry | undefined,
  nodes: [{ id: 'glyth-node', type: 'note', selected: true, position: { x: 40, y: 50 }, width: 121, height: 142, data: { label: '创作搭档' } }],
  drop: { state: { status: 'idle' }, resolution: undefined } as Record<string, unknown>,
  registerTarget: vi.fn(), unregisterTarget: vi.fn(), selectNodes: vi.fn(),
}));
vi.mock('@/store/canvasStore', () => ({ default: Object.assign(
  (select: (value: Record<string, unknown>) => unknown) => select({ nodes: mocks.nodes, canvasId: 'canvas-actions' }),
  { getState: () => ({ nodes: mocks.nodes, selectNodes: mocks.selectNodes }) },
) }));
vi.mock('@/store/previewWorkspace/actions', () => ({ openPreviewNode: vi.fn() }));
vi.mock('@/components/Nodes/shared/height/useHeightMode', () => ({ useHeightMode: () => 'fixed' }));
vi.mock('@/components/Common/CanvasFloatingPopover', () => ({ CanvasFloatingPopover: ({ children, style, side }: { children: ReactNode; style?: React.CSSProperties; side?: string }) => <div data-test-floating data-placement={side} style={style}>{children}</div> }));
vi.mock('motion/react', () => ({ AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock('../ui/nearfield/LcosActionOrbitMotion', () => ({
  LcosActionOrbitMotion: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LcosActionArcMotionHost: (props: React.ComponentPropsWithoutRef<'div'>) => <div {...props} />,
}));
vi.mock('../ui/nearfield/LcosActionOrbView', () => ({ LcosActionOrbView: (props: { label: string; actionId?: string; disabledReason?: string; more?: boolean; expanded?: boolean; buttonRef?: React.Ref<HTMLButtonElement>; onClick: () => void }) =>
  <button ref={props.buttonRef} aria-label={props.label} aria-expanded={props.expanded} data-lcos-arc-primary={props.actionId} data-lcos-arc-more={props.more || undefined} disabled={props.disabledReason !== undefined} onClick={props.onClick}>{props.label}</button>,
}));
vi.mock('../pin/LcosColorPinProvider', () => ({ useOptionalLcosColorPins: () => null }));
vi.mock('../collaboration/useCollaborationSession', () => ({ useCollaborationSession: () => mocks.entry }));
vi.mock('@/lcos-seam/nodePresentation', () => ({ useLcosNodePresentation: () => ({ phase: 'rest' }) }));
vi.mock('../nodes/useLcosDensity', () => ({ useLcosDensity: () => 'reading' }));
vi.mock('../nodes/NodeColorPinMarkers', () => ({ NodeColorPinMarkers: () => null }));
vi.mock('../nodes/NodeReferenceMarker', () => ({ NodeReferenceMarker: () => null }));
vi.mock('../ui/glyth/GlythThoughtBubble', () => ({ GlythThoughtBubble: () => null }));
vi.mock('../ui/glyth/GlythBodyView', () => ({ GlythBodyView: ({ pose }: { pose: string }) => <div data-real-donor-pose={pose} /> }));
vi.mock('../lcosDropState', () => ({ useLcosDropStore: (select: (value: Record<string, unknown>) => unknown) => select({ ...mocks.drop, registerTarget: mocks.registerTarget, unregisterTarget: mocks.unregisterTarget }) }));



const base: CollaborationSessionProjectionV1 = {
  schemaVersion: 1, projectId: 'p-actions', conversationId: 'c-actions',
  identity: { title: '创作搭档' }, userState: 'ready', relation: { targetRefs: [] }, activity: {}, recentReturns: [],
  capabilities: { canSend: true, canDelegate: false, canResume: true, canFork: false, canSelectedContext: false, canBlankNew: false,
    canHandoff: false, canAnswerInput: true, canApprove: true, canCancel: true, canRecover: false, canOpenDiagnostics: true },
};
const projection = (patch: Partial<CollaborationSessionProjectionV1> = {}): CollaborationSessionProjectionV1 => ({ ...base, ...patch });
const review = { returnId: 'return-1', title: '生成结果', status: 'pending_review' as const, returnedAt: '2026-09-26T00:00:00Z' };
const ready = (value = projection()): void => { mocks.entry = { status: 'ready', projection: value, timeline: [] }; };
const model = (value?: CollaborationSessionProjectionV1) => buildLcosNodeCommands({ nodeType: 'note', entityType: 'conversation', entityId: 'c-actions', capabilities: [], referenced: false, ...(value === undefined ? {} : { conversation: value }) });
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  mocks.nodes = [{ id: 'glyth-node', type: 'note', selected: true, position: { x: 40, y: 50 }, width: 121, height: 142, data: { label: '创作搭档' } }];
  ready(); mocks.drop = { state: { status: 'idle' }, resolution: undefined };
  useCanvasAttentionStore.getState().setCanvasEngaged(true);
  useLcosReferenceStore.getState().reset(); useLcosReferenceStore.getState().setProject('p-actions');
  useLcosReferenceStore.getState().registerNodeEntity('glyth-node', {
    entityType: 'conversation', entityId: 'c-actions', descriptor: { ...describeProjectedEntity({ entityType: 'conversation', entityId: 'c-actions', title: '创作搭档' }), active: true, waiting: true },
  });
  useLcosShellStore.getState().clear(); useLcosShellStore.getState().setProject('p-actions');
  useLcosReferenceStore.setState({ bindingCanvasId: 'canvas-actions', bindingIdentitiesReady: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); useLcosShellStore.getState().clear(); useCanvasAttentionStore.getState().setCanvasEngaged(true); });
const renderArc = async (): Promise<void> => { await act(async () => root.render(<LcosActionArc />)); };
const click = async (action: string): Promise<void> => {
  const button = host.querySelector<HTMLButtonElement>(`[data-lcos-arc-primary="${action}"]`);
  expect(button, action).not.toBeNull(); await act(async () => button!.click());
};

describe('R5 state actions use real session facts', () => {
  it.each([
    [projection(), ['compose', 'open']],
    [projection({ userState: 'done' }), ['compose', 'open']],
    [projection({ userState: 'thinking' }), ['view-progress', 'open']],
    [projection({ userState: 'working' }), ['view-progress', 'open']],
    [projection({ userState: 'needs_user', activity: { pendingInputId: 'input-1' } }), ['answer-input', 'open']],
    [projection({ userState: 'needs_user', recentReturns: [review] }), ['review-result', 'open']],
    [projection({ userState: 'needs_user' }), ['open']],
    [projection({ userState: 'unavailable' }), ['open']],
    [undefined, ['open']],
    [projection({ conversationId: 'other' }), ['open']],
  ])('selects only truthful primary actions for %j', (value, expected) => {
    expect(primaryNodeCommands(model(value), 2).map((command) => command.id)).toEqual(expected);
  });
  it('does not replace an unavailable answer with continue/reference; the reason remains in More', () => {
    const value = projection({ userState: 'needs_user', activity: { pendingInputId: 'input-1' }, capabilities: { ...base.capabilities, canAnswerInput: false }, capabilityReasons: { canAnswerInput: '会话已结束，不能提交回答' } });
    expect(primaryNodeCommands(model(value), 2).map((command) => command.id)).toEqual(['open']);
    expect(model(value).find((command) => command.id === 'answer-input')?.disabledReason).toBe('会话已结束，不能提交回答');
    expect(model(value).find((command) => command.id === 'compose')).toBeUndefined();
  });
  it('opens the existing Composer for continuation without creating a session or another WorkView', async () => {
    await renderArc(); await click('compose');
    expect(useLcosShellStore.getState()).toMatchObject({ composerOpen: true, composerTarget: { nodeId: 'glyth-node', intent: 'continue', receiverConversationId: 'c-actions' }, windows: [] });
  });
  it('answer, review, progress and open all reuse one WorkView identity', async () => {
    ready(projection({ userState: 'needs_user', activity: { pendingInputId: 'input-1' } })); await renderArc(); await click('answer-input');
    const first = useLcosShellStore.getState().windows[0]!.id;
    ready(projection({ userState: 'needs_user', recentReturns: [review] })); await renderArc(); await click('review-result');
    ready(projection({ userState: 'working' })); await renderArc(); await click('view-progress'); await click('open');
    expect(useLcosShellStore.getState().windows).toHaveLength(1);
    expect(useLcosShellStore.getState().windows[0]).toMatchObject({ id: first, bodyKey: 'conversation', target: 'c-actions' });
    expect(useLcosShellStore.getState().composerOpen).toBe(false);
  });
});

describe('Glyth donor follows current projection, preserving receiving reaction', () => {
  const mount = async (): Promise<void> => { await act(async () => root.render(<GlythNodeBody nodeId="glyth-node" nodeType="note" data={{ label: '创作搭档' }} />)); };
  const pose = (): string | null | undefined => host.querySelector('[data-real-donor-pose]')?.getAttribute('data-real-donor-pose');
  it('does not use stale descriptor active/waiting while loading or failed', async () => {
    mocks.entry = undefined; await mount(); expect(pose()).toBe('idle'); expect(host.textContent).toContain('创作搭档');
    mocks.entry = { status: 'error' }; await mount(); expect(pose()).toBe('idle');
    expect(host.querySelector('[data-lcos-glyth-body]')?.getAttribute('aria-label')).toContain('状态读取失败');
  });
  it('changes from work to wait to idle with true user state, and shows curious during true reference receipt', async () => {
    ready(projection({ userState: 'working' })); await mount(); expect(pose()).toBe('working');
    ready(projection({ userState: 'needs_user' })); await mount(); expect(pose()).toBe('curious');
    ready(projection()); await mount(); expect(pose()).toBe('idle');
    mocks.drop = { state: { status: 'preview' }, resolution: { status: 'ready', intent: { kind: 'assembly-apply', targetRef: { kind: 'conversation', id: 'c-actions' } } } };
    await mount(); expect(pose()).toBe('curious');
    mocks.drop = { state: { status: 'idle' }, resolution: undefined }; await mount(); expect(pose()).toBe('idle');
  });
  it('shows only the current projected Glyth state beside its identity', async () => {
    ready(projection({ userState: 'working' })); await mount();
    expect(host.querySelector('[data-lcos-glyth-state="working"]')?.textContent).toBe('正在执行');
    ready(projection({ userState: 'needs_user' })); await mount();
    expect(host.querySelector('[data-lcos-glyth-state="needs_user"]')?.textContent).toBe('需要你处理');
    ready(projection({ userState: 'ready' })); await mount();
    expect(host.querySelector('[data-lcos-glyth-state="ready"]')?.textContent).toBe('可以继续');
    mocks.entry = { status: 'error' }; await mount();
    expect(host.querySelector('[data-lcos-glyth-state="error"]')?.textContent).toBe('状态读取失败');
  });
  it('double click and Enter open the same real conversation window', async () => {
    await mount(); const body = host.querySelector<HTMLElement>('[data-lcos-glyth-body]')!;
    await act(async () => body.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const id = useLcosShellStore.getState().windows[0]!.id;
    await act(async () => body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(useLcosShellStore.getState().windows).toHaveLength(1);
    expect(useLcosShellStore.getState().windows[0]).toMatchObject({ id, target: 'c-actions' });
    await act(async () => body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
    expect(useLcosShellStore.getState().windows).toHaveLength(1);
    expect(useLcosShellStore.getState().windows[0]).toMatchObject({ id, target: 'c-actions' });
  });
});


describe('Arc hit surface and More lifecycle', () => {
  it('steps aside while a professional surface owns attention, then returns with canvas attention', async () => {
    useCanvasAttentionStore.getState().setCanvasEngaged(false);
    await renderArc(); expect(host.querySelector('[data-lcos-action-arc]')).toBeNull();
    useCanvasAttentionStore.getState().setCanvasEngaged(true);
    await renderArc(); expect(host.querySelector('[data-lcos-action-arc]')).not.toBeNull();
  });

  it('right click opens existing management without discarding the already selected node', async () => {
    await renderArc();
    const canvas = document.createElement('div'); canvas.dataset.canvasRoot = '';
    const node = document.createElement('div'); node.className = 'react-flow__node'; node.dataset.id = 'glyth-node';
    canvas.append(node); host.append(canvas);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
    await act(async () => node.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.selectNodes).not.toHaveBeenCalled();
    expect(host.querySelector('[data-lcos-context-menu]')).toBeNull();
    expect(host.querySelector('[data-lcos-action-arc]')).not.toBeNull();
    const panel = document.querySelector<HTMLElement>('[data-lcos-arc-panel]')!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('[data-lcos-command="compose"]')).toBeNull();
    expect(panel.querySelector('[data-lcos-command="open"]')).toBeNull();
    expect(host.querySelector('[data-lcos-arc-primary="compose"]')).not.toBeNull();
    expect(host.querySelector('[data-lcos-arc-primary="open"]')).not.toBeNull();
  });

  it('makes the orbit parent click-through while keeping the More panel in its own interactive host', async () => {
    await renderArc();
    expect(host.querySelector<HTMLElement>('[data-test-floating]')!.style.pointerEvents).toBe('none');
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-arc-more]')!.click());
    expect(document.querySelector('[data-lcos-arc-panel]')).not.toBeNull();
    expect(document.querySelector('.lcos-action-arc-menu')).not.toBeNull();
    expect(host.querySelectorAll('[data-test-floating]')).toHaveLength(1);
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    expect(document.querySelector('[data-lcos-arc-panel]')).toBeNull();
    expect(host.querySelector('[data-lcos-action-arc]')).not.toBeNull();
  });
  it('keeps More compact and moves size/accent controls into adjacent inspectors', async () => {
    await renderArc();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-arc-more]')!.click());
    const panel = document.querySelector('[data-lcos-arc-panel]')!;
    expect(panel.querySelector('[data-lcos-size-width]')).toBeNull();
    expect(panel.querySelector('[data-lcos-accent]')).toBeNull();
    expect(panel.querySelectorAll('button').length).toBeLessThan(16);
    await act(async () => panel.querySelector<HTMLButtonElement>('[data-lcos-command="size"]')!.click());
    expect(document.querySelector('[data-lcos-arc-panel]')).toBeNull();
    expect(host.querySelector('[data-lcos-arc-inspector="size"]')).not.toBeNull();
    expect(host.querySelector('[data-lcos-size-width]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="返回更多命令"]')!.click());
    expect(document.querySelector('[data-lcos-arc-panel]')).not.toBeNull();
  });
  it('opens accent palette only when the existing command model exposes it', async () => {
    mocks.nodes = [{ id: 'free-image', type: 'image', selected: true, position: { x: 20, y: 20 }, width: 160, height: 120, data: { label: '素材' } }];
    useLcosReferenceStore.getState().reset(); useLcosReferenceStore.getState().setProject('p-actions');
    useLcosReferenceStore.setState({ bindingCanvasId: 'canvas-actions', bindingIdentitiesReady: true });
    await renderArc();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-arc-more]')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[data-lcos-arc-panel] [data-lcos-command="accent"]')!.click());
    expect(host.querySelector('[data-lcos-arc-inspector="accent"]')).not.toBeNull();
    expect(host.querySelectorAll('[data-lcos-accent]').length).toBeGreaterThan(0);
  });
  it('omits unsupported native Core choices without changing their existing command guards', async () => {
    await renderArc();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-arc-more]')!.click());
    const panel = document.querySelector<HTMLElement>('[data-lcos-arc-panel]')!;
    expect(panel.querySelector('[data-lcos-command="fit"]')).toBeNull();
    expect(panel.querySelector('[data-lcos-command="session-diagnostics"]')).toBeNull();
    expect(panel.querySelector('[data-lcos-command="session-options"]')).toBeNull();
    expect(panel.querySelector('[data-lcos-command="delete"]')).toBeNull();
    expect(panel.querySelector('[data-lcos-command="move-space"]')).toBeNull();
    expect(model(projection()).find(command => command.id === 'delete')?.disabledReason).toBe('这是 Core 投影，删除后会重新投影出现；请在 Core 侧移除');
    expect(model(projection()).find(command => command.id === 'move-space')).toBeUndefined();
  });
  it('keeps usable native deletion while LCOS no longer offers Huabu physical relocation', async () => {
    mocks.nodes = [{ id: 'free-image', type: 'image', selected: true, position: { x: 20, y: 20 }, width: 160, height: 120, data: { label: '素材' } }];
    useLcosReferenceStore.getState().reset(); useLcosReferenceStore.getState().setProject('p-actions');
    useLcosReferenceStore.setState({ bindingCanvasId: 'canvas-actions', bindingIdentitiesReady: true });
    await renderArc();
    expect(host.querySelector<HTMLButtonElement>('[data-lcos-arc-primary="delete"]')?.disabled).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-arc-more]')!.click());
    expect(document.querySelector<HTMLButtonElement>('[data-lcos-arc-panel] [data-lcos-command="move-space"]')).toBeNull();
  });
  it('keeps continuation fallback and diagnostics visible when the main action cannot serve the state', async () => {
    ready(projection({
      capabilities: { ...base.capabilities, canSend: false },
      capabilityReasons: { canSend: '当前协作方式暂不能继续' },
    }));
    await renderArc();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-arc-more]')!.click());
    let panel = document.querySelector<HTMLElement>('[data-lcos-arc-panel]')!;
    expect(panel.querySelector<HTMLButtonElement>('[data-lcos-command="session-options"]')).not.toBeNull();
    expect(panel.querySelector<HTMLButtonElement>('[data-lcos-command="compose"]')?.disabled).toBe(true);

    await act(async () => panel.querySelector<HTMLButtonElement>('[data-lcos-command="session-options"]')!.click());
    expect(useLcosShellStore.getState().windows).toMatchObject([{ bodyKey: 'conversation', target: 'c-actions' }]);
    ready(projection({ userState: 'unavailable' }));
    await renderArc();
    await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-arc-more]')!.click());
    panel = document.querySelector<HTMLElement>('[data-lcos-arc-panel]')!;
    expect(panel.querySelector('[data-lcos-command="session-diagnostics"]')).not.toBeNull();
    await act(async () => panel.querySelector<HTMLButtonElement>('[data-lcos-command="session-diagnostics"]')!.click());
    expect(useLcosShellStore.getState().windows).toHaveLength(1);
    expect(useLcosShellStore.getState().windows[0]).toMatchObject({ bodyKey: 'conversation', target: 'c-actions' });
  });
  it('does not consume an Escape already used by a higher priority layer', async () => {
    await renderArc(); await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-arc-more]')!.click());
    const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }); event.preventDefault();
    await act(async () => window.dispatchEvent(event));
    expect(document.querySelector('[data-lcos-arc-panel]')).not.toBeNull();
  });
});


describe('Arc respects the first canonical identity read', () => {
  it('hides pending bound commands, then shows them once identities exist even before descriptors finish', async () => {
    useLcosReferenceStore.setState({ bindingIdentitiesReady: false, bindingReadStatus: 'loading' });
    await renderArc(); expect(host.querySelector('[data-lcos-arc-primary]')).toBeNull();
    await act(async () => { useLcosReferenceStore.setState({ bindingIdentitiesReady: true, bindingReadStatus: 'loading' }); });
    expect(host.querySelector('[data-lcos-arc-primary="compose"]')).not.toBeNull();
  });
  it('ready empty binding list restores valid free-node commands, but wrong project/canvas stays hidden', async () => {
    useLcosReferenceStore.setState({ bindingIdentitiesReady: false, nodeEntityRefs: new Map() });
    await renderArc(); expect(host.querySelector('[data-lcos-arc-more]')).toBeNull();
    await act(async () => { useLcosReferenceStore.setState({ bindingIdentitiesReady: true, bindingReadStatus: 'ready' }); });
    expect(host.querySelector('[data-lcos-arc-more]')).not.toBeNull();
    await act(async () => { useLcosReferenceStore.setState({ bindingCanvasId: 'previous-canvas' }); });
    expect(host.querySelector('[data-lcos-arc-more]')).toBeNull();
    await act(async () => { useLcosReferenceStore.setState({ bindingCanvasId: 'canvas-actions', projectId: 'previous-project' }); });
    expect(host.querySelector('[data-lcos-arc-more]')).toBeNull();
  });
});
