import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Binding = {
    spatialId: string;
    entityType: string;
    entityId: string;
  };
  type Deferred<T> = {
    promise: Promise<T>;
    resolve(value: T): void;
  };
  const deferred = <T,>(): Deferred<T> => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((next) => { resolve = next; });
    return { promise, resolve };
  };
  const identityLists = new Map<string, Promise<unknown[]>>();
  const runtimes = new Map<string, {
    projectId: string;
    host: {
      bindings: { list: ReturnType<typeof vi.fn> };
      reconcile: ReturnType<typeof vi.fn>;
      listNodeBindings: ReturnType<typeof vi.fn>;
      retarget: ReturnType<typeof vi.fn>;
    };
    dispose: ReturnType<typeof vi.fn>;
    reconcile: Deferred<void>;
    bindings: Deferred<readonly Binding[]>;
  }>();
  const canvas = { canvasId: 'canvas-a', isLoading: false, nodes: [] as unknown[] };
  const runtimeFor = (projectId: string) => {
    const reconcile = deferred<void>();
    const bindings = deferred<readonly Binding[]>();
    const runtime = {
      projectId,
      host: {
        bindings: { list: vi.fn(() => identityLists.get(projectId) ?? Promise.resolve([])) },
        reconcile: vi.fn(() => reconcile.promise),
        listNodeBindings: vi.fn(() => bindings.promise),
        retarget: vi.fn(),
      },
      retarget: vi.fn(),
      dispose: vi.fn(),
      reconcile,
      bindings,
    };
    runtimes.set(projectId, runtime);
    return runtime;
  };
  const stage = vi.fn(async (..._args: [
    string,
    readonly { spatialId: string; entityType: string; entityId: string }[],
    () => boolean,
  ]) => 0);
  const connect = vi.fn();
  const disconnect = vi.fn();
  return { deferred, identityLists, Binding: undefined as unknown as Binding, canvas, runtimes, runtimeFor, stage, connect, disconnect };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@local-creative-os/web-gen2', () => ({
  createHostSeam: vi.fn(() => ({})),
  hostExtensionFromSeam: vi.fn(() => ({})),
  createReferenceControllerState: <T,>(key: string) => ({ key, orderedEntityRefs: [] as T[] }),
  orderedReferences: <T,>(state: { orderedEntityRefs: T[] }) => state.orderedEntityRefs,
  sameEntityRef: (left: { entityType: string; entityId: string }, right: { entityType: string; entityId: string }) =>
    left.entityType === right.entityType && left.entityId === right.entityId,
  toggleReference: <T extends { entityType: string; entityId: string }>(state: { key: string; orderedEntityRefs: T[] }, ref: T) => {
    const exists = state.orderedEntityRefs.some((item) => item.entityType === ref.entityType && item.entityId === ref.entityId);
    return {
      key: state.key,
      orderedEntityRefs: exists
        ? state.orderedEntityRefs.filter((item) => item.entityType !== ref.entityType || item.entityId !== ref.entityId)
        : [...state.orderedEntityRefs, ref],
    };
  },
  removeReference: <T extends { entityType: string; entityId: string }>(state: { key: string; orderedEntityRefs: T[] }, ref: T) => ({
    key: state.key,
    orderedEntityRefs: state.orderedEntityRefs.filter((item) => item.entityType !== ref.entityType || item.entityId !== ref.entityId),
  }),
}));
vi.mock('@/store/canvasStore', () => ({
  default: Object.assign(
    (select: (state: typeof mocks.canvas) => unknown) => select(mocks.canvas),
    { getState: () => mocks.canvas },
  ),
  __esModule: true,
}));
vi.mock('@/store/canvasSyncStore', () => ({
  useCanvasSyncStore: (select: (state: { connect: typeof mocks.connect; disconnect: typeof mocks.disconnect }) => unknown) =>
    select({ connect: mocks.connect, disconnect: mocks.disconnect }),
}));
vi.mock('./lcosHost', () => ({
  createLcosRuntime: vi.fn(({ projectId }: { projectId: string }) => mocks.runtimeFor(projectId)),
  readLcosHostConfig: vi.fn(() => ({})),
}));
// This suite isolates async project/binding ownership. The native drag policy
// has its own controller/command tests; do not instantiate live subscriptions
// against this suite's deliberately non-subscribing canvas stub.
vi.mock('./drop/nativeCanvasDropHost', () => ({
  createNativeCanvasDropHost: vi.fn(() => ({
    onStart: vi.fn(), onMove: vi.fn(() => false), onStop: vi.fn(() => false),
    filterChanges: <T,>(changes: T[]) => changes,
    cancel: vi.fn(), dispose: vi.fn(),
  })),
}));
vi.mock('./lcosRecognizers', () => ({ createLcosRecognizers: vi.fn(() => []) }));
vi.mock('./nodes/createLcosNodePresentationSeam', () => ({ createLcosNodePresentationSeam: vi.fn(() => ({})) }));
vi.mock('./nodes/stageProjectedSources', () => ({ stageProjectedSources: mocks.stage }));
vi.mock('./referenceClickSuppressor', () => ({
  installReferenceClickSuppressor: vi.fn(() => vi.fn()),
}));
vi.mock('./LcosHostOverlay', () => ({ LcosHostOverlay: () => null }));
vi.mock('./host/LcosCameraMotionPolicy', () => ({ LcosCameraMotionPolicy: () => null }));
vi.mock('./navigation/LcosCanvasCommands', () => ({ LcosCanvasCommands: () => null }));
vi.mock('./navigation/LcosActionArc', () => ({ LcosActionArc: () => null }));
vi.mock('./navigation/LcosEdgeArc', () => ({ LcosEdgeArc: () => null }));
vi.mock('./navigation/LcosSpatialNavigator', () => ({ LcosSpatialNavigator: () => null }));

import { useLcosReferenceStore } from './lcosReferenceState';
import { useLcosCanvasProps } from './useLcosCanvasProps';

type Binding = { spatialId: string; entityType: string; entityId: string };

const waitForMicrotasks = async (): Promise<void> => {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};

function runtimeFor(projectId: string) {
  const runtime = mocks.runtimes.get(projectId);
  if (!runtime) throw new Error(`runtime not created for ${projectId}`);
  return runtime;
}

function Probe({ projectId }: { projectId: string }): null {
  useLcosCanvasProps(projectId);
  return null;
}

describe('useLcosCanvasProps project async ownership', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
    useLcosReferenceStore.getState().reset();
    mocks.canvas.canvasId = 'canvas-a';
    mocks.runtimes.clear();
    mocks.identityLists.clear();
    mocks.canvas.isLoading = false;
    mocks.stage.mockClear();
    mocks.connect.mockClear();
    mocks.disconnect.mockClear();
  });

  it('ignores project A listBindings after the route has moved to project B', async () => {
    useLcosReferenceStore.getState().setProject('project-a');
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => root?.render(<Probe projectId="project-a" />));
    const runtimeA = runtimeFor('project-a');
    runtimeA.reconcile.resolve();
    await waitForMicrotasks();

    useLcosReferenceStore.getState().setProject('project-b');
    mocks.canvas.canvasId = 'canvas-b';
    await act(async () => root?.render(<Probe projectId="project-b" />));
    const runtimeB = runtimeFor('project-b');
    runtimeB.reconcile.resolve();
    await waitForMicrotasks();
    const bindingB: Binding = { spatialId: 'node-b', entityType: 'artifact', entityId: 'artifact-b' };
    runtimeB.bindings.resolve([bindingB]);
    await waitForMicrotasks();

    const bindingA: Binding = { spatialId: 'node-a', entityType: 'artifact', entityId: 'artifact-a' };
    runtimeA.bindings.resolve([bindingA]);
    await waitForMicrotasks();

    expect([...useLcosReferenceStore.getState().nodeEntityRefs.keys()]).toEqual(['node-b']);
    expect(mocks.stage).toHaveBeenCalledTimes(1);
    expect(mocks.stage.mock.calls[0]?.[0]).toBe('project-b');
    expect(mocks.stage.mock.calls[0]?.[1]).toEqual([bindingB]);
  });

  it('ignores a pending reconcile after unmount and disposes the runtime', async () => {
    useLcosReferenceStore.getState().setProject('project-a');
    host = document.createElement('div');
    root = createRoot(host);
    await act(async () => root?.render(<Probe projectId="project-a" />));
    const runtimeA = runtimeFor('project-a');
    await act(async () => root?.unmount());
    root = undefined;

    runtimeA.reconcile.resolve();
    await waitForMicrotasks();

    expect(runtimeA.dispose).toHaveBeenCalledTimes(1);
    expect(runtimeA.host.listNodeBindings).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
  });
  it('reads existing identities while canvas loads, then atomically replaces deleted/reprojected bindings', async () => {
    useLcosReferenceStore.getState().setProject('project-a');
    mocks.canvas.isLoading = true;
    mocks.identityLists.set('project-a', Promise.resolve([
      { projectId: 'project-a', canvasId: 'canvas-a', spatialKind: 'node', spatialId: 'old-node', entityType: 'artifact', entityId: 'a-old' },
      { projectId: 'other', canvasId: 'canvas-a', spatialKind: 'node', spatialId: 'wrong-project', entityType: 'artifact', entityId: 'wrong' },
      { projectId: 'project-a', canvasId: 'other', spatialKind: 'node', spatialId: 'wrong-canvas', entityType: 'artifact', entityId: 'wrong' },
      { projectId: 'project-a', canvasId: 'canvas-a', spatialKind: 'edge', spatialId: 'edge', entityType: 'relation', entityId: 'edge' },
    ]));
    host = document.createElement('div'); root = createRoot(host);
    await act(async () => root?.render(<Probe projectId="project-a" />)); await waitForMicrotasks();
    const runtime = runtimeFor('project-a');
    expect(runtime.host.reconcile).not.toHaveBeenCalled();
    expect([...useLcosReferenceStore.getState().nodeEntityRefs.keys()]).toEqual(['old-node']);
    expect(useLcosReferenceStore.getState().bindingReadStatus).toBe('loading');
    mocks.canvas.isLoading = false; await act(async () => root?.render(<Probe projectId="project-a" />));
    runtime.reconcile.resolve(); await waitForMicrotasks();
    runtime.bindings.resolve([{ spatialId: 'new-node', entityType: 'artifact', entityId: 'a-new' }]); await waitForMicrotasks();
    expect([...useLcosReferenceStore.getState().nodeEntityRefs.keys()]).toEqual(['new-node']);
    expect(useLcosReferenceStore.getState().bindingReadStatus).toBe('ready');
  });

  it('late early-identity response cannot overwrite the new project/canvas', async () => {
    const late = mocks.deferred<unknown[]>(); mocks.identityLists.set('project-a', late.promise);
    useLcosReferenceStore.getState().setProject('project-a'); host = document.createElement('div'); root = createRoot(host);
    await act(async () => root?.render(<Probe projectId="project-a" />));
    const oldRuntime = runtimeFor('project-a');
    useLcosReferenceStore.getState().setProject('project-b'); mocks.canvas.canvasId = 'canvas-b';
    await act(async () => root?.render(<Probe projectId="project-b" />));
    const newRuntime = runtimeFor('project-b'); newRuntime.reconcile.resolve(); await waitForMicrotasks();
    newRuntime.bindings.resolve([{ spatialId: 'node-b', entityType: 'artifact', entityId: 'a-b' }]); await waitForMicrotasks();
    late.resolve([{ projectId: 'project-a', canvasId: 'canvas-a', spatialKind: 'node', spatialId: 'late-a', entityType: 'artifact', entityId: 'a-a' }]);
    await waitForMicrotasks();
    expect(oldRuntime.host.reconcile).not.toHaveBeenCalled();
    expect([...useLcosReferenceStore.getState().nodeEntityRefs.keys()]).toEqual(['node-b']);
  });

  it('retry reuses the same runtime and canonical read after a failed identity read', async () => {
    mocks.identityLists.set('project-a', Promise.reject(new Error('offline')));
    useLcosReferenceStore.getState().setProject('project-a'); mocks.canvas.isLoading = true;
    host = document.createElement('div'); root = createRoot(host);
    await act(async () => root?.render(<Probe projectId="project-a" />)); await waitForMicrotasks();
    expect(useLcosReferenceStore.getState().bindingReadStatus).toBe('error');
    const runtime = runtimeFor('project-a');
    mocks.identityLists.set('project-a', Promise.resolve([{ projectId: 'project-a', canvasId: 'canvas-a', spatialKind: 'node', spatialId: 'real-node', entityType: 'artifact', entityId: 'real-artifact' }]));
    await act(async () => useLcosReferenceStore.getState().requestNodeBindingRefresh()); await waitForMicrotasks();
    expect(runtimeFor('project-a')).toBe(runtime);
    expect(runtime.host.bindings.list).toHaveBeenCalledTimes(2);
    expect(useLcosReferenceStore.getState().nodeEntityRefs.get('real-node')?.entityId).toBe('real-artifact');
    expect(useLcosReferenceStore.getState().bindingReadStatus).toBe('loading');
  });

});
