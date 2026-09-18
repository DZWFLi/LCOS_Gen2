import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
  navigate: vi.fn(),
  beginChildNavigation: vi.fn(),
}));

// R4：AssemblyBody 现在消费 web-gen2 的 AssemblySourceBayController / assemblyCardView，
// 以及 lcosDropState 的 idleDrop——必须 partial mock，否则整棵模块图会拿到 undefined。
vi.mock('@local-creative-os/web-gen2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@local-creative-os/web-gen2')>();
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
    addEntityToDraft: () => {},
  };
  const store = (selector?: (value: typeof state) => unknown) =>
    selector === undefined ? state : selector(state);
  return { useLcosReferenceStore: Object.assign(store, { getState: () => state }) };
});
vi.mock('../shell/lcosShellStore', () => ({
  useLcosShellStore: (
    select: (state: {
      openWindow: typeof mocks.openWindow;
      activeSurface: 'main';
      activeWorkspaceId: null;
      beginChildNavigation: typeof mocks.beginChildNavigation;
    }) => unknown,
  ) => select({
    openWindow: mocks.openWindow,
    activeSurface: 'main',
    activeWorkspaceId: null,
    beginChildNavigation: mocks.beginChildNavigation,
  }),
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
  mocks.navigate.mockReset();
  mocks.beginChildNavigation.mockReset();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(projectId: string): Promise<void> {
  await act(async () => {
    root.render(
      <AssemblyBody projectId={projectId} targetRef={{ kind: 'main' }} />,
    );
  });
}

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
  if (!take) throw new Error('取用 action missing');
  await act(async () => take.click());
  const open = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.includes('预览现场'),
  );
  if (!open) throw new Error('现场 open action missing');
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
  if (!take) throw new Error('取用 action missing');
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
  if (!take) throw new Error('取用 action missing');
  await act(async () => take.click());
  const enter = [...host.querySelectorAll<HTMLButtonElement>('[data-test-dropdown-item]')]
    .find((button) => button.textContent?.includes('进入现场'));
  if (!enter) throw new Error('进入现场 action missing');
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
