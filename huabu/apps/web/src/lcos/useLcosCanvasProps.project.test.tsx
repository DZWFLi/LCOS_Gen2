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
  const runtimes = new Map<string, {
    projectId: string;
    host: {
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
  return { Binding: undefined as unknown as Binding, canvas, runtimes, runtimeFor, stage, connect, disconnect };
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
vi.mock('./lcosRecognizers', () => ({ createLcosRecognizers: vi.fn(() => []) }));
vi.mock('./nodes/createLcosNodePresentationSeam', () => ({ createLcosNodePresentationSeam: vi.fn(() => ({})) }));
vi.mock('./nodes/stageProjectedSources', () => ({ stageProjectedSources: mocks.stage }));
vi.mock('./referenceClickSuppressor', () => ({
  installReferenceClickSuppressor: vi.fn(() => vi.fn()),
}));
vi.mock('./LcosHostOverlay', () => ({ LcosHostOverlay: () => null }));
vi.mock('./host/LcosCameraMotionPolicy', () => ({ LcosCameraMotionPolicy: () => null }));
vi.mock('./navigation/LcosCameraControls', () => ({ LcosCameraControls: () => null }));
vi.mock('./navigation/LcosCanvasCommands', () => ({ LcosCanvasCommands: () => null }));
vi.mock('./navigation/LcosActionArc', () => ({ LcosActionArc: () => null }));
vi.mock('./navigation/LcosEdgeArc', () => ({ LcosEdgeArc: () => null }));

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
});
