import { beforeEach, describe, expect, it, vi } from 'vitest';

interface TestNode {
  readonly id: string;
}

interface TestCanvasSnapshot {
  readonly canvasId: string;
  readonly nodes: readonly TestNode[];
}

interface TestReferenceSnapshot {
  readonly projectId: string | null;
  readonly nodeEntityRefs: ReadonlyMap<string, { entityType: string; entityId: string }>;
}

const stores = vi.hoisted(() => {
  let canvasState: TestCanvasSnapshot = { canvasId: 'canvas-a', nodes: [] };
  let referenceState: TestReferenceSnapshot = { projectId: 'project-a', nodeEntityRefs: new Map() };
  const canvasListeners = new Set<() => void>();
  const referenceListeners = new Set<() => void>();
  const canvasStore = {
    getState: () => canvasState,
    subscribe: (listener: () => void) => { canvasListeners.add(listener); return () => canvasListeners.delete(listener); },
    setState: (next: Partial<TestCanvasSnapshot>) => { canvasState = { ...canvasState, ...next }; canvasListeners.forEach((listener) => listener()); },
  };
  const referenceStore = {
    getState: () => referenceState,
    subscribe: (listener: () => void) => { referenceListeners.add(listener); return () => referenceListeners.delete(listener); },
    setState: (next: Partial<TestReferenceSnapshot>) => { referenceState = { ...referenceState, ...next }; referenceListeners.forEach((listener) => listener()); },
  };
  return { canvasStore, referenceStore };
});

vi.mock('@/store/canvasStore', () => ({ default: stores.canvasStore }));
vi.mock('../lcosReferenceState', () => ({ useLcosReferenceStore: stores.referenceStore }));

import { waitForProjectedEntity } from './waitForProjectedEntity';

describe('waitForProjectedEntity', () => {
  beforeEach(() => {
    stores.canvasStore.setState({ canvasId: 'canvas-a', nodes: [] });
    stores.referenceStore.setState({ projectId: 'project-a', nodeEntityRefs: new Map() });
  });

  it('resolves when the binding arrives before the actual node', async () => {
    const pending = waitForProjectedEntity({
      projectId: 'project-a',
      canvasId: 'canvas-a',
      entityType: 'artifact',
      entityId: 'artifact-a',
    });

    const refs = new Map(stores.referenceStore.getState().nodeEntityRefs);
    refs.set('node-a', { entityType: 'artifact', entityId: 'artifact-a' });
    stores.referenceStore.setState({ nodeEntityRefs: refs });
    let resolved = false;
    void pending.then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    stores.canvasStore.setState({ canvasId: 'canvas-a', nodes: [{ id: 'node-a' }] });
    await expect(pending).resolves.toBe('node-a');
  });

  it('resolves when the node arrives before the binding', async () => {
    const pending = waitForProjectedEntity({
      projectId: 'project-a',
      canvasId: 'canvas-a',
      entityType: 'artifact',
      entityId: 'artifact-a',
    });
    stores.canvasStore.setState({ canvasId: 'canvas-a', nodes: [{ id: 'node-a' }] });
    const refs = new Map(stores.referenceStore.getState().nodeEntityRefs);
    refs.set('node-a', { entityType: 'artifact', entityId: 'artifact-a' });
    stores.referenceStore.setState({ nodeEntityRefs: refs });
    await expect(pending).resolves.toBe('node-a');
  });

  it('returns undefined on cancellation and cleans up', async () => {
    const controller = new AbortController();
    const pending = waitForProjectedEntity({
      projectId: 'project-a', canvasId: 'canvas-a', entityType: 'artifact', entityId: 'a', signal: controller.signal,
    });
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    stores.referenceStore.setState({ nodeEntityRefs: new Map([['node-a', { entityType: 'artifact', entityId: 'a' }]]) });
    stores.canvasStore.setState({ canvasId: 'canvas-a', nodes: [{ id: 'node-a' }] });
    await Promise.resolve();
  });

  it('returns undefined when project or canvas changes', async () => {
    const projectPending = waitForProjectedEntity({
      projectId: 'project-a', canvasId: 'canvas-a', entityType: 'artifact', entityId: 'a',
    });
    stores.referenceStore.setState({ projectId: 'project-b', nodeEntityRefs: new Map() });
    await expect(projectPending).resolves.toBeUndefined();

    const canvasPending = waitForProjectedEntity({
      projectId: 'project-a', canvasId: 'canvas-a', entityType: 'artifact', entityId: 'a',
    });
    stores.canvasStore.setState({ canvasId: 'canvas-b' });
    await expect(canvasPending).resolves.toBeUndefined();
  });

  it('returns undefined on timeout', async () => {
    vi.useFakeTimers();
    const pending = waitForProjectedEntity({
      projectId: 'project-a', canvasId: 'canvas-a', entityType: 'artifact', entityId: 'missing', timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(25);
    await expect(pending).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
