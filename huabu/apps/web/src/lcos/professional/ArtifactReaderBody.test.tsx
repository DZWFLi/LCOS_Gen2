import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ArtifactReaderBody,
  clearReaderSessionContinuity,
  readerCitationBlockV1,
  readerSourceTraceLabelV1,
} from './ArtifactReaderBody';
import { useLcosHostStore } from '../host/lcosHostState';

import type * as WebGen2 from '@local-creative-os/web-gen2';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detailFor = vi.hoisted(() => vi.fn());
const revisionsFor = vi.hoisted(() => vi.fn());
const textFor = vi.hoisted(() => vi.fn());
const blobFor = vi.hoisted(() => vi.fn());
const compareFor = vi.hoisted(() => vi.fn());
const archiveFor = vi.hoisted(() => vi.fn());
const restoreFor = vi.hoisted(() => vi.fn());

// reference / shell store 用轻量替身：本用例验证的是 reader 如何**使用**既有 owner
// （草稿引用 / Composer 草稿 / locate），而不是这些 owner 自身的实现。
const addEntitiesToDraft = vi.hoisted(() => vi.fn(() => ({})));
const renderer = vi.hoisted(() => ({ automatic: true, pending: [] as (() => void)[] }));
const orderedNodeReferences = vi.hoisted(() => vi.fn(() => [] as unknown[]));
const requestLocate = vi.hoisted(() => vi.fn());
const setComposerPrompt = vi.hoisted(() => vi.fn());
const nodeEntityRefs = vi.hoisted(() => new Map<string, { entityType: string; entityId: string }>());
const readerPositions = vi.hoisted(() => ({} as Record<string, { scrollTop: number; zoom: number }>));
const readerLastRevisions = vi.hoisted(() => ({} as Record<string, string>));

vi.mock('@local-creative-os/web-gen2', async (importOriginal) => {
  const actual = await importOriginal<typeof WebGen2>();
  return {
    ...actual,
    CoreArtifactClient: class {
      getArtifactDetail = detailFor;
      listArtifactRevisions = revisionsFor;
      getFileRecordText = textFor;
      getFileRecordContent = blobFor;
      compareRevisions = compareFor;
      archiveArtifact = archiveFor;
      restoreArtifact = restoreFor;
    },
    HttpError: class extends Error {
      readonly status = 500;
    },
  };
});
// Owner tests use a read-only render port; full schema/render assertions live
// in ProfessionalViews.test.tsx. The browser replay uses actual scroll geometry.
vi.mock('@/components/Milkdown', () => ({
  MilkdownPreview: ({ markdown, onRendered }: { markdown: string; onRendered?: (text: string) => void }) => {
    useEffect(() => {
      const notify = () => onRendered?.(markdown);
      if (renderer.automatic) notify(); else renderer.pending.push(notify);
    }, [markdown, onRendered]);
    return <div className="ProseMirror" data-reader-parser-port>{markdown}</div>;
  },
}));
vi.mock('./readerScrollRestore', () => ({
  attachReaderScrollRestore: (node: HTMLElement, scrollTop: number) => {
    // Happy DOM has no layout; these tests check revision memory ownership.
    node.scrollTop = scrollTop;
    return { isPending: () => false, cancel: () => undefined, dispose: () => undefined };
  },
}));
vi.mock('@/components/Nodes/pdf/PDFPreview' , () => ({
  PDFPreview: ({ id, data, readOnly }: { id?: string; data: Record<string, unknown>; readOnly?: boolean }) => <div data-reader-pdf-src={String(data.src)} data-reader-pdf-node-id={id} data-reader-pdf-readonly={readOnly} />,
}));
vi.mock('@/components/Nodes/video/VideoPreview', () => ({
  VideoPreview: ({ data }: { data: Record<string, unknown> }) => <video data-reader-video-src={String(data.src)} />,
}));
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));
vi.mock('../lcosReferenceState', () => {
  const state = () => ({ projectId: 'project-1', nodeEntityRefs, addEntitiesToDraft, orderedNodeReferences, draft: { orderedEntityRefs: [] } });
  const useLcosReferenceStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useLcosReferenceStore.getState = state;
  return { useLcosReferenceStore };
});
vi.mock('../shell/lcosShellStore', () => {
  const state = () => ({
    projectId: 'project-1', composerTarget: null,
    activeSurface: 'main',
    composerPrompt: '',
    setComposerPrompt,
    requestLocate,
    readerPositions,
    readerLastRevisions,
    rememberReaderPosition: (key: string, value: { scrollTop: number; zoom: number }) => { readerPositions[key] = value; },
    rememberReaderRevision: (key: string, revisionId: string) => { readerLastRevisions[key] = revisionId; },
    clearReaderContinuity: () => {
      for (const key of Object.keys(readerPositions)) delete readerPositions[key];
      for (const key of Object.keys(readerLastRevisions)) delete readerLastRevisions[key];
    },
  });
  const useLcosShellStore = (selector: (s: ReturnType<typeof state>) => unknown) => selector(state());
  useLcosShellStore.getState = state;
  return { useLcosShellStore };
});

const roots: Root[] = [];
const containers: HTMLElement[] = [];

function detail(
  artifactId: string,
  currentRevisionId: string,
  kind: 'markdown' | 'image' | 'pdf' | 'other' = 'markdown',
  availability: 'available' | 'missing' | 'stale' = 'available',
  archivedAt?: string,
) {
  return {
    artifact: { id: artifactId, projectId: 'project-1', title: `${artifactId}.md`, kind, managed: true, availability, ...(archivedAt === undefined ? {} : { archivedAt }) },
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

async function render(
  artifactId: string,
  options: { revisionId?: string; onReturnToSource?: () => void } = {},
): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => root.render(
    <ArtifactReaderBody
      projectId="project-1"
      artifactId={artifactId}
      {...(options.revisionId === undefined ? {} : { revisionId: options.revisionId })}
      {...(options.onReturnToSource === undefined ? {} : { onReturnToSource: options.onReturnToSource })}
    />,
  ));
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
  archiveFor.mockReset();
  restoreFor.mockReset();
  addEntitiesToDraft.mockReset(); addEntitiesToDraft.mockReturnValue({});
  renderer.automatic = true; renderer.pending.length = 0;
  orderedNodeReferences.mockReset();
  orderedNodeReferences.mockReturnValue([]);
  requestLocate.mockReset();
  setComposerPrompt.mockReset();
  nodeEntityRefs.clear();
  window.sessionStorage.clear();
  clearReaderSessionContinuity();
  useLcosHostStore.getState().setHost(null);
  vi.restoreAllMocks();
});

describe('ArtifactReaderBody real content', () => {
  it('keeps archived content readable and restores the same Artifact identity', async () => {
    const archivedAt = '2026-09-20T00:00:00.000Z';
    detailFor.mockResolvedValue(detail('artifact-archived', 'revision-current', 'markdown', 'available', archivedAt));
    revisionsFor.mockResolvedValue([revision('artifact-archived', 'revision-current', 'file-current')]);
    textFor.mockResolvedValue('# Archived body');
    restoreFor.mockResolvedValue(detail('artifact-archived', 'revision-current').artifact);
    const { container } = await render('artifact-archived');
    await act(async () => textFor.mock.results[0]?.value);

    expect(container.querySelector('[data-lcos-reader-archived]')?.textContent).toContain('只读');
    expect(container.textContent).toContain('Archived body');
    click(container, '[data-lcos-reader-lifecycle="restore"]');
    await act(async () => restoreFor.mock.results[0]?.value);
    expect(restoreFor).toHaveBeenCalledWith('project-1', 'artifact-archived');
    expect(container.querySelector('[data-lcos-reader-archived]')).toBeNull();
  });

  it('removes an archived Artifact from the current canvas before scheduling full reconcile', async () => {
    detailFor.mockResolvedValue(detail('artifact-active', 'revision-current'));
    revisionsFor.mockResolvedValue([revision('artifact-active', 'revision-current', 'file-current')]);
    textFor.mockResolvedValue('# Active body');
    archiveFor.mockResolvedValue(detail(
      'artifact-active',
      'revision-current',
      'markdown',
      'available',
      '2026-09-20T00:00:00.000Z',
    ).artifact);
    const removeArchivedArtifactFromCurrentCanvas = vi.fn().mockResolvedValue(true);
    const notifyMutationSuccess = vi.fn();
    useLcosHostStore.getState().setHost({
      removeArchivedArtifactFromCurrentCanvas,
      notifyMutationSuccess,
    } as unknown as WebGen2.Gen2Host);

    const { container } = await render('artifact-active');
    click(container, '[data-lcos-reader-lifecycle="archive"]');
    await act(async () => archiveFor.mock.results[0]?.value);
    await act(async () => Promise.resolve());

    expect(removeArchivedArtifactFromCurrentCanvas).toHaveBeenCalledWith('artifact-active');
    expect(notifyMutationSuccess).toHaveBeenCalledOnce();
    expect(removeArchivedArtifactFromCurrentCanvas.mock.invocationCallOrder[0])
      .toBeLessThan(notifyMutationSuccess.mock.invocationCallOrder[0]);
  });

  it('keeps the canonical archived state when current-canvas removal fails', async () => {
    detailFor.mockResolvedValue(detail('artifact-rfs-failure', 'revision-current'));
    revisionsFor.mockResolvedValue([revision('artifact-rfs-failure', 'revision-current', 'file-current')]);
    textFor.mockResolvedValue('# Active body');
    archiveFor.mockResolvedValue(detail(
      'artifact-rfs-failure',
      'revision-current',
      'markdown',
      'available',
      '2026-09-20T00:00:00.000Z',
    ).artifact);
    const removeArchivedArtifactFromCurrentCanvas = vi.fn().mockRejectedValue(new Error('RFS unavailable'));
    const notifyMutationSuccess = vi.fn();
    useLcosHostStore.getState().setHost({
      removeArchivedArtifactFromCurrentCanvas,
      notifyMutationSuccess,
    } as unknown as WebGen2.Gen2Host);

    const { container } = await render('artifact-rfs-failure');
    click(container, '[data-lcos-reader-lifecycle="archive"]');
    await act(async () => archiveFor.mock.results[0]?.value);
    await act(async () => Promise.resolve());

    expect(container.querySelector('[data-lcos-reader-archived]')).not.toBeNull();
    expect(container.textContent).toContain('归档已保存，画布仍在同步');
    expect(container.textContent).not.toContain('归档状态更新失败');
    expect(notifyMutationSuccess).toHaveBeenCalledOnce();
  });

  it('reads the currentRevisionId even when it is not the first listed revision', async () => {
    detailFor.mockResolvedValue(detail('artifact-1', 'revision-current'));
    revisionsFor.mockResolvedValue([
      revision('artifact-1', 'revision-old', 'file-old'),
      revision('artifact-1', 'revision-current', 'file-current'),
    ]);
    textFor.mockResolvedValue('# Current body');

    const { container } = await render('artifact-1');
    expect(textFor).toHaveBeenCalledWith('project-1', 'file-current', expect.any(AbortSignal));
    expect(container.querySelector('[data-lcos-reader-content="text"]')?.textContent).toContain('Current body');
    expect(container.textContent).toContain('文本文档 · 项目材料');
    const revisionBadge = container.querySelector<HTMLElement>('[data-lcos-reader-revision-badge]');
    expect(revisionBadge?.textContent).toContain('当前版本');
    expect(revisionBadge?.textContent).not.toContain('revision-');
    expect(revisionBadge?.title).toContain('revision-current');
    expect(container.textContent).not.toContain('受管 Artifact');
    expect(container.querySelector('[title*="revision-current"]')?.getAttribute('title')).toContain('Core 状态：current');
  });

  it('distinguishes same-timestamp revision choices using real metadata and stable ID tails', async () => {
    const artifactId = 'artifact-version-labels';
    const oldA = 'revision-historical-alpha-1234';
    const oldB = 'revision-historical-beta-5678';
    const current = 'revision-current-9012';
    const createdAt = '2026-01-01T00:00:00Z';
    const revisions = [
      { id: oldA, artifactId, fileRecordId: 'file-old-a', contentHash: 'hash-a', source: 'import', status: 'superseded', createdAt },
      { id: oldB, artifactId, fileRecordId: 'file-old-b', contentHash: 'hash-b', source: 'import', status: 'superseded', createdAt },
      { id: current, artifactId, fileRecordId: 'file-current', contentHash: 'hash-current', source: 'import', status: 'current', createdAt: '2026-01-02T00:00:00Z' },
    ];
    detailFor.mockResolvedValue({ ...detail(artifactId, current), revisions });
    revisionsFor.mockResolvedValue(revisions);
    textFor.mockImplementation((_projectId: string, fileRecordId: string) => Promise.resolve(`body:${fileRecordId}`));

    const { container } = await render(artifactId);
    const choices = [...container.querySelectorAll<HTMLButtonElement>('[data-lcos-reader-revision]')];
    expect(choices).toHaveLength(3);
    expect(choices[0]?.textContent).not.toBe(choices[1]?.textContent);
    expect(choices[0]?.textContent).toContain('历史');
    expect(choices[2]?.textContent).toContain('当前');
    expect(choices[0]?.textContent).not.toContain('revision-');
    expect(choices[0]?.getAttribute('data-lcos-reader-revision')).toBe(oldA);
    expect(choices[0]?.title).toContain(oldA);
    expect(container.querySelector('[data-lcos-reader-revision-badge]')?.textContent).toContain('当前版本');

    click(container, `[data-lcos-reader-revision="${oldA}"]`);
    await act(async () => { await Promise.resolve(); });
    expect(textFor).toHaveBeenCalledWith('project-1', 'file-old-a', expect.any(AbortSignal));
    expect(container.querySelector('[data-lcos-reader-readonly]')?.textContent).toContain('历史版本（只读）');
    expect(container.querySelector('[data-lcos-reader-readonly] span')?.getAttribute('title')).toContain(oldA);
  });

  it('reads the exact revision carried by the Reader target instead of substituting current', async () => {
    detailFor.mockResolvedValue(detail('artifact-targeted', 'revision-current'));
    revisionsFor.mockResolvedValue([
      revision('artifact-targeted', 'revision-old', 'file-old'),
      revision('artifact-targeted', 'revision-current', 'file-current'),
    ]);
    textFor.mockImplementation((_projectId: string, fileRecordId: string) => Promise.resolve(`body:${fileRecordId}`));

    const { container } = await render('artifact-targeted', { revisionId: 'revision-old' });
    expect(textFor).toHaveBeenCalledWith('project-1', 'file-old', expect.any(AbortSignal));
    expect(textFor).not.toHaveBeenCalledWith('project-1', 'file-current', expect.any(AbortSignal));
    expect(container.textContent).toContain('body:file-old');
  });

  it('keeps a missing explicit revision as the target and never falls through to current', async () => {
    detailFor.mockResolvedValue(detail('artifact-missing-revision', 'revision-current'));
    revisionsFor.mockResolvedValue([
      revision('artifact-missing-revision', 'revision-current', 'file-current'),
    ]);
    textFor.mockResolvedValue('current body must not be read');

    const { container } = await render('artifact-missing-revision', { revisionId: 'revision-gone' });
    expect(textFor).not.toHaveBeenCalled();
    expect(container.querySelector('[data-lcos-reader-content="error"]')?.textContent).toContain('未切换到当前版本');
    expect(container.querySelector('[data-lcos-reader-revision-badge]')?.textContent).toContain('目标版本不可读');
    expect(container.querySelector<HTMLElement>('[data-lcos-reader-revision-badge]')?.title).toContain('revision-gone');
  });

  it('exposes stale source state while keeping the requested revision readable', async () => {
    detailFor.mockResolvedValue(detail('artifact-stale', 'revision-current', 'markdown', 'stale'));
    revisionsFor.mockResolvedValue([revision('artifact-stale', 'revision-current', 'file-current')]);
    textFor.mockResolvedValue('recorded body');
    const { container } = await render('artifact-stale', { revisionId: 'revision-current' });
    expect(container.querySelector('[data-lcos-reader-availability="stale"]')?.textContent).toContain('不会自动换');
    expect(container.textContent).toContain('recorded body');
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
    const imageDetail = detail('artifact-image', 'revision-current', 'image');
    detailFor.mockResolvedValue({ ...imageDetail, revisions: [imageDetail.revisions[1]] });
    revisionsFor.mockResolvedValue([revision('artifact-image', 'revision-current', 'file-image')]);
    blobFor.mockResolvedValue(new Blob(['image-bytes'], { type: 'image/png' }));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reader-image');
    const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    const { root, container } = await render('artifact-image');
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('[data-lcos-reader-zoom]')).toBeNull();
    expect(container.querySelector('[data-lcos-reader-revisions]')).toBeNull();
    expect(container.querySelector('[data-lcos-reader-cite]')).toBeNull();
    expect(container.querySelector('[data-lcos-reader-compare-toggle]')).toBeNull();
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
    expect(panel?.getAttribute('title')).toContain('revision-old');
    expect(panel?.textContent).not.toContain('revision-old');
    expect(container.querySelectorAll('[data-lcos-reader-compare-line]')).toHaveLength(0);
  });

  it('加入引用与摘录为引用：写既有草稿引用，并把带 Source Trace 的引用块送进 Composer 草稿', async () => {
    const { container } = await renderMarkdown();
    click(container, '[data-lcos-reader-to-draft]');
    expect(addEntitiesToDraft).toHaveBeenCalledWith([expect.objectContaining({ entityType: 'artifact', entityId: 'artifact-1', revisionId: 'revision-current' })], undefined);

    const range = document.createRange();
    const selectedBody = container.querySelector('[data-lcos-reader-content="text"]');
    if (selectedBody === null) throw new Error('Reader body missing');
    range.selectNodeContents(selectedBody);
    vi.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 1, getRangeAt: () => range, toString: () => '  摘录正文  ' } as unknown as Selection);
    click(container, '[data-lcos-reader-cite]');
    expect(setComposerPrompt).toHaveBeenCalledTimes(1);
    const block = String(setComposerPrompt.mock.calls[0]?.[0]);
    expect(block).toContain('artifact:artifact-1@revision-current');
    expect(block).toContain('摘录正文');
    expect(container.querySelector('[data-lcos-reader-cite-trace]')?.textContent).toContain('artifact:artifact-1@revision-current');
  });

  it('拒绝把其他窗口或跨越正文边界的选区归到当前材料', async () => {
    const { container } = await renderMarkdown();
    const external = document.createElement('p');
    external.textContent = '另一个窗口的正文';
    document.body.append(external);
    const range = document.createRange();
    range.selectNodeContents(external);
    vi.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 1, getRangeAt: () => range, toString: () => external.textContent } as unknown as Selection);
    click(container, '[data-lcos-reader-cite]');
    expect(setComposerPrompt).not.toHaveBeenCalled();
    expect(addEntitiesToDraft).not.toHaveBeenCalled();
    external.remove();
  });

  it('未选中正文时不给「无来源引用」，如实提示', async () => {
    const { container } = await renderMarkdown();
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => '   ' } as unknown as Selection);
    click(container, '[data-lcos-reader-cite]');
    expect(setComposerPrompt).not.toHaveBeenCalled();
    expect(container.querySelector('[data-lcos-reader-note]')?.textContent).toContain('先选中正文');
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

  it('阅读缩放与 Canvas zoom 分离，并在同一窗口会话重开后恢复版本/位置/缩放', async () => {
    const { container } = await renderMarkdown('artifact-zoom');
    const content = container.querySelector<HTMLElement>('[data-lcos-reader-content="text"]');
    expect(content).not.toBeNull();
    if (content === null) return;
    content.scrollTop = 180;
    act(() => content.dispatchEvent(new Event('scroll', { bubbles: true })));
    click(container, '[data-lcos-reader-zoom-in]');
    expect(container.querySelector('[data-lcos-reader-zoom-value]')?.textContent).toBe('110%');
    expect(container.querySelector<HTMLElement>('[data-lcos-reader-text-scale]')?.style.zoom).toBe('1.1');
    act(() => roots.at(-1)?.unmount());
    const reopened = await renderMarkdown('artifact-zoom');
    expect(reopened.container.querySelector('[data-lcos-reader-zoom-value]')?.textContent).toBe('110%');
    expect(reopened.container.querySelector<HTMLElement>('[data-lcos-reader-content="text"]')?.scrollTop).toBe(180);
  });

  it('isolates same-session scroll and zoom by artifact revision target', async () => {
    detailFor.mockResolvedValue(detail('artifact-two-revisions', 'revision-current'));
    revisionsFor.mockResolvedValue([
      revision('artifact-two-revisions', 'revision-old', 'file-old'),
      revision('artifact-two-revisions', 'revision-current', 'file-current'),
    ]);
    textFor.mockImplementation((_projectId: string, fileRecordId: string) => Promise.resolve(`body:${fileRecordId}`));

    const oldTarget = await render('artifact-two-revisions', { revisionId: 'revision-old' });
    const oldContent = oldTarget.container.querySelector<HTMLElement>('[data-lcos-reader-content="text"]')!;
    oldContent.scrollTop = 90;
    act(() => oldContent.dispatchEvent(new Event('scroll', { bubbles: true })));
    click(oldTarget.container, '[data-lcos-reader-zoom-in]');
    act(() => oldTarget.root.unmount());

    const currentTarget = await render('artifact-two-revisions', { revisionId: 'revision-current' });
    expect(currentTarget.container.querySelector('[data-lcos-reader-zoom-value]')?.textContent).toBe('100%');
    expect(currentTarget.container.querySelector<HTMLElement>('[data-lcos-reader-content="text"]')?.scrollTop).toBe(0);
    act(() => currentTarget.root.unmount());

    const reopenedOld = await render('artifact-two-revisions', { revisionId: 'revision-old' });
    expect(reopenedOld.container.querySelector('[data-lcos-reader-zoom-value]')?.textContent).toBe('110%');
    expect(reopenedOld.container.querySelector<HTMLElement>('[data-lcos-reader-content="text"]')?.scrollTop).toBe(90);
  });

  it('shows a truthful reader content failure when the canonical file record is unavailable', async () => {
    detailFor.mockResolvedValue(detail('artifact-failure', 'revision-current'));
    revisionsFor.mockResolvedValue([revision('artifact-failure', 'revision-current', 'file-failure')]);
    textFor.mockRejectedValue(new Error('file record unavailable'));
    const { container } = await render('artifact-failure');
    expect(container.querySelector('[data-lcos-reader-content="error"]')?.textContent).toContain('file record unavailable');
    click(container, '[data-lcos-reader-retry]');
    await act(async () => { await Promise.resolve(); });
    expect(textFor).toHaveBeenCalledTimes(2);
  });

  it('delegates return-to-source to the Professional Stage owner when provided', async () => {
    const onReturnToSource = vi.fn();
    const { container } = await renderMarkdown('artifact-return');
    await act(async () => roots.at(-1)?.render(
      <ArtifactReaderBody
        projectId="project-1"
        artifactId="artifact-return"
        onReturnToSource={onReturnToSource}
      />,
    ));
    click(container, '[data-lcos-reader-source-return]');
    expect(onReturnToSource).toHaveBeenCalledTimes(1);
    expect(requestLocate).not.toHaveBeenCalled();
  });
});

it('reads PDF bytes from the requested historical revision and gives the donor no synthetic canvas node', async () => {
  detailFor.mockResolvedValue(detail('artifact-pdf', 'revision-current', 'pdf'));
  revisionsFor.mockResolvedValue([revision('artifact-pdf', 'revision-old', 'file-old-pdf')]);
  blobFor.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:historic-pdf');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const { root, container } = await render('artifact-pdf', { revisionId: 'revision-old' });
  await act(async () => { await import('@/components/Nodes/pdf/PDFPreview'); });
  expect(blobFor).toHaveBeenCalledWith('project-1', 'file-old-pdf', expect.any(AbortSignal));
  const pdf = container.querySelector('[data-reader-pdf-src="blob:historic-pdf"]');
  expect(pdf).not.toBeNull();
  expect(pdf?.hasAttribute('data-reader-pdf-node-id')).toBe(false);
  expect(pdf?.getAttribute('data-reader-pdf-readonly')).toBe('true');
  act(() => root.unmount());
  expect(revoke).toHaveBeenCalledWith('blob:historic-pdf');
});

it('uses actual video MIME bytes for the mature donor preview', async () => {
  detailFor.mockResolvedValue(detail('artifact-video', 'revision-current', 'other'));
  revisionsFor.mockResolvedValue([revision('artifact-video', 'revision-current', 'file-video')]);
  blobFor.mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reader-video');
  const { container } = await render('artifact-video');
  await act(async () => { await import('@/components/Nodes/video/VideoPreview'); });
  expect(container.querySelector('[data-reader-video-src="blob:reader-video"]')).not.toBeNull();
});

it('reuses the shared audio player with the actual revision source instead of a second playback implementation', async () => {
  detailFor.mockResolvedValue(detail('artifact-audio', 'revision-current', 'other'));
  revisionsFor.mockResolvedValue([revision('artifact-audio', 'revision-current', 'file-audio')]);
  blobFor.mockResolvedValue(new Blob(['audio'], { type: 'audio/wav' }));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reader-audio');
  const { container } = await render('artifact-audio');
  await act(async () => { await import('../nodes/source/AudioSourceMorphology'); });
  expect(container.querySelector('[data-lcos-audio-player]')?.getAttribute('src')).toBe('blob:reader-audio');
});

it('reads a plain-text artifact from the actual revision MIME instead of declaring no content', async () => {
  detailFor.mockResolvedValue(detail('artifact-text', 'revision-current', 'other'));
  revisionsFor.mockResolvedValue([revision('artifact-text', 'revision-current', 'file-text')]);
  blobFor.mockResolvedValue(new Blob(['真实纯文本'], { type: 'text/plain' }));
  const { container } = await render('artifact-text');
  expect(container.querySelector('[data-lcos-reader-content="text"]')?.textContent).toContain('真实纯文本');
  expect(blobFor).toHaveBeenCalledWith('project-1', 'file-text', expect.any(AbortSignal));
});


it('does not overwrite saved revision position before the actual renderer is ready', async () => {
  renderer.automatic = false;
  const key = JSON.stringify(['project-1', 'artifact-readiness', 'revision-current']);
  readerPositions[key] = { scrollTop: 840, zoom: 125 };
  detailFor.mockResolvedValue(detail('artifact-readiness', 'revision-current'));
  revisionsFor.mockResolvedValue([revision('artifact-readiness', 'revision-current', 'file-current')]);
  textFor.mockResolvedValue('等待异步排版的正文');
  const { container } = await render('artifact-readiness');
  const viewport = container.querySelector<HTMLElement>('[data-lcos-reader-content="text"]')!;
  expect(viewport).not.toBeNull();
  viewport.scrollTop = 0;
  await act(async () => viewport.dispatchEvent(new Event('scroll', { bubbles: true })));
  expect(readerPositions[key]?.scrollTop).toBe(840);
  await act(async () => { for (const notify of renderer.pending.splice(0)) notify(); });
  expect(viewport.scrollTop).toBe(840);
});
