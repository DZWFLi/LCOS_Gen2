import { lazy, Suspense, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';

import { Button } from '@/components/Common/Button';
import { MilkdownPreview } from '@/components/Milkdown';
import { PreviewHeaderSlotContext } from '@/components/Nodes/PreviewHeaderSlot';

import { Gen1ImageZoomStage } from './donor/Gen1ImageZoomStage';
import ScrollProgress, { type ScrollProgressSection } from './donor/ScrollProgress';
import './donor/gen1-reader.css';
import './professional-reading.css';
import './reader-scroll-progress.css';

import type { ReactNode, Ref, UIEventHandler } from 'react';

const PdfReader = lazy(() => import('@/components/Nodes/pdf/PDFPreview').then((module) => ({ default: module.PDFPreview })));
const AudioReader = lazy(() => import('../../nodes/source/AudioSourceMorphology').then((module) => ({ default: module.AudioSourceMorphology })));
const VideoReader = lazy(() => import('@/components/Nodes/video/VideoPreview').then((module) => ({ default: module.VideoPreview })));
const readOnlyHeader = { el: null };

/** The owning Reader supplies revision bytes. No loading, URL or revision owner lives here. */
export type ReaderVisibleContent =
  | { readonly kind: 'text'; readonly value: string; readonly viewKey?: string; readonly mimeType?: string }
  | { readonly kind: 'image' | 'pdf' | 'video' | 'audio'; readonly url: string; readonly mimeType: string; readonly viewKey?: string }
  | null;

export function readerArtifactKindLabel(kind: string): string {
  switch (kind) {
    case 'markdown': return '文本文档';
    case 'image': return '图片';
    case 'presentation': return '演示文稿';
    case 'pdf': return 'PDF 文档';
    case 'other': return '其他文件';
    default: return '其他材料';
  }
}

export interface ReaderContentViewProps {
  readonly content: ReaderVisibleContent;
  readonly kind: string;
  readonly fileName: string;
  readonly contentRef?: Ref<HTMLDivElement>;
  readonly onScroll?: UIEventHandler<HTMLDivElement>;
  /** Content has rendered, not merely arrived from the file service. */
  readonly onContentReady?: (content: NonNullable<ReaderVisibleContent>) => void;
  /** The owner keeps the reader's continuity/zoom state; this view only presents it. */
  readonly zoom?: number;
  readonly loading?: boolean;
  readonly error?: string;
  readonly onRetry?: () => void;
  /** Reuse the host's renderer when one is available; never parse or fetch a second copy. */
  readonly renderedText?: ReactNode;
  readonly unavailableGlyph?: ReactNode;
  /** Optional owner-supplied loading/error/recovery presentation. null content is NOT success. */
  readonly feedback?: ReactNode;
}

/** Thin presentation adaptation of GEN1 ArtifactViewerHost's content/fallback junction. */
export function ReaderContentView({
  content,
  kind,
  fileName,
  contentRef,
  onScroll,
  onContentReady,
  zoom = 100,
  loading = false,
  error,
  onRetry,
  renderedText,
  unavailableGlyph,
  feedback,
}: ReaderContentViewProps): React.JSX.Element {
  if (loading) {
    return (
      <div data-lcos-reader-content="loading" className="lcos-reader-unavailable" aria-live="polite">
        正在读取正文…
      </div>
    );
  }

  if (error !== undefined) {
    return (
      <div data-lcos-reader-content="error" className="lcos-reader-unavailable" role="alert">
        <span>正文读取失败 · {error}</span>
        {onRetry === undefined ? null : (
          <button type="button" data-lcos-reader-retry onClick={onRetry}>重读同一版本</button>
        )}
      </div>
    );
  }

  if (content?.kind === 'text') {
    return <ReaderTextContent key={content.viewKey ?? fileName} content={content} kind={kind}
      contentRef={contentRef} onScroll={onScroll} onContentReady={onContentReady}
      zoom={zoom} renderedText={renderedText} feedback={feedback} />;
  }

  if (content?.kind === 'pdf' || content?.kind === 'video' || content?.kind === 'audio') {
    return <div ref={contentRef} onScroll={onScroll} className="lcos-reader-media-page lcos-reader-document-media" data-lcos-reader-content={content.kind}>
      <Suspense fallback={<div role="status">正在载入预览…</div>}>
        {content.kind === 'pdf'
          ? <PreviewHeaderSlotContext.Provider value={readOnlyHeader}>
              <PdfReader key={content.viewKey ?? content.url} data={{ src: content.url, name: fileName }} readOnly
                {...(content.viewKey === undefined ? {} : { scrollViewKey: content.viewKey })} />
            </PreviewHeaderSlotContext.Provider>
          : content.kind === 'audio' ? <AudioReader key={content.url} family="audio" title={fileName} density="reading" mediaSrc={content.url} />
          : <VideoReader key={content.url} data={{ src: content.url, name: fileName }} readOnly />}
      </Suspense>
      {feedback}
    </div>;
  }

  if (content?.kind === 'image') {
    return (
      <div
        ref={contentRef}
        onScroll={onScroll}
        data-lcos-reader-content="image"
        className="lcos-reader-media-page"
      >
        <figure className="lcos-reader-figure">
          <Gen1ImageZoomStage key={content.viewKey ?? content.url} src={content.url} alt={fileName} {...(onRetry === undefined ? {} : { onRetry })} />
          <figcaption className="lcos-reader-media-caption">{fileName}</figcaption>
        </figure>
        <span className="lcos-professional-sr-only">{content.mimeType}</span>
        {feedback}
      </div>
    );
  }

  return (
    <div data-lcos-reader-content="unavailable" className="lcos-reader-unavailable">
      {feedback === undefined ? (
        <>
          <span aria-hidden="true" className="lcos-reader-unavailable-glyph">{unavailableGlyph}</span>
          <span>{fileName} · {readerArtifactKindLabel(kind)} · 暂无可用正文读取通道</span>
        </>
      ) : feedback}
    </div>
  );
}

/** Reuse the same parser/schema as the canvas document and editor. The owner
 * continues to supply immutable revision bytes; this surface never fetches Current. */
function ReaderTextContent({ content, kind, contentRef, onScroll, onContentReady, zoom, renderedText, feedback }: {
  content: Extract<ReaderVisibleContent, { kind: 'text' }>;
  kind: string;
  contentRef: ReaderContentViewProps['contentRef'];
  onScroll: ReaderContentViewProps['onScroll'];
  onContentReady: ReaderContentViewProps['onContentReady'];
  zoom: number;
  renderedText: ReactNode;
  feedback: ReactNode;
}): React.JSX.Element {
  const [renderError, setRenderError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [showSource, setShowSource] = useState(false);
  const readerAnchorPrefix = `lcos-reader-${useId().replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const readerContentRef = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<readonly ScrollProgressSection[]>([]);
  const [hasScrollableContent, setHasScrollableContent] = useState(false);
  useImperativeHandle(contentRef, () => readerContentRef.current as HTMLDivElement);
  const latest = useRef({ content, onContentReady });
  latest.current = { content, onContentReady };
  const rich = renderedText === undefined && !showSource
    && (kind === 'markdown' || content.mimeType?.split(';')[0] === 'text/markdown');
  const collectSections = useCallback(() => {
    const container = readerContentRef.current;
    if (container === null) {
      setSections([]);
      return;
    }
    const headings = Array.from(container.querySelectorAll<HTMLElement>(
      '.lcos-reader-measure h1, .lcos-reader-measure h2, .lcos-reader-measure h3, .lcos-reader-measure h4, .lcos-reader-measure h5, .lcos-reader-measure h6',
    ));
    const next: ScrollProgressSection[] = [];
    const scopedIdsBySource = new Map<string, string>();
    headings.forEach((heading, index) => {
      const label = heading.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (!label) return;
      const storedSourceId = heading.getAttribute('data-lcos-reader-source-id');
      const sourceId = storedSourceId ?? heading.id;
      if (storedSourceId === null) heading.setAttribute('data-lcos-reader-source-id', sourceId);
      const baseId = sourceId || `section-${index + 1}`;
      const suffix = next.some((section) => section.id === `${readerAnchorPrefix}-${baseId}`)
        ? `-${index + 1}`
        : '';
      const scopedId = `${readerAnchorPrefix}-${baseId}${suffix}`;
      if (sourceId) scopedIdsBySource.set(sourceId, scopedId);
      if (heading.id) scopedIdsBySource.set(heading.id, scopedId);
      heading.id = scopedId;
      next.push({ id: scopedId, label });
    });
    for (const link of container.querySelectorAll<HTMLAnchorElement>('.lcos-reader-measure a[href^="#"]')) {
      const sourceId = link.getAttribute('href')?.slice(1);
      const scopedId = sourceId === undefined ? undefined : scopedIdsBySource.get(sourceId);
      if (scopedId !== undefined) link.setAttribute('href', `#${scopedId}`);
    }
    setSections(next);
  }, [readerAnchorPrefix]);
  const measureScrollableContent = useCallback(() => {
    const container = readerContentRef.current;
    const scrollable = container !== null && container.scrollHeight > container.clientHeight + 1;
    setHasScrollableContent((current) => current === scrollable ? current : scrollable);
  }, []);
  const ready = useCallback(() => {
    collectSections();
    measureScrollableContent();
    const { content: current, onContentReady: notify } = latest.current;
    notify?.(current);
  }, [collectSections, measureScrollableContent]);
  const failed = useCallback((error: Error) => setRenderError(error.message), []);
  useEffect(() => { if (!rich) ready(); }, [rich, content, renderedText, ready]);
  useEffect(() => {
    const container = readerContentRef.current;
    if (container === null) return;
    measureScrollableContent();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measureScrollableContent);
    observer?.observe(container);
    const measure = container.querySelector('.lcos-reader-measure');
    if (measure) observer?.observe(measure);
    window.addEventListener('resize', measureScrollableContent);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measureScrollableContent);
    };
  }, [content, renderedText, zoom, showSource, measureScrollableContent]);
  return <div data-lcos-reader-content-frame className="lcos-reader-content-frame">
    <div ref={readerContentRef} onScroll={onScroll} data-lcos-reader-content="text"
      data-figma-node-id="5388:27484" className="lcos-reader-page">
      <div className="lcos-reader-measure">
        {rich ? <div data-lcos-reader-text-scale style={{ zoom: zoom / 100 }}>
          <MilkdownPreview key={attempt} markdown={content.value} enableBlockDrag={false}
            ariaLabel="正文（只读）" className="lcos-reader-richtext lcos-reader-markdown"
            onRendered={ready} onError={failed} />
        </div> : renderedText !== undefined ? <div className="lcos-reader-richtext" style={{ zoom: zoom / 100 }}>{renderedText}</div>
          : <pre className="lcos-reader-plaintext" style={{ fontSize: `${16 * zoom / 100}px` }}>{content.value}</pre>}
        {renderError && !showSource && <div role="alert" data-lcos-reader-render-error>
          <p>此版本正文已读取，但格式预览未能载入：{renderError}</p>
          <Button size="sm" variant="ghost" onClick={() => { setRenderError(undefined); setAttempt(n => n + 1); }}>重试格式预览</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowSource(true)}>查看同一版本原文</Button>
        </div>}
      </div>
      {feedback}
    </div>
    {sections.length > 0 && hasScrollableContent && <ScrollProgress
      data-lcos-reader-scroll-progress
      aria-label="正文章节进度"
      sections={[...sections]}
      containerRef={readerContentRef}
      className="lcos-reader-scroll-progress"
    />}
  </div>;
}
