import { useEffect, useRef, useState } from 'react';

import { LcosSurfaceFeedback } from '../LcosSurfaceFeedback';
import { safeAssemblyLink } from './assemblyPresentation';
import { LcosButton } from '../primitives/LcosButton';
import { Gen1ImageZoomStage } from './donor/Gen1ImageZoomStage';
import { Gen1TextDocument } from './donor/Gen1TextDocument';
import './professional-assembly.css';

export interface AssemblyPreviewPresentation {
  readonly status: 'loading' | 'ready' | 'error';
  readonly subjectKey: string;
  readonly title: string;
  readonly kind: 'text' | 'image' | 'url' | 'local_path' | 'descriptor' | 'skill' | 'audio' | 'video' | 'unknown';
  readonly text?: string;
  readonly dataUrl?: string;
  readonly url?: string;
  readonly path?: string;
  readonly mediaUrl?: string;
  readonly error?: string;
  readonly lines?: readonly { readonly label: string; readonly value: string }[];
  readonly sourceLabel?: string;
}
export function AssemblyPreviewView({ preview, onClose, onRetry, actions }: {
  readonly preview: AssemblyPreviewPresentation;
  readonly onClose: () => void;
  readonly onRetry: () => void;
  readonly actions?: React.ReactNode;
}): React.JSX.Element {
  const back = useRef<HTMLButtonElement>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => setMediaFailed(false), [preview.subjectKey, preview.mediaUrl]);
  // User-opened drill-in: focus once, not again when an async result arrives.
  useEffect(() => { back.current?.focus({ preventScroll: true }); }, [preview.subjectKey]);
  const link = safeAssemblyLink(preview.url);
  return <section className="lcos-assembly-preview" data-lcos-assembly-preview={preview.subjectKey}
    aria-label={`预览 ${preview.title}`} onKeyDownCapture={(event) => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.stopPropagation(); event.preventDefault(); onClose(); }
    }}>
    <header><LcosButton appearance="oreo" ref={back} variant="ghost" onClick={onClose} data-lcos-assembly-preview-close>返回材料</LcosButton>
      <span>{preview.kind === 'skill' ? '技能阅读' : '来源预览'}</span></header>
    <div className="lcos-assembly-preview-heading"><h2>{preview.title}</h2>
      {preview.sourceLabel ? <p>{preview.sourceLabel}</p> : null}</div>
    <div className="lcos-assembly-preview-content" aria-busy={preview.status === 'loading'}>
      {preview.status === 'loading' ? <LcosSurfaceFeedback presentation="loading" message="正在读取预览…" />
        : preview.status === 'error' ? <LcosSurfaceFeedback presentation="error" message={preview.error ?? '预览读取失败'} onAction={onRetry} actionLabel="重试读取" />
        : <>
          {preview.dataUrl ? <Gen1ImageZoomStage key={preview.subjectKey} src={preview.dataUrl} alt={preview.title} onRetry={onRetry} /> : null}
          {preview.mediaUrl && !mediaFailed && preview.kind === 'video' ? <video key={preview.mediaUrl} src={preview.mediaUrl} controls preload="metadata" aria-label={preview.title} onError={() => setMediaFailed(true)} /> : null}
          {preview.mediaUrl && !mediaFailed && preview.kind === 'audio' ? <audio key={preview.mediaUrl} src={preview.mediaUrl} controls preload="metadata" aria-label={preview.title} onError={() => setMediaFailed(true)} /> : null}
          {mediaFailed ? <LcosSurfaceFeedback presentation="error" message="这段媒体暂时无法播放。" onAction={onRetry} actionLabel="重新读取" /> : null}
          {preview.text !== undefined ? <Gen1TextDocument text={preview.text} /> : null}
          {link ? <a className="lcos-assembly-source-link" href={link} target="_blank" rel="noopener noreferrer">{preview.url}</a> : preview.url ? <p className="lcos-assembly-source-link">{preview.url}</p> : null}
          {preview.path ? <p className="lcos-assembly-source-link">{preview.path}</p> : null}
          {preview.lines ? <dl className="lcos-assembly-descriptor">{preview.lines.map((line) => <div key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}</dl> : null}
          {!preview.dataUrl && !preview.mediaUrl && preview.text === undefined && !preview.url && !preview.path && !preview.lines?.length
            ? <LcosSurfaceFeedback presentation="empty" message="这种文件暂不支持快速预览，可在阅读窗口中查看。" /> : null}
        </>}
    </div>
    {actions ? <footer className="lcos-assembly-preview-actions">{actions}</footer> : null}
  </section>;
}
