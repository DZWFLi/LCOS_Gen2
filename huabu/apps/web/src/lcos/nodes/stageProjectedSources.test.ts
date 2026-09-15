import { beforeEach, describe, expect, it, vi } from 'vitest';

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const { getBlob, uploadImage, uploadAudio, canvasStore } = vi.hoisted(() => {
  const state = {
    canvasId: 'canvas-a',
    nodes: [{ id: 'node-a', type: 'image', data: { src: '' } }],
    updateNodeData: vi.fn(),
  };
  return {
    getBlob: vi.fn(),
    uploadImage: vi.fn(),
    uploadAudio: vi.fn(),
    canvasStore: {
      getState: () => state,
      subscribe: vi.fn(() => () => undefined),
      state,
    },
  };
});

vi.mock('@local-creative-os/web-gen2', () => ({
  HttpClient: class {
    getBlob = getBlob;
  },
}));
vi.mock('@/api/artifact', () => ({ uploadImage, uploadAudio }));
vi.mock('@/lcos/lcosHost', () => ({
  readLcosHostConfig: vi.fn(() => ({
    coreUrl: 'http://core',
    coreToken: 'token',
  })),
}));
vi.mock('@/store/canvasStore', () => ({ default: canvasStore }));

import { stageProjectedSources } from './stageProjectedSources';

const imageBinding = {
  spatialId: 'node-a',
  entityType: 'artifact',
  entityId: 'artifact-a',
  descriptor: {
    artifactKind: 'image',
    mimeType: 'image/png',
    fileRecordId: 'file-a',
  },
};

describe('stageProjectedSources ownership guard', () => {
  it('can restart on returning to a project without waiting for its obsolete fetch', async () => {
    const oldBlob = deferred<Blob>();
    getBlob.mockReturnValueOnce(oldBlob.promise).mockResolvedValueOnce(new Blob(['new'], { type: 'image/png' }));
    uploadImage.mockResolvedValueOnce('new-key.png');
    let oldActive = true;
    const oldRequest = stageProjectedSources('return-project', [imageBinding], () => oldActive);
    await vi.waitFor(() => expect(getBlob).toHaveBeenCalledTimes(1));
    oldActive = false;
    const freshRequest = stageProjectedSources('return-project', [imageBinding], () => true);
    await expect(freshRequest).resolves.toBe(1);
    oldBlob.resolve(new Blob(['old'], { type: 'image/png' }));
    await expect(oldRequest).resolves.toBe(0);
    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(canvasStore.state.updateNodeData).toHaveBeenCalledExactlyOnceWith('node-a', { src: 'new-key.png' });
  });
  beforeEach(() => {
    getBlob.mockReset();
    uploadImage.mockReset();
    uploadAudio.mockReset();
    canvasStore.state.canvasId = 'canvas-a';
    canvasStore.state.nodes = [
      { id: 'node-a', type: 'image', data: { src: '' } },
    ];
    canvasStore.state.updateNodeData.mockReset();
  });

  it('does not update the new project after Core fetch resolves from the old project', async () => {
    const blob = deferred<Blob>();
    getBlob.mockReturnValueOnce(blob.promise);
    const current = vi.fn(() => currentProject);
    let currentProject = true;

    const pending = stageProjectedSources('project-a', [imageBinding], current);
    await vi.waitFor(() => expect(getBlob).toHaveBeenCalledOnce());

    currentProject = false;
    blob.resolve(new Blob(['image'], { type: 'image/png' }));

    await expect(pending).resolves.toBe(0);
    expect(uploadImage).not.toHaveBeenCalled();
    expect(canvasStore.state.updateNodeData).not.toHaveBeenCalled();
  });

  it('does not update the new project when upload resolves after ownership changes', async () => {
    const blob = deferred<Blob>();
    const upload = deferred<string>();
    getBlob.mockReturnValueOnce(blob.promise);
    uploadImage.mockReturnValueOnce(upload.promise);
    const current = vi.fn(() => currentProject);
    let currentProject = true;

    const pending = stageProjectedSources('project-a', [imageBinding], current);
    await vi.waitFor(() => expect(getBlob).toHaveBeenCalled());
    blob.resolve(new Blob(['image'], { type: 'image/png' }));
    await vi.waitFor(() => expect(uploadImage).toHaveBeenCalledOnce());

    currentProject = false;
    upload.resolve('artifact-key-a.png');

    await expect(pending).resolves.toBe(0);
    expect(canvasStore.state.updateNodeData).not.toHaveBeenCalled();
  });
});
