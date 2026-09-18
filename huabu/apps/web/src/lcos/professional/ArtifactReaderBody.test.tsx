import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactReaderBody, readerCitationBlockV1, readerSourceTraceLabelV1 } from './ArtifactReaderBody';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detailFor = vi.hoisted(() => vi.fn());
const revisionsFor = vi.hoisted(() => vi.fn());
const textFor = vi.hoisted(() => vi.fn());
const blobFor = vi.hoisted(() => vi.fn());
const compareFor = vi.hoisted(() => vi.fn());

// reference / shell store 用轻量替身：本用例验证的是 reader 如何**使用**既有 owner
// （草稿引用 / Composer 草稿 / locate），而不是这些 owner 自身的实现。
const addEntityToDraft = vi.hoisted(() => vi.fn());
const orderedNodeReferences = vi.hoisted(() => vi.fn(() => [] as unknown[]));
const requestLocate = vi.hoisted(() => vi.fn());
const setComposerPrompt = vi.hoisted(() => vi.fn());
const nodeEntityRefs = vi.hoisted(() => new Map<string, { entityType: string; entityId: string }>());

vi.mock('@local-creative-os/web-gen2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@local-creative-os/web-gen2')>();
  return {
    ...actual,
    CoreArtifactClient: class {
      getArtifactDetail = detailFor;
      listArtifactRevisions = revisionsFor;
      getFileRecordText = textFor;
      getFileRecordContent = blobFor;
      compareRevisions = compareFor;
    },
    HttpError: class extends Error {
      readonly status = 500;
    },
  };
});
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));
vi.mock('../lcosReferenceState', () => {
  const state = () => ({ nodeEntityRefs, addEntityToDraft, orderedNodeReferences, draft: {} });
  const useLcosReferenceStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useLcosReferenceStore.getState = state;
  return { useLcosReferenceStore };
});
vi.mock('../shell/lcosShellStore', () => {
  const state = () => ({ activeSurface: 'main', composerPrompt: '', setComposerPrompt, requestLocate });
  const useLcosShellStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useLcosShellStore.getState = state;
  return { useLcosShellStore };
});

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

function click(container: HTMLElement, selector: string): void {
  const target = container.querySelector<HTMLButtonElement>(selector);
  if (target === null) throw new Error(`missing ${selector}`);
  act(() => target.click());
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const container of containers.splice(0)) container.remove();
  document.body.replaceChildren();
  detailFor.mockReset();
  revisionsFor.mockReset();
  textFor.mockReset();
  blobFor.mockReset();
  compareFor.mockReset();
  addEntityToDraft.mockReset();
  orderedNodeReferences.mockReset();
  orderedNodeReferences.mockReturnValue([]);
  requestLocate.mockReset();
  setComposerPrompt.mockReset();
  nodeEntityRefs.clear();
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

describe('ArtifactReaderBody R4 residual', () => {
  async function renderMarkdown(artifactId = 'artifact-1') {
    detailFor.mockResolvedValue(detail(artifactId, 'revision-current'));
    revisionsFor.mockResolvedValue([
      revision(artifactId, 'revision-old', 'file-old'),
      revision(artifactId, 'revision-current', 'file-current'),
    ]);
    textFor.mockImplementation((_projectId: string, fileRecordId: string) => Promise.resolve(`body:${fileRecordId}`));
    return render(artifactId);
  }

  it('citation helper always carries a Source Trace (never a source-less sticky)', () => {
    const trace = { artifactId: 'artifact-1', revisionId: 'revision-current', title: '材料 A' };
    expect(readerSourceTraceLabelV1(trace)).toBe('artifact:artifact-1@revision-current');
    const block = readerCitationBlockV1(trace, '  摘录正文  ');
    expect(block).toContain('artifact:artifact-1@revision-current');
    expect(block).toContain('摘录正文');
  });

  it('revision 浏览：点历史版本真的读那一版正文，并给出只读语义与「回到当前版本」', async () => {
    const { container } = await renderMarkdown();
    expect(textFor).toHaveBeenCalledWith('project-1', 'file-current', expect.any(AbortSignal));
    expect(container.querySelector('[data-lcos-reader-readonly]')).toBeNull();
    expect(container.querySelector('[data-lcos-reader-revision="revision-old"]')?.getAttribute('data-lcos-reader-revision-role')).toBe('historical');

    click(container, '[data-lcos-reader-revision="revision-old"]');
    await act(async () => { await Promise.resolve(); });
    expect(textFor).toHaveBeenCalledWith('project-1', 'file-old', expect.any(AbortSignal));
    expect(container.textContent).toContain('body:file-old');
    expect(container.querySelector('[data-lcos-reader-readonly]')?.textContent).toContain('历史版本（只读）');

    click(container, '[data-lcos-reader-back-to-current]');
    await act(async () => { await Promise.resolve(); });
    expect(textFor).toHaveBeenCalledWith('project-1', 'file-current', expect.any(AbortSignal));
    expect(container.querySelector('[data-lcos-reader-readonly]')).toBeNull();
  });

  it('compare 走 canonical compareRevisions，contentAvailable=false 时如实说明、不伪造 diff', async () => {
    compareFor.mockResolvedValue({
      base: { revisionId: 'revision-old', contentHash: 'h1', size: 1, mimeType: 'text/markdown' },
      head: { revisionId: 'revision-current', contentHash: 'h2', size: 2, mimeType: 'text/markdown' },
      changed: true,
      contentAvailable: false,
    });
    const { container } = await renderMarkdown();
    click(container, '[data-lcos-reader-compare-toggle]');
    await act(async () => { await Promise.resolve(); });

    expect(compareFor).toHaveBeenCalledWith('project-1', 'revision-old', 'revision-current');
    const panel = container.querySelector('[data-lcos-reader-compare]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain('仅元数据可比');
    expect(panel?.textContent).toContain('有变化');
    expect(container.querySelectorAll('[data-lcos-reader-compare-line]')).toHaveLength(0);
  });

  it('加入引用与摘录为引用：写既有草稿引用，并把带 Source Trace 的引用块送进 Composer 草稿', async () => {
    const { container } = await renderMarkdown();
    click(container, '[data-lcos-reader-to-draft]');
    expect(addEntityToDraft).toHaveBeenCalledWith(expect.objectContaining({ entityType: 'artifact', entityId: 'artifact-1' }));

    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '  摘录正文  ' } as unknown as Selection);
    click(container, '[data-lcos-reader-cite]');
    expect(setComposerPrompt).toHaveBeenCalledTimes(1);
    const block = String(setComposerPrompt.mock.calls[0]?.[0]);
    expect(block).toContain('artifact:artifact-1@revision-current');
    expect(block).toContain('摘录正文');
    expect(container.querySelector('[data-lcos-reader-cite-trace]')?.textContent).toContain('artifact:artifact-1@revision-current');
  });

  it('未选中正文时不给「无来源引用」，如实提示', async () => {
    const { container } = await renderMarkdown();
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '   ' } as unknown as Selection);
    click(container, '[data-lcos-reader-cite]');
    expect(setComposerPrompt).not.toHaveBeenCalled();
    expect(container.querySelector('[data-lcos-reader-note]')?.textContent).toContain('未选中');
  });

  it('回到来源：按 Core identity 命中投影节点则 locate(projected)，未投影则如实上报不假定位', async () => {
    const { container } = await renderMarkdown();
    click(container, '[data-lcos-reader-source-return]');
    expect(requestLocate).toHaveBeenCalledWith(expect.objectContaining({ status: 'unprojected', surface: 'main' }));
    expect(container.querySelector('[data-lcos-reader-note]')?.textContent).toContain('尚未投影');

    nodeEntityRefs.set('node-a', { entityType: 'artifact', entityId: 'artifact-1' });
    click(container, '[data-lcos-reader-source-return]');
    expect(requestLocate).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'projected', nodeId: 'node-a' }));
  });

  it('重开续读：重新挂载同一材料时读回上次的版本', async () => {
    const first = await renderMarkdown();
    click(first.container, '[data-lcos-reader-revision="revision-old"]');
    await act(async () => { await Promise.resolve(); });
    expect(first.container.textContent).toContain('body:file-old');
    act(() => roots[0]!.unmount());

    // 第二次挂载（同 project + artifact）：应直接落到上次的版本而不是 current
    const second = await renderMarkdown();
    expect(second.container.textContent).toContain('body:file-old');
    expect(second.container.querySelector('[data-lcos-reader-readonly]')).not.toBeNull();
  });
});