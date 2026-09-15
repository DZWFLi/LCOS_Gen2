import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactReaderBody } from './ArtifactReaderBody';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detailFor = vi.hoisted(() => vi.fn());
const revisionsFor = vi.hoisted(() => vi.fn());
const textFor = vi.hoisted(() => vi.fn());
const blobFor = vi.hoisted(() => vi.fn());

vi.mock('@local-creative-os/web-gen2', () => ({
  CoreArtifactClient: class {
    getArtifactDetail = detailFor;
    listArtifactRevisions = revisionsFor;
    getFileRecordText = textFor;
    getFileRecordContent = blobFor;
  },
  HttpError: class extends Error {
    readonly status = 500;
  },
}));
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function detail(artifactId: string, currentRevisionId: string, kind: 'markdown' | 'image' = 'markdown') {
  return {
    artifact: { id: artifactId, projectId: 'project-1', title: `${artifactId}.md`, kind, managed: true },
    currentRevisionId,
    revisions: [
      { id: 'revision-old', status: 'superseded', source: 'import', createdAt: '2026-01-01T00:00:00Z' },
      { id: currentRevisionId, status: 'current', source: 'import', createdAt: '2026-01-02T00:00:00Z' },
    ],
  };
}

function revision(artifactId: string, id: string, fileRecordId: string) {
  return { id, artifactId, fileRecordId, contentHash: `hash-${id}`, source: 'import', status: id === 'revision-old' ? 'superseded' : 'current', createdAt: '2026-01-02T00:00:00Z' };
}

async function render(artifactId: string): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => root.render(<ArtifactReaderBody projectId="project-1" artifactId={artifactId} />));
  return { root, container };
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
  document.body.replaceChildren();
  detailFor.mockReset();
  revisionsFor.mockReset();
  textFor.mockReset();
  blobFor.mockReset();
  vi.restoreAllMocks();
});

describe('ArtifactReaderBody real content', () => {
  it('reads the currentRevisionId even when it is not the first listed revision', async () => {
    detailFor.mockResolvedValue(detail('artifact-1', 'revision-current'));
    revisionsFor.mockResolvedValue([
      revision('artifact-1', 'revision-old', 'file-old'),
      revision('artifact-1', 'revision-current', 'file-current'),
    ]);
    textFor.mockResolvedValue('# Current body');

    const { container } = await render('artifact-1');
    expect(textFor).toHaveBeenCalledWith('project-1', 'file-current', expect.any(AbortSignal));
    expect(container.querySelector('[data-lcos-reader-content="text"]')?.textContent).toContain('# Current body');
    expect(container.textContent).toContain('revision · current');
  });

  it('does not let a late A response replace the newer B reader', async () => {
    let resolveA: (value: ReturnType<typeof detail>) => void = () => {};
    let resolveB: (value: ReturnType<typeof detail>) => void = () => {};
    detailFor.mockImplementation((id: string) => new Promise((resolve) => {
      if (id === 'artifact-a') resolveA = resolve;
      else resolveB = resolve;
    }));
    revisionsFor.mockImplementation((id: string) => Promise.resolve([revision(id, 'revision-current', `file-${id}`)]));
    textFor.mockImplementation((_projectId: string, fileRecordId: string) => Promise.resolve(`body:${fileRecordId}`));

    const { root, container } = await render('artifact-a');
    await act(async () => root.render(<ArtifactReaderBody projectId="project-1" artifactId="artifact-b" />));
    await act(async () => resolveA(detail('artifact-a', 'revision-current')));
    await act(async () => resolveB(detail('artifact-b', 'revision-current')));

    expect(container.textContent).toContain('body:file-artifact-b');
    expect(container.textContent).not.toContain('body:file-artifact-a');
  });

  it('releases an image Blob URL when the reader unmounts', async () => {
    detailFor.mockResolvedValue(detail('artifact-image', 'revision-current', 'image'));
    revisionsFor.mockResolvedValue([revision('artifact-image', 'revision-current', 'file-image')]);
    blobFor.mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reader-image');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { root, container } = await render('artifact-image');
    expect(container.querySelector('img')).not.toBeNull();
    expect(createUrl).toHaveBeenCalled();
    act(() => root.unmount());
    expect(revokeUrl).toHaveBeenCalledWith('blob:reader-image');
  });
});
