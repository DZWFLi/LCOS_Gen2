import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContextAtlasStage } from './ContextAtlasStage';
import FolderComponent from '../../ui/context/RareFolderComponent';

import type { WarehouseItemV1, WarehouseSnapshotV1 } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';
import type { ReactNode } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  queryWarehouse: vi.fn(),
  nodeEntityRefs: new Map<string, { entityId: string; entityType: string }>(),
}));

vi.mock('@local-creative-os/web-gen2', () => ({
  CoreAssemblyClient: class {
    queryWarehouse(...args: unknown[]) {
      return mocks.queryWarehouse(...args);
    }
  },
  HttpError: class HttpError extends Error {},
}));
vi.mock('../../app/lcosCoreClient', () => ({
  createLcosCoreSession: () => ({ http: {} }),
}));
vi.mock('../../nodes/CanonicalCollectionView', () => ({
  CanonicalCollectionView: ({ title, onActivate, activationLabel, selected, previewUrl, action }: {
    title: string;
    onActivate?: () => void;
    activationLabel?: string;
    selected?: boolean;
    previewUrl?: string;
    action?: ReactNode;
  }) => <div data-canonical-collection>
    {previewUrl && <img src={previewUrl} alt={`${title} 封面`} />}
    <button type="button" className="lcos-context-collection-hit" aria-label={activationLabel} aria-pressed={selected} onClick={onActivate} />
    {title}{action}
  </div>,
}));
vi.mock('@/hooks/useCloseOnEscape', () => ({
  useCloseOnEscape: () => undefined,
}));
vi.mock('../../lcosReferenceState', () => ({
  useLcosReferenceStore: { getState: () => ({ nodeEntityRefs: mocks.nodeEntityRefs }) },
}));
vi.mock('../../ui/LcosSurfaceFeedback', () => ({
  LcosSurfaceFeedback: ({ message, onAction, actionLabel }: { message?: string; onAction?: () => void; actionLabel?: string }) => (
    <div data-feedback>{message}{onAction ? <button onClick={onAction}>{actionLabel}</button> : null}</div>
  ),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function snapshot(id: string): WarehouseSnapshotV1 {
  return {
    schemaVersion: 1,
    projectId: id,
    items: [
      {
        schemaVersion: 1,
        entityRef: { type: 'context', id },
        kind: 'context',
        title: id,
        usageCount: 0,
      },
    ],
    totalApprox: 1,
  };
}

function renderAtlas(
  projectId: string,
  mode?: 'context' | 'main-collections',
  currentContextId?: string,
  options: {
    readonly workspaces?: readonly Workspace[];
    readonly onEnterSurface?: (item: WarehouseItemV1, workspace?: Workspace) => boolean | Promise<boolean>;
  } = {},
) {
  const host = document.createElement('div');
  const root = createRoot(host);
  root.render(
    <ContextAtlasStage
      projectId={projectId}
      {...(mode === undefined ? {} : { mode })}
      {...(currentContextId === undefined ? {} : { currentContextId })}
      workspaces={options.workspaces ?? []}
      onClose={vi.fn()}
      onEnterSurface={options.onEnterSurface ?? (() => true)}
    />,
  );
  return { host, root };
}

beforeEach(() => {
  mocks.nodeEntityRefs.clear();
});

describe('ContextAtlasStage warehouse ownership', () => {
  it('selects a Context card as a preview, then enters through its exact real workspace', async () => {
    const item = {
      schemaVersion: 1,
      kind: 'context',
      entityRef: { type: 'context', id: 'context-1' },
      title: '研究现场',
      previewRef: 'https://assets.example/context-cover.jpg',
      usageCount: 0,
    } satisfies WarehouseItemV1;
    const secondItem = {
      ...item,
      entityRef: { type: 'context', id: 'context-2' },
      title: '第二现场',
      previewRef: 'https://assets.example/context-cover-2.jpg',
    } satisfies WarehouseItemV1;
    const workspace = {
      id: 'workspace-1',
      projectId: 'project',
      scopeId: 'context-1',
      name: '研究现场真实现场',
      intent: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      focusedViewIds: [],
      visibleLayers: [],
      contextPolicy: 'workspace-related',
      updatedAt: '2026-09-14T10:00:00.000Z',
      canvasId: 'canvas-context-1',
    } as unknown as Workspace;
    const enter = vi.fn(() => true);
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockResolvedValue({ ...snapshot('project'), items: [item, secondItem] } satisfies WarehouseSnapshotV1);

    const { host, root } = renderAtlas('project', 'context', undefined, {
      workspaces: [workspace],
      onEnterSurface: enter,
    });
    await act(async () => {});

    const selectPreview = host.querySelector<HTMLButtonElement>('.lcos-context-collection-hit');
    const folder = host.querySelector<HTMLElement>('[data-slot="folder"]');
    expect(selectPreview?.getAttribute('aria-pressed')).toBe('false');
    expect(selectPreview?.getAttribute('aria-label')).toBe('选中并预览 · 研究现场');
    expect(folder?.getAttribute('data-folder-selected')).toBe('false');
    expect(folder?.getAttribute('data-folder-open')).toBe('false');
    expect(host.querySelector('.lcos-context-collection-pocket-base')).toBeNull();
    expect(host.querySelector('.lcos-context-collection-pocket')).toBeNull();

    await act(async () => selectPreview?.click());
    expect(selectPreview?.getAttribute('aria-pressed')).toBe('true');
    expect(folder?.getAttribute('data-folder-selected')).toBe('true');
    expect(folder?.getAttribute('data-folder-open')).toBe('true');
    expect(host.textContent).toContain('卡面使用此上下文集合的现有预览资源');
    expect(host.querySelector('img[alt="研究现场 封面"]')?.getAttribute('src')).toBe(item.previewRef);
    expect(host.querySelector('[data-slot="folder-card"] .lcos-preview-media img')?.getAttribute('src')).toBe(item.previewRef);
    const filterIds = [...host.querySelectorAll('[data-slot="folder"] filter')].map((filter) => filter.id);
    expect(filterIds).toHaveLength(8);
    expect(new Set(filterIds).size).toBe(filterIds.length);

    const enterButton = host.querySelector<HTMLButtonElement>('[aria-label="进入 研究现场 现场"]');
    expect(enterButton).not.toBeNull();
    await act(async () => enterButton?.click());
    expect(enter).toHaveBeenCalledWith(item, workspace);
    root.unmount();
  });

  it('requests and renders only canonical Context blocks; scenes and generic collections stay out of Context Atlas', async () => {
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockResolvedValue({ ...snapshot('project'), items: [
      { schemaVersion: 1, kind: 'collection', entityRef: { type: 'collection', id: 'c-1' }, title: '集合', usageCount: 0 },
      { schemaVersion: 1, kind: 'scene', entityRef: { type: 'scene', id: 's-1' }, title: '工作空间目标', usageCount: 0 },
      { schemaVersion: 1, kind: 'context', entityRef: { type: 'context', id: 'x-1' }, title: '上下文', usageCount: 0 },
    ] } satisfies WarehouseSnapshotV1);
    const { host, root } = renderAtlas('project', 'context', 'x-1');
    await act(async () => {});
    expect([...host.querySelectorAll('[data-atlas-kind]')].map((node) => node.getAttribute('data-atlas-kind')))
      .toEqual(['context']);
    expect(mocks.queryWarehouse.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ kinds: ['context'] }));
    expect(host.textContent).toContain('1 个上下文集合');
    expect([...host.querySelectorAll('.lcos-context-collection-copy strong')].map((node) => node.textContent)).toEqual(['上下文']);
    expect(host.querySelectorAll('.collection-cover-empty')).toHaveLength(0);
    expect(host.querySelectorAll('[data-atlas-emblem]')).toHaveLength(1);
    expect(host.querySelector('[data-atlas-kind="context"]')?.closest('[data-lcos-context-collection-slot]')?.getAttribute('data-active')).toBe('true');
    expect(host.querySelectorAll('.lcos-context-collection-icon')).toHaveLength(0);
    expect(host.textContent).not.toContain('组织未标注');
    expect(host.textContent).not.toContain('暂无预览');
    root.unmount();
  });

  it('explains and invokes locate when a Context has a projection but no matching workspace', async () => {
    const item = {
      schemaVersion: 1,
      kind: 'context',
      entityRef: { type: 'context', id: 'context-projected' },
      title: '可定位的上下文',
      previewRef: 'https://assets.example/context-projected.jpg',
      usageCount: 0,
    } satisfies WarehouseItemV1;
    const locate = vi.fn(() => true);
    mocks.nodeEntityRefs.set('node-projection', { entityId: 'context-projected', entityType: 'context' });
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockResolvedValue({ ...snapshot('project'), items: [item] } satisfies WarehouseSnapshotV1);

    const { host, root } = renderAtlas('project', 'context', undefined, { onEnterSurface: locate });
    await act(async () => {});
    await act(async () => host.querySelector<HTMLButtonElement>('.lcos-context-collection-hit')?.click());

    expect(host.textContent).toContain('当前画布已有此上下文集合的真实投影');
    expect(host.querySelector('[aria-label="定位 可定位的上下文"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="定位 可定位的上下文"]')?.click());
    expect(locate).toHaveBeenCalledWith(item);
    root.unmount();
  });

  it('does not promise entry or locate when a Context has no workspace and no projection', async () => {
    const item = {
      schemaVersion: 1,
      kind: 'context',
      entityRef: { type: 'context', id: 'context-unmapped' },
      title: '尚无目标的上下文',
      usageCount: 0,
    } satisfies WarehouseItemV1;
    const enter = vi.fn(() => true);
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockResolvedValue({ ...snapshot('project'), items: [item] } satisfies WarehouseSnapshotV1);

    const { host, root } = renderAtlas('project', 'context', undefined, { onEnterSurface: enter });
    await act(async () => {});
    await act(async () => host.querySelector<HTMLButtonElement>('.lcos-context-collection-hit')?.click());

    expect(host.textContent).toContain('当前没有可进入或定位的上下文集合目标');
    expect(host.querySelector('.lcos-context-action-unavailable')?.textContent).toBe('暂无目标');
    expect(host.querySelector('[aria-label^="进入 "]')).toBeNull();
    expect(host.querySelector('[aria-label^="定位 "]')).toBeNull();
    expect(enter).not.toHaveBeenCalled();
    root.unmount();
  });

  it('uses Collection language and locate action in Main collection mode', async () => {
    const item = {
      schemaVersion: 1,
      kind: 'collection',
      entityRef: { type: 'collection', id: 'collection-projected' },
      title: '项目资料箱',
      usageCount: 0,
    } satisfies WarehouseItemV1;
    const locate = vi.fn(() => true);
    mocks.nodeEntityRefs.set('node-collection', { entityId: 'collection-projected', entityType: 'collection' });
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockResolvedValue({ ...snapshot('project'), items: [item] } satisfies WarehouseSnapshotV1);

    const { host, root } = renderAtlas('project', 'main-collections', undefined, { onEnterSurface: locate });
    await act(async () => {});
    await act(async () => host.querySelector<HTMLButtonElement>('.lcos-context-collection-hit')?.click());

    expect(host.textContent).toContain('此集合卡面展示真实成员预览，空集合与读取状态也会如实显示');
    expect(host.textContent).toContain('当前画布已有此集合的真实投影');
    expect(host.querySelector('[aria-label="定位 项目资料箱"]')).not.toBeNull();
    expect(host.querySelector('.lcos-atlas-focus-summary')?.textContent).not.toContain('上下文');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="定位 项目资料箱"]')?.click());
    expect(locate).toHaveBeenCalledWith(item);
    root.unmount();
  });

  it('Main collection mode requests canonical Collections and never shows worksite scenes', async () => {
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockResolvedValue({ ...snapshot('project'), items: [
      { schemaVersion: 1, kind: 'collection', entityRef: { type: 'collection', id: 'canonical' }, title: '真正集合', usageCount: 0 },
      { schemaVersion: 1, kind: 'scene', entityRef: { type: 'scene', id: 'workspace' }, title: '现场', usageCount: 0 },
      { schemaVersion: 1, kind: 'collection', entityRef: { type: 'context', id: 'wrong-ref' }, title: '非集合身份', usageCount: 0 },
    ] } satisfies WarehouseSnapshotV1);
    const { host, root } = renderAtlas('project', 'main-collections');
    await act(async () => {});
    expect(host.textContent).toContain('真正集合');
    expect(host.textContent).toContain('1 个集合');
    expect(mocks.queryWarehouse.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ kinds: ['collection'] }));
    expect(host.textContent).not.toContain('现场');
    expect(host.textContent).not.toContain('非集合身份');
    root.unmount();
  });

  it('moves focus to the collection name when the create panel is opened', async () => {
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockResolvedValue(snapshot('project'));
    const { host, root } = renderAtlas('project', 'main-collections');
    document.body.append(host);
    await act(async () => {});
    await act(async () => host.querySelector<HTMLButtonElement>('.lcos-atlas-create-toggle')?.click());
    expect(document.activeElement).toBe(host.querySelector<HTMLInputElement>('[aria-label="集合名称"]'));
    root.unmount();
    host.remove();
  });

  it('keeps the latest project request authoritative and clears stale cards while loading', async () => {
    const first = deferred<WarehouseSnapshotV1>();
    const second = deferred<WarehouseSnapshotV1>();
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockImplementation((projectId: string) =>
      projectId === 'project-a' ? first.promise : second.promise,
    );

    const { host, root } = renderAtlas('project-a');
    await act(async () => {});
    await act(async () => {
      root.render(
        <ContextAtlasStage
          projectId="project-b"
          workspaces={[]}
          onClose={vi.fn()}
          onEnterSurface={() => true}
        />,
      );
    });
    await act(async () => {});

    expect(host.textContent).toContain('正在读取上下文集合');
    expect(host.textContent).not.toContain('project-a');
    expect(mocks.queryWarehouse.mock.calls[0]?.[2]).toBeInstanceOf(AbortSignal);
    expect((mocks.queryWarehouse.mock.calls[0]?.[2] as AbortSignal).aborted).toBe(
      true,
    );

    await act(async () => {
      first.resolve(snapshot('project-a'));
    });
    expect(host.textContent).not.toContain('project-a');
    await act(async () => {
      second.resolve(snapshot('project-b'));
    });
    expect(host.textContent).toContain('project-b');
    root.unmount();
  });

  it('ignores a stale error after the newer project succeeds and aborts on unmount', async () => {
    const first = deferred<WarehouseSnapshotV1>();
    const second = deferred<WarehouseSnapshotV1>();
    mocks.queryWarehouse.mockReset();
    mocks.queryWarehouse.mockImplementation((projectId: string) =>
      projectId === 'project-a' ? first.promise : second.promise,
    );

    const { host, root } = renderAtlas('project-a');
    await act(async () => {});
    await act(async () => {
      root.render(
        <ContextAtlasStage
          projectId="project-b"
          workspaces={[]}
          onClose={vi.fn()}
          onEnterSurface={() => true}
        />,
      );
    });
    await act(async () => {
      second.resolve(snapshot('project-b'));
    });
    expect(host.textContent).toContain('project-b');
    await act(async () => {
      first.reject(new Error('stale failure'));
    });
    expect(host.textContent).toContain('project-b');

    root.unmount();
    expect((mocks.queryWarehouse.mock.calls[1]?.[2] as AbortSignal).aborted).toBe(
      true,
    );
  });
});

it('keeps retained collection bodies mounted and puts failed page recovery after the spatial field', async () => {
  const next = deferred<WarehouseSnapshotV1>();
  mocks.queryWarehouse.mockReset();
  mocks.queryWarehouse.mockResolvedValueOnce({ ...snapshot('first-page'), nextCursor: 'page-two' });
  mocks.queryWarehouse.mockReturnValueOnce(next.promise);
  mocks.queryWarehouse.mockResolvedValueOnce(snapshot('second-page'));
  const { host, root } = renderAtlas('project');
  await act(async () => {});
  const grid = host.querySelector('.lcos-atlas-grid');
  const firstCard = host.querySelector('[data-lcos-context-collection-slot]');
  await act(async () => host.querySelector<HTMLButtonElement>('.lcos-atlas-load-more')?.click());
  expect(host.querySelector('.lcos-atlas-grid')).toBe(grid);
  expect(host.querySelector('[data-lcos-context-collection-slot]')).toBe(firstCard);
  expect(host.querySelector('.py-16')).toBeNull();
  expect(host.querySelector('.lcos-atlas-load-more')?.textContent).toContain('正在读取更多');
  await act(async () => { next.reject(new Error('offline page two')); });
  const feedback = host.querySelector('.lcos-atlas-pagination-feedback');
  if (grid === null || feedback === null) throw new Error('Retained field and inline recovery must both be present');
  expect(grid.compareDocumentPosition(feedback)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(host.querySelector('[data-lcos-context-collection-slot]')).toBe(firstCard);
  expect(host.querySelector('.lcos-atlas-load-more')).toBeNull();
  await act(async () => feedback?.querySelector('button')?.click());
  expect(mocks.queryWarehouse.mock.calls[2]?.[1]).toEqual({ limit: 50, kinds: ['context'], cursor: 'page-two' });
  expect(host.querySelectorAll('[data-lcos-context-collection-slot]')).toHaveLength(2);
  expect(host.querySelector('[data-lcos-context-collection-slot]')).toBe(firstCard);
  root.unmount();
});

it('does not turn an unavailable scene workspace into a Context Atlas block', async () => {
  mocks.queryWarehouse.mockReset();
  mocks.queryWarehouse.mockResolvedValue({ ...snapshot('project'), items: [{
    schemaVersion: 1, kind: 'scene', entityRef: { type: 'scene', id: 'target' }, title: '工作空间目标', usageCount: 0,
  }] } satisfies WarehouseSnapshotV1);
  const { host, root } = renderAtlas('project');
  await act(async () => {});
  expect(host.querySelectorAll('[data-lcos-context-collection-slot]')).toHaveLength(0);
  expect(host.textContent).toContain('还没有上下文集合');
  root.unmount();
});

describe('RareFolderComponent Atlas adapter', () => {
  it('keeps the native hit button as the uncontrolled open toggle when no caller owns state', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    root.render(<FolderComponent />);
    await act(async () => {});

    const hit = host.querySelector<HTMLButtonElement>('.lcos-context-collection-hit');
    const folder = host.querySelector<HTMLElement>('[data-slot="folder"]');
    expect(hit).not.toBeNull();
    expect(folder?.getAttribute('data-folder-open')).toBe('false');

    await act(async () => hit?.click());
    expect(folder?.getAttribute('data-folder-open')).toBe('true');
    await act(async () => hit?.click());
    expect(folder?.getAttribute('data-folder-open')).toBe('false');
    root.unmount();
  });
});
