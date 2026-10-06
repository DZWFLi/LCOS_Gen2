import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { WorkflowCardPool } from './WorkflowCardPool';
import { WorkflowHandOverlay } from './WorkflowWorksite';
import { ASSEMBLY_DRAG_MIME } from '../../drop/nativeAssemblyDrop';
import { useLcosDropStore } from '../../lcosDropState';

const m = vi.hoisted(() => ({
  enter: vi.fn(), onEntered: vi.fn(), skills: vi.fn(async () => Array.from({ length: 17 }, (_, i) => ({ id: `skill-${i}`, name: `Skill ${i}`, source: 'system' }))), browse: vi.fn(),
  draftRefs: [] as { entityType: string; entityId: string }[],
  addEntityToDraft: vi.fn(),
  shellState: { activeWorkspaceId: 'source' as string | null, composerTarget: null as unknown, openComposer: vi.fn(), openWindow: vi.fn() },
  items: [{ schemaVersion: 1, kind: 'workflow', title: '真实工作流', usageCount: 0, entityRef: { type: 'workflow', id: 'wf1' } }],
}));
vi.mock('@local-creative-os/web-gen2', async (importOriginal) => ({
  ...await importOriginal<typeof WebGen2>(),
  CoreAssemblyClient: class {},
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../shell/LcosWorksiteStage', () => ({ LcosWorksiteStage: () => null }));
vi.mock('../../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {}, skills: { list: m.skills } }) }));
vi.mock('../../professional/useWarehouseBrowse', () => ({ useWarehouseBrowse: (...args: unknown[]) => { m.browse(...args); return { items: m.items, state: 'ready' }; } }));
vi.mock('../../navigation/childWorksiteNavigation', () => ({ beginChildWorksiteNavigation: m.enter }));
vi.mock('../../lcosReferenceState', () => ({
  useLcosReferenceStore: Object.assign(
    (selector: (state: { draft: { orderedEntityRefs: typeof m.draftRefs } }) => unknown) =>
      selector({ draft: { orderedEntityRefs: m.draftRefs } }),
    { getState: () => ({ addEntityToDraft: m.addEntityToDraft }) },
  ),
}));
vi.mock('../../shell/lcosShellStore', () => ({
  useLcosShellStore: Object.assign(
    (selector: (state: typeof m.shellState) => unknown) => selector(m.shellState),
    { getState: () => m.shellState },
  ),
}));
vi.mock('../../ui/workflow/WorkflowTaskCardView', () => ({
  WorkflowTaskCardView: ({ onEnter, onPreview, onUse, onDragStartCapture, onDragEndCapture, draggable, entryAvailable, entryTargetLabel, alreadyInDraft, summary }: {
    onEnter: () => void; onPreview: () => void; onUse?: (anchor: { x: number; y: number; width: number; height: number }) => void;
    onDragStartCapture?: (event: React.DragEvent<HTMLElement>) => void; onDragEndCapture?: () => void; draggable?: boolean;
    entryAvailable: boolean; entryTargetLabel?: string; alreadyInDraft?: boolean; summary?: string;
  }) => <div>
    <span data-entry-target>{entryTargetLabel ?? ''}</span>
    <span data-summary>{summary ?? ''}</span>
    <div data-assembly-drag-source draggable={draggable} onDragStartCapture={onDragStartCapture} onDragEndCapture={onDragEndCapture} />
    <button data-preview onClick={onPreview}>预览</button>
    {onUse && <button data-use onClick={() => onUse({ x: 48, y: 64, width: 120, height: 36 })}>{alreadyInDraft ? '已加入草稿' : '加入当前草稿'}</button>}
    <button data-enter disabled={!entryAvailable} onClick={onEnter}>进入</button>
  </div>,
}));


import type { Workspace } from '@local-creative-os/domain';
import type * as WebGen2 from '@local-creative-os/web-gen2';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
  useLcosDropStore.getState().reset();
  m.draftRefs.length = 0;
  m.shellState.activeWorkspaceId = 'source';
  m.shellState.composerTarget = null;
});
async function mount(canvasId?: string) {
  const el = document.createElement('div'); document.body.append(el); const root = createRoot(el); roots.push(root);
  const target = { id: 'w1', name: '真实工作流现场', scopeId: 'wf1', preferredSurface: 'workflow', ...(canvasId === undefined ? {} : { canvasId }) } as Workspace;
  await act(async () => root.render(<WorkflowCardPool projectId="p1" sourceSurface="workflow" sourceWasChild={false} workspaces={[target]} onLeaveHand={m.onEntered} />));
  return el;
}
async function mountHandOverlay() {
  const el = document.createElement('div'); document.body.append(el); const root = createRoot(el); roots.push(root);
  await act(async () => root.render(<WorkflowHandOverlay projectId="p1" sourceSurface="workflow" sourceWasChild={false} workspaces={[]} open onClose={m.onEntered} />));
  return el;
}
it('light preview does not close the hand; successful entry retracts it through its existing owner', async () => {
  m.enter.mockReturnValue(true); const el = await mount('child-canvas');
  await act(async () => el.querySelector<HTMLButtonElement>('[data-preview]')?.click());
  expect(m.onEntered).not.toHaveBeenCalled(); expect(m.enter).not.toHaveBeenCalled();
  await act(async () => el.querySelector<HTMLButtonElement>('[data-enter]')?.click());
  expect(m.enter).toHaveBeenCalledWith(expect.objectContaining({ targetWorkspace: expect.objectContaining({ id: 'w1', canvasId: 'child-canvas' }) }));
  expect(m.onEntered).toHaveBeenCalledTimes(1);
});
it('a navigation refusal keeps the hand and its failure feedback', async () => {
  m.enter.mockReturnValue(false); const el = await mount('child-canvas');
  await act(async () => el.querySelector<HTMLButtonElement>('[data-enter]')?.click());
  expect(m.onEntered).not.toHaveBeenCalled();
  expect(el.textContent).toContain('工作流现场暂时无法进入');
});
it('a missing real canvas never pretends to have entered or closes the hand', async () => {
  const el = await mount();
  expect(el.querySelector<HTMLButtonElement>('[data-enter]')?.disabled).toBe(true);
  await act(async () => el.querySelector<HTMLButtonElement>('[data-enter]')?.click());
  expect(m.enter).not.toHaveBeenCalled(); expect(m.onEntered).not.toHaveBeenCalled();
});

it('keeps an unsupported workflow identity out of the message draft and preserves the current target', async () => {
  const target = {
    nodeId: 'conversation:conversation-a', title: '现有会话', anchor: { x: 1, y: 2, width: 3, height: 4 },
    intent: 'delegate' as const, receiverConversationId: 'conversation-a',
    targetReferences: [{ entityType: 'artifact', entityId: 'target-artifact' }],
  };
  m.shellState.composerTarget = target;
  const el = await mount('child-canvas');
  expect(el.querySelector('[data-entry-target]')?.textContent).toBe('真实工作流现场');
  expect(el.querySelector('[data-use]')).toBeNull();
  expect(el.querySelector<HTMLButtonElement>('[data-enter]')?.disabled).toBe(false);
  expect(el.querySelector('[data-assembly-drag-source]')?.getAttribute('draggable')).toBe('true');
  await act(async () => el.querySelector<HTMLButtonElement>('[data-preview]')?.click());
  expect(el.querySelector('[data-summary]')?.textContent).toBe('这张卡用于进入工作流现场。需要在输入框使用方法时，请选择已有的方法文件。');
  expect(m.addEntityToDraft).not.toHaveBeenCalled();
  expect(m.shellState.openComposer).not.toHaveBeenCalled();
  expect(m.onEntered).not.toHaveBeenCalled();
  expect(m.shellState.composerTarget).toBe(target);
});

it('keeps the existing receiver when a workflow has no take action for the input box', async () => {
  const target = { nodeId: 'conversation:conversation-a', title: '现有会话', anchor: { x: 1, y: 2, width: 3, height: 4 }, intent: 'continue' as const, receiverConversationId: 'conversation-a' };
  m.shellState.composerTarget = target;
  const el = await mount('child-canvas');
  expect(el.querySelector('[data-use]')).toBeNull();
  await act(async () => el.querySelector<HTMLButtonElement>('[data-preview]')?.click());
  expect(m.shellState.openComposer).not.toHaveBeenCalled();
  expect(m.onEntered).not.toHaveBeenCalled();
  expect(el.querySelector('[data-summary]')?.textContent).toContain('已有的方法文件');
  expect(m.addEntityToDraft).not.toHaveBeenCalled();
  expect(m.shellState.composerTarget).toBe(target);
});

it('starts the native Assembly transport from the Warehouse identity and cancels on dragend', async () => {
  const el = await mount('child-canvas');
  const source = el.querySelector<HTMLDivElement>('[data-assembly-drag-source]');
  expect(source?.getAttribute('draggable')).toBe('true');
  const setData = vi.fn();
  const dataTransfer = { effectAllowed: 'uninitialized', setData };
  const start = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(start, 'dataTransfer', { value: dataTransfer });
  await act(async () => source?.dispatchEvent(start));
  expect(setData).toHaveBeenCalledWith(ASSEMBLY_DRAG_MIME, JSON.stringify({
    itemId: 'wf1', sourceRef: { kind: 'workflow', id: 'wf1' }, entityRef: { type: 'workflow', id: 'wf1' },
  }));
  expect(useLcosDropStore.getState().state).toMatchObject({
    status: 'tracking', payload: { kind: 'assembly', itemId: 'wf1', sourceRef: { kind: 'workflow', id: 'wf1' },
      entityRef: { type: 'workflow', id: 'wf1' } },
  });
  await act(async () => source?.dispatchEvent(new Event('dragend', { bubbles: true })));
  expect(useLcosDropStore.getState().state.status).toBe('idle');
});

it('keeps the Warehouse drag source mounted while the production hand opens Canvas hit-testing', async () => {
  const el = await mountHandOverlay();
  const source = el.querySelector<HTMLDivElement>('[data-assembly-drag-source]');
  expect(source?.getAttribute('draggable')).toBe('true');
  const start = new Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(start, 'dataTransfer', { value: { effectAllowed: 'uninitialized', setData: vi.fn() } });

  await act(async () => source?.dispatchEvent(start));

  expect(useLcosDropStore.getState().state.status).toBe('tracking');
  expect(el.querySelector('[data-lcos-workflow-hand]')?.getAttribute('data-native-assembly-drop')).toBe('true');
  expect(el.querySelector('[data-assembly-drag-source]')).toBe(source);
  expect(source?.isConnected).toBe(true);
  expect(m.onEntered).not.toHaveBeenCalled();
});

it('keeps the hand while a real entry promise is pending and on failed completion', async () => {
  let complete!: (value: boolean) => void;
  m.enter.mockImplementation(() => new Promise<boolean>(resolve => { complete = resolve; }));
  const el = await mount('child-canvas');
  await act(async () => el.querySelector<HTMLButtonElement>('[data-enter]')?.click());
  expect(m.onEntered).not.toHaveBeenCalled();
  await act(async () => complete(false));
  expect(m.onEntered).not.toHaveBeenCalled(); expect(el.textContent).toContain('工作流现场暂时无法进入');
});

it('does not request seventeen skills or let them turn one workflow into a large pool', async () => {
  const el = await mount('child-canvas');
  expect(m.skills).not.toHaveBeenCalled();
  expect(m.browse).toHaveBeenCalledWith(expect.anything(), 'p1', '', 'workflow');
  expect(el.querySelector('[data-card-layout]')?.getAttribute('data-card-layout')).toBe('hand');
  expect(el.querySelectorAll('[data-preview]')).toHaveLength(1);
  expect(el.querySelector('[data-lcos-card-lane="material"]')).toBeNull();
  expect(el.querySelector('[data-lcos-card-lane="receiver"]')).toBeNull();
});
