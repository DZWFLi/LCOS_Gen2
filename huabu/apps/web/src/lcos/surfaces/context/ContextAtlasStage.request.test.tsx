import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { ContextAtlasStage } from './ContextAtlasStage';

import type { WarehouseSnapshotV1 } from '@local-creative-os/contracts';

const mocks = vi.hoisted(() => ({
  getWarehouse: vi.fn(),
}));

vi.mock('@local-creative-os/web-gen2', () => ({
  CoreAssemblyClient: class {
    getWarehouse(...args: unknown[]) {
      return mocks.getWarehouse(...args);
    }
  },
  HttpError: class HttpError extends Error {},
}));
vi.mock('../../app/lcosCoreClient', () => ({
  createLcosCoreSession: () => ({ http: {} }),
}));
vi.mock('@/hooks/useCloseOnEscape', () => ({
  useCloseOnEscape: () => undefined,
}));
vi.mock('../../lcosReferenceState', () => ({
  useLcosReferenceStore: { getState: () => ({ nodeEntityRefs: new Map() }) },
}));
vi.mock('../../ui/LcosSurfaceFeedback', () => ({
  LcosSurfaceFeedback: ({ message }: { message?: string }) => (
    <div data-feedback>{message}</div>
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
        entityRef: { type: 'collection', id },
        kind: 'collection',
        title: id,
        usageCount: 0,
      },
    ],
    totalApprox: 1,
  };
}

function renderAtlas(projectId: string) {
  const host = document.createElement('div');
  const root = createRoot(host);
  root.render(
    <ContextAtlasStage
      projectId={projectId}
      workspaces={[]}
      onClose={vi.fn()}
      onEnterSurface={() => true}
    />,
  );
  return { host, root };
}

describe('ContextAtlasStage warehouse ownership', () => {
  it('keeps the latest project request authoritative and clears stale cards while loading', async () => {
    const first = deferred<WarehouseSnapshotV1>();
    const second = deferred<WarehouseSnapshotV1>();
    mocks.getWarehouse.mockReset();
    mocks.getWarehouse.mockImplementation((projectId: string) =>
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

    expect(host.textContent).toContain('正在读取 Atlas');
    expect(host.textContent).not.toContain('project-a');
    expect(mocks.getWarehouse.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect((mocks.getWarehouse.mock.calls[0]?.[1] as AbortSignal).aborted).toBe(
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
    mocks.getWarehouse.mockReset();
    mocks.getWarehouse.mockImplementation((projectId: string) =>
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
    expect((mocks.getWarehouse.mock.calls[1]?.[1] as AbortSignal).aborted).toBe(
      true,
    );
  });
});
