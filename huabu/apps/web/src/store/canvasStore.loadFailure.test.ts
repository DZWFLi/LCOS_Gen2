import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCanvas, getWorldReferences, putCanvas } = vi.hoisted(() => ({
  getCanvas: vi.fn(),
  getWorldReferences: vi.fn(),
  putCanvas: vi.fn(),
}));

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof CanvasApi>()),
  getCanvas,
  getWorldReferences,
  putCanvas,
}));

import useCanvasStore from './canvasStore';

import type * as CanvasApi from '../api';

const sourceCanvasId = 'canvas-source';
const sourceNode = {
  id: 'source-node',
  type: 'note',
  position: { x: 12, y: 24 },
  data: { label: 'source' },
};

function response(canvasId: string, label: string) {
  return {
    canvasId,
    title: label,
    version: 3,
    state: {
      nodes: [
        {
          id: `${canvasId}-node`,
          type: 'note',
          position: { x: 0, y: 0 },
          data: { label },
        },
      ],
      edges: [],
    },
  };
}

beforeEach(() => {
  getCanvas.mockReset();
  getWorldReferences.mockReset();
  getWorldReferences.mockResolvedValue({ references: [] });
  putCanvas.mockReset();
  putCanvas.mockResolvedValue({});
  useCanvasStore.getState()._setStateNoAutosave({
    canvasId: sourceCanvasId,
    nodes: [sourceNode],
    edges: [],
    viewport: { x: 7, y: 8, zoom: 1 },
    version: 2,
    isLoading: false,
    canvasNotFound: false,
    canvasLoadFailure: null,
  });
});

describe('canvas load failure boundaries', () => {
  it('cancels an older destination when the user stays on the source canvas', async () => {
    let finish!: (value: ReturnType<typeof response>) => void;
    getCanvas.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = useCanvasStore.getState().loadCanvas('target-late');
    expect(await useCanvasStore.getState().switchCanvas(sourceCanvasId)).toBe(true);
    finish(response('target-late', 'Late'));
    expect(await pending).toBe(false);
    expect(useCanvasStore.getState()).toMatchObject({ canvasId: sourceCanvasId, nodes: [sourceNode], isLoading: false });
  });

  it('does not leave a source with an unresolved version conflict', async () => {
    useCanvasStore.getState()._setStateNoAutosave({ versionConflict: true });
    expect(await useCanvasStore.getState().switchCanvas('target')).toBe(false);
    expect(getCanvas).not.toHaveBeenCalled();
    expect(useCanvasStore.getState()).toMatchObject({ canvasId: sourceCanvasId, versionConflict: true, isLoading: false });
    useCanvasStore.getState()._setStateNoAutosave({ versionConflict: false });
  });

  it('keeps the source canvas when the target is missing or unavailable', async () => {
    getCanvas.mockResolvedValueOnce(null);
    expect(await useCanvasStore.getState().loadCanvas('missing')).toBe(false);
    expect(useCanvasStore.getState()).toMatchObject({
      canvasId: sourceCanvasId,
      nodes: [sourceNode],
      viewport: { x: 7, y: 8, zoom: 1 },
      canvasNotFound: true,
      canvasLoadFailure: {
        canvasId: 'missing',
        kind: 'not-found',
      },
    });

    getCanvas.mockRejectedValueOnce(new Error('network down'));
    expect(await useCanvasStore.getState().loadCanvas('offline')).toBe(false);
    expect(useCanvasStore.getState()).toMatchObject({
      canvasId: sourceCanvasId,
      nodes: [sourceNode],
      canvasNotFound: false,
      canvasLoadFailure: {
        canvasId: 'offline',
        kind: 'error',
        message: 'network down',
      },
    });
  });

  it('does not let an older response overwrite the newer target', async () => {
    const pending = new Map<string, (value: ReturnType<typeof response>) => void>();
    getCanvas.mockImplementation(
      (canvasId: string) =>
        new Promise((resolve) => pending.set(canvasId, resolve)),
    );

    const older = useCanvasStore.getState().loadCanvas('target-a');
    const newer = useCanvasStore.getState().loadCanvas('target-b');
    pending.get('target-b')?.(response('target-b', 'B'));
    expect(await newer).toBe(true);
    pending.get('target-a')?.(response('target-a', 'A'));
    expect(await older).toBe(false);

    expect(useCanvasStore.getState()).toMatchObject({
      canvasId: 'target-b',
      canvasTitle: 'B',
      nodes: [{ id: 'target-b-node' }],
    });
  });

  it('retries a same-canvas switch after a previous load failure', async () => {
    getCanvas.mockResolvedValueOnce(null);
    expect(await useCanvasStore.getState().loadCanvas(sourceCanvasId)).toBe(
      false,
    );

    getCanvas.mockResolvedValueOnce(response(sourceCanvasId, 'Recovered'));
    expect(await useCanvasStore.getState().switchCanvas(sourceCanvasId)).toBe(
      true,
    );
    expect(useCanvasStore.getState()).toMatchObject({
      canvasId: sourceCanvasId,
      canvasLoadFailure: null,
      canvasTitle: 'Recovered',
    });
  });

  it('does not save merely because an authoritative load succeeded', async () => {
    getCanvas.mockResolvedValueOnce(response('target', 'Target'));

    expect(await useCanvasStore.getState().loadCanvas('target')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(putCanvas).not.toHaveBeenCalled();
  });
});
