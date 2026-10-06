import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { composerInputKey } from '../composer/composerInputJourney';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  warehouse: vi.fn(),
  apply: vi.fn(),
  captureSnapshot: vi.fn(),
  capturePreview: vi.fn(),
  resourceList: vi.fn(),
  resourceDescriptor: vi.fn(),
  skillList: vi.fn(),
  skillRead: vi.fn(),
  workspaces: vi.fn(),
  openWindow: vi.fn(),
  openComposer: vi.fn(),
  closeComposer: vi.fn(),
  addReference: vi.fn(),
  navigate: vi.fn(),
  beginChildNavigation: vi.fn(),
  composerTarget: null as {
    nodeId: string;
    title: string;
    anchor: { x: number; y: number; width: number; height: number };
    intent: 'delegate';
    workspaceId: string;
  } | null,
}));

// R4：AssemblyBody 现在消费 web-gen2 的 AssemblySourceBayController / assemblyCardView，
// 以及 lcosDropState 的 idleDrop——必须 partial mock，否则整棵模块图会拿到 undefined。
vi.mock('@local-creative-os/web-gen2', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    CoreAssemblyClient: class {
      getWarehouse = mocks.warehouse;
      queryWarehouse = mocks.warehouse;
      apply = mocks.apply;
    },
  };
});
vi.mock('../app/lcosCoreClient', () => ({
  createLcosCoreSession: () => ({
    http: {},
    projects: { getWorkspaces: mocks.workspaces },
    assembly: { getWarehouse: mocks.warehouse, queryWarehouse: mocks.warehouse, apply: mocks.apply },
    captureSpace: { snapshot: mocks.captureSnapshot, preview: mocks.capturePreview },
    resources: { list: mocks.resourceList, descriptor: mocks.resourceDescriptor },
    skills: { list: mocks.skillList, read: mocks.skillRead },
  }),
}));
vi.mock('../lcosReferenceState', () => {
  const state = {
    draft: { orderedEntityRefs: [] as readonly { entityType: string; entityId: string }[] },
    addEntityToDraft: mocks.addReference,
  };
  const store = (selector?: (value: typeof state) => unknown) =>
    selector === undefined ? state : selector(state);
  return { useLcosReferenceStore: Object.assign(store, { getState: () => state }) };
});
vi.mock('../shell/lcosShellStore', () => {
  const shellState = {
    openWindow: mocks.openWindow,
    openComposer: mocks.openComposer,
    closeComposer: mocks.closeComposer,
    composerOpen: false as boolean,
    composerTarget: null as typeof mocks.composerTarget,
    activeSurface: 'main' as const,
    activeWorkspaceId: null,
    beginChildNavigation: mocks.beginChildNavigation,
  };
  const currentShellState = () => ({
    ...shellState,
    composerOpen: mocks.composerTarget !== null,
    composerTarget: mocks.composerTarget,
  });
  const useLcosShellStore = Object.assign(
    (select: (state: typeof shellState) => unknown) => select(currentShellState()),
    { getState: currentShellState },
  );
  return { useLcosShellStore };
});
vi.mock('../navigation/childWorksiteNavigation', () => ({
  beginChildWorksiteNavigation: (input: {
    readonly projectId: string;
    readonly targetSurface: string;
    readonly targetWorkspace: { readonly id: string };
    readonly navigate: (to: string) => void;
  }) => {
    mocks.beginChildNavigation(input);
    input.navigate(`/projects/${encodeURIComponent(input.projectId)}/${input.targetSurface}?workspaceId=${encodeURIComponent(String(input.targetWorkspace.id))}`);
    return true;
  },
}));
vi.mock('../composer/LcosComposerHost', () => ({
  LcosComposerHost: () => <div data-lcos-composer />,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../ui/LcosSurfaceFeedback', () => ({
  LcosSurfaceFeedback: ({ message }: { message: string }) => (
    <div>{message}</div>
  ),
}));
vi.mock('../ui/lcosTokens', () => ({
  lcosTokens: {
    color: {
      raised: '#eee',
      muted: '#888',
      surface: '#fff',
      borderSubtle: '#ddd',
      text: '#111',
      info: '#06c',
      inverse: '#111',
      textOnInverse: '#fff',
      accent: '#0a0',
      danger: '#a00',
    },
    shadow: { default: 'none' },
  },
}));
vi.mock('@/components/Common/DropdownMenu', () => ({
  DropdownMenu: ({
    trigger,
    children,
  }: {
    trigger: ReactElement;
    children: ReactNode;
  }) => (
    <div data-test-dropdown>
      {trigger}
      {children}
    </div>
  ),
  DropdownMenuItem: ({
    children,
    ...props
  }: {
    children: ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" data-test-dropdown-item {...props}>
      {children}
    </button>
  ),
  DropdownMenuSubmenu: ({ label, children }: { label: ReactNode; children: ReactNode }) => (
    <div data-test-dropdown-submenu>
      <span data-test-dropdown-submenu-label>{label}</span>
      {children}
    </div>
  ),
}));

import { AssemblyBody } from './AssemblyBody';

import type { ReactElement, ReactNode } from 'react';

const artifact = (id: string, title: string) => ({
  entityRef: { id },
  kind: 'artifact',
  title,
  usageCount: 0,
});
const scene = (id: string, title: string) => ({
  entityRef: { id },
  kind: 'scene',
  title,
  usageCount: 0,
});
const context = (id: string, title: string) => ({
  entityRef: { id },
  kind: 'context',
  title,
  usageCount: 0,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  mocks.warehouse.mockReset();
  mocks.apply.mockReset();
  mocks.captureSnapshot.mockReset();
  mocks.capturePreview.mockReset();
  mocks.resourceList.mockReset();
  mocks.resourceDescriptor.mockReset();
  mocks.skillList.mockReset();
  mocks.skillRead.mockReset();
  mocks.workspaces.mockReset();
  mocks.openWindow.mockReset();
  mocks.openComposer.mockReset();
  mocks.closeComposer.mockReset();
  mocks.addReference.mockReset();
  mocks.navigate.mockReset();
  mocks.beginChildNavigation.mockReset();
  mocks.composerTarget = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

const mainTargetRef = { kind: 'main' } as const;
async function render(projectId: string, composerOriginKey?: string): Promise<void> {
  await act(async () => {
    root.render(
      <AssemblyBody projectId={projectId} targetRef={mainTargetRef}
        {...(composerOriginKey === undefined ? {} : { composerOriginKey })} />,
    );
  });
}

it('opens the canonical archive body from Assembly instead of fabricating a second page', async () => {
  mocks.warehouse.mockResolvedValue({ items: [] });
  mocks.workspaces.mockResolvedValue([]);
  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value);
  const archive = [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.includes('查看归档'));
  if (!archive) throw new Error('archive entry missing');
  await act(async () => archive.click());
  expect(mocks.openWindow).toHaveBeenCalledWith('archive', '归档');
});

it('uses plain Chinese for read failures while keeping the real diagnostic code in a tooltip', async () => {
  mocks.warehouse.mockRejectedValue(Object.assign(new Error('failed'), { code: 'READ_SOURCE_42' }));
  mocks.workspaces.mockResolvedValue([]);
  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value.catch(() => undefined));
  const failure = host.querySelector<HTMLElement>('[data-lcos-assembly-error="project"]');
  expect(failure?.textContent).toContain('材料读取失败，请重试。');
  expect(failure?.textContent).not.toContain('READ_SOURCE_42');
  expect(failure?.title).toBe('读取诊断代码：READ_SOURCE_42');
});

it('cannot let a late A response replace the already loaded B warehouse', async () => {
  const a = deferred<{ items: readonly unknown[] }>();
  const b = deferred<{ items: readonly unknown[] }>();
  mocks.warehouse.mockImplementation((projectId: string) =>
    projectId === 'project-a' ? a.promise : b.promise,
  );
  mocks.workspaces.mockResolvedValue([]);

  await render('project-a');
  await render('project-b');
  b.resolve({ items: [artifact('b-artifact', 'B 内容')] });
  await act(async () => b.promise);
  expect(host.textContent).toContain('B 内容');

  a.resolve({ items: [artifact('a-artifact', 'A 内容')] });
  await act(async () => a.promise);
  expect(host.textContent).toContain('B 内容');
  expect(host.textContent).not.toContain('A 内容');
});

it('opens a scene using the resolved real workspace canvas id', async () => {
  mocks.warehouse.mockResolvedValue({
    items: [scene('workspace-1', '现场一')],
  });
  mocks.workspaces.mockResolvedValue([
    { id: 'workspace-1', canvasId: 'canvas-real' },
  ]);

  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value);
  const take = host.querySelector<HTMLButtonElement>(
    '[data-lcos-assembly-more]',
  );
  if (!take) { throw new Error('取用 action missing'); }
  await act(async () => take.click());
  const open = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.includes('预览现场'),
  );
  if (!open) { throw new Error('现场 open action missing'); }
  await act(async () => open.click());

  expect(mocks.openWindow).toHaveBeenCalledWith(
    'portal-preview',
    '预览现场 · 现场一',
    'canvas-real',
    'canvas',
  );
});

it('keeps artifact cards available when workspace loading fails', async () => {
  mocks.warehouse.mockResolvedValue({
    items: [artifact('artifact-1', '可用材料')],
  });
  mocks.workspaces.mockRejectedValue(new Error('workspace unavailable'));

  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value);
  expect(host.textContent).toContain('可用材料');
  expect(
    host.querySelector('[data-lcos-assembly-item="artifact-1"]'),
  ).not.toBeNull();
});

it('takes a canonical conversation into the shared Composer with the exact receiver', async () => {
  mocks.warehouse.mockResolvedValue({
    items: [{ entityRef: { id: 'conversation-a' }, kind: 'conversation', title: '会话 A', usageCount: 0 }],
  });
  mocks.workspaces.mockResolvedValue([]);

  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-more]')?.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-add]')?.click());

  expect(mocks.addReference).toHaveBeenCalledWith(expect.objectContaining({
    entityType: 'conversation',
    entityId: 'conversation-a',
    displayLabel: '会话 A',
  }));
  expect(mocks.openComposer).toHaveBeenCalledWith(expect.objectContaining({
    nodeId: 'assembly:conversation:conversation-a',
    receiverConversationId: 'conversation-a',
    title: '会话 A',
  }));
  expect(mocks.openComposer.mock.calls[0]?.[0]).not.toHaveProperty('receiverBlockedReason');
});

it('keeps a material reference but fails closed with a real receiver reason', async () => {
  mocks.warehouse.mockResolvedValue({
    items: [artifact('artifact-a', '材料 A')],
  });
  mocks.workspaces.mockResolvedValue([]);

  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value);
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-more]')?.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-add]')?.click());

  expect(mocks.addReference).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'artifact', entityId: 'artifact-a' }));
  expect(mocks.openComposer).toHaveBeenCalledWith(expect.objectContaining({
    nodeId: 'assembly:artifact:artifact-a',
    receiverBlockedReason: '尚未选择会话接收者；请从会话窗口打开 Composer 后再提交',
  }));
});

it('offers every exact context scope workspace and opens the selected canvas', async () => {
  mocks.warehouse.mockResolvedValue({
    items: [context('scope-c', '上下文 C')],
  });
  mocks.workspaces.mockResolvedValue([
    {
      id: 'workspace-1',
      scopeId: 'scope-c',
      name: '现场一',
      canvasId: 'canvas-one',
    },
    {
      id: 'workspace-2',
      scopeId: 'scope-c',
      name: '现场二',
      canvasId: 'canvas-two',
    },
    {
      id: 'workspace-other',
      scopeId: 'scope-other',
      name: '无关现场',
      canvasId: 'canvas-other',
    },
    {
      id: 'workspace-empty',
      scopeId: 'scope-c',
      name: '未就绪现场',
      canvasId: undefined,
    },
  ]);

  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value);
  expect(mocks.openWindow).not.toHaveBeenCalled();

  const take = host.querySelector<HTMLButtonElement>(
    '[data-lcos-assembly-more]',
  );
  if (!take) { throw new Error('取用 action missing'); }
  await act(async () => take.click());

  const menuItems = [
    ...host.querySelectorAll<HTMLButtonElement>('[data-test-dropdown-item]'),
  ];
  expect(menuItems.map((item) => item.textContent)).toEqual([
    '预览现场',
    '进入现场',
    '预览现场',
    '进入现场',
    '预览现场',
    '进入现场',
  ]);
  expect(menuItems[4]?.disabled).toBe(true);
  expect(menuItems[5]?.disabled).toBe(true);

  await act(async () => menuItems[2]?.click());
  expect(mocks.openWindow).toHaveBeenCalledTimes(1);
  expect(mocks.openWindow).toHaveBeenCalledWith(
    'portal-preview',
    '预览现场 · 现场二',
    'canvas-two',
    'canvas',
  );
});

it('enters an exact context child workspace through the shared route, without guessing a canvas', async () => {
  mocks.warehouse.mockResolvedValue({
    items: [context('scope-c', '上下文 C')],
  });
  mocks.workspaces.mockResolvedValue([
    { id: 'workspace-context', scopeId: 'scope-c', name: 'Context 子现场', canvasId: 'canvas-context' },
  ]);

  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value);
  const take = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-more]');
  if (!take) { throw new Error('取用 action missing'); }
  await act(async () => take.click());
  const enter = [...host.querySelectorAll<HTMLButtonElement>('[data-test-dropdown-item]')]
    .find((button) => button.textContent?.includes('进入现场'));
  if (!enter) { throw new Error('进入现场 action missing'); }
  await act(async () => enter.click());

  expect(mocks.beginChildNavigation).toHaveBeenCalledWith(expect.objectContaining({
    projectId: 'project-a',
    sourceSurface: 'main',
    sourceWasChild: false,
  }));
  expect(mocks.navigate).toHaveBeenCalledWith('/projects/project-a/context?workspaceId=workspace-context');
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}


it('uses the canonical scope reference type when taking a workflow into the draft', async () => {
  mocks.warehouse.mockResolvedValue({ items: [{ entityRef: { id: 'workflow-scope' }, kind: 'workflow', title: '工作流', usageCount: 0 }] });
  mocks.workspaces.mockResolvedValue([]);
  await render('project-a');
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-add]')?.click());
  expect(mocks.addReference).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'scope', entityId: 'workflow-scope' }));
  expect(mocks.apply).not.toHaveBeenCalled();
});

it('submits selected source identities once and retains only incomplete selections', async () => {
  mocks.warehouse.mockResolvedValue({ items: [artifact('a', '材料 A'), artifact('b', '材料 B')] });
  mocks.workspaces.mockResolvedValue([]);
  const pending = deferred<unknown>();
  mocks.apply.mockReturnValue(pending.promise);
  await render('project-a');
  await act(async () => {
    host.querySelector<HTMLInputElement>('input[aria-label="选择 材料 A"]')?.click();
    host.querySelector<HTMLInputElement>('input[aria-label="选择 材料 B"]')?.click();
  });
  const apply = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-batch-apply]');
  expect(apply).not.toBeNull();
  await act(async () => { apply?.click(); apply?.click(); });
  expect(mocks.apply).toHaveBeenCalledTimes(1);
  expect(mocks.apply).toHaveBeenCalledWith('project-a', expect.objectContaining({
    projectId: 'project-a', targetRef: { kind: 'main' },
    sourceRefs: [{ kind: 'artifactView', id: 'a' }, { kind: 'artifactView', id: 'b' }],
  }));
  expect(apply?.disabled).toBe(true);
  pending.resolve({ schemaVersion: 1, projectId: 'project-a', allApplied: false, results: [
    { sourceRef: { kind: 'artifactView', id: 'a' }, status: 'applied', channel: 'main', changeSetId: 'change-a' },
    { sourceRef: { kind: 'artifactView', id: 'b' }, status: 'failed', channel: 'error', message: '未落地' },
  ] });
  await act(async () => pending.promise);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="选择 材料 A"]')?.checked).toBe(false);
  expect(host.querySelector<HTMLInputElement>('input[aria-label="选择 材料 B"]')?.checked).toBe(true);
  expect(host.textContent).toContain('1 项落地');
  expect(host.textContent).not.toContain('全部成功');
});

it('keeps the failed-apply retry guard current after Assembly enters Composer reference picking', async () => {
  mocks.warehouse.mockResolvedValue({ schemaVersion: 1, projectId: 'project-a', totalApprox: 1, items: [
    { schemaVersion: 1, entityRef: { id: 'context-a', type: 'context' }, kind: 'context', title: '上下文 A', usageCount: 0 },
  ] });
  mocks.workspaces.mockResolvedValue([]);
  mocks.apply.mockResolvedValue({
    schemaVersion: 1,
    projectId: 'project-a',
    allApplied: false,
    results: [{ sourceRef: { kind: 'context', id: 'context-a' }, status: 'failed', channel: 'error', message: '未落地' }],
  });
  await render('project-a');
  await act(async () => mocks.warehouse.mock.results[0]?.value);
  expect(host.textContent).toContain('上下文 A');

  const drop = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-drop]');
  if (!drop) throw new Error('Assembly apply action missing');
  await act(async () => { drop.click(); await Promise.resolve(); });
  expect(mocks.apply).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-lcos-assembly-retry-failed]')).not.toBeNull();

  const target = {
    nodeId: 'main-node', title: '施工纪律', anchor: { x: 20, y: 30, width: 140, height: 44 },
    intent: 'delegate' as const, workspaceId: 'workspace-main',
  };
  const originKey = composerInputKey(target);
  if (originKey === undefined) throw new Error('Composer input key is missing');
  mocks.composerTarget = target;
  await render('project-a', originKey);

  const retry = host.querySelector<HTMLButtonElement>('[data-lcos-assembly-retry-failed]');
  if (!retry) throw new Error('Retry control missing after entering Composer reference picking');
  await act(async () => retry.click());
  expect(mocks.apply).toHaveBeenCalledTimes(1);
});

it('does not call an unconfirmed transport failure a failed write or retry it automatically', async () => {
  mocks.warehouse.mockResolvedValue({ items: [artifact('a', '材料 A')] });
  mocks.workspaces.mockResolvedValue([]);
  mocks.apply.mockRejectedValue(new Error('连接中断'));
  await render('project-a');
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-drop]')?.click());
  expect(host.textContent).toContain('未收到完整装配回执');
  expect(host.textContent).toContain('尚未确认');
  expect(host.textContent).not.toContain('投放失败 · 没有来源落地');
  expect(mocks.apply).toHaveBeenCalledTimes(1);
});

it('does not reopen a source preview when its late result arrives after closing', async () => {
  mocks.warehouse.mockResolvedValue({ items: [] });
  mocks.workspaces.mockResolvedValue([]);
  mocks.captureSnapshot.mockResolvedValue({ items: [{ id: 'capture-a', kind: 'web_page', source: { title: '原始网页', url: 'https://example.org/a' } }] });
  const pending = deferred<unknown>();
  mocks.capturePreview.mockReturnValue(pending.promise);
  await render('project-a');
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-source-tab="capture"]')?.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-preview-open="capture:capture-a"]')?.click());
  expect(host.querySelector('[data-lcos-assembly-preview]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[data-lcos-assembly-preview-close]')?.click());
  pending.resolve({ type: 'text', text: '已经关闭的旧内容' });
  await act(async () => pending.promise);
  expect(host.querySelector('[data-lcos-assembly-preview]')).toBeNull();
  expect(host.textContent).not.toContain('已经关闭的旧内容');
});
