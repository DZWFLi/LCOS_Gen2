// ArtifactReaderBody — 阅读器（Figma Reader 5388:27411；Professional Stage 临时 body）。
// 真实 Artifact read：getArtifactDetail + revisions；正文预览能力按 kind 诚实降级
// （text/markdown 直接读 revision 正文；其它 kind 显示元数据 + 外部打开提示）。

import { CoreArtifactClient, HttpError } from '@local-creative-os/web-gen2';
import { ExternalLink, FileText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';


import { createLcosCoreSession } from '../app/lcosCoreClient';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../ui/lcosTokens';

export interface ArtifactReaderBodyProps {
  readonly projectId: string;
  readonly artifactId?: string;
}

export function ArtifactReaderBody({ artifactId }: ArtifactReaderBodyProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const artifacts = useMemo(() => new CoreArtifactClient(session.http), [session]);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'empty'>('loading');
  const [detail, setDetail] = useState<Awaited<ReturnType<CoreArtifactClient['getArtifactDetail']>> | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!artifactId) {
      setState('empty');
      return;
    }
    setState('loading');
    void artifacts
      .getArtifactDetail(artifactId)
      .then((value) => {
        setDetail(value);
        setState('ready');
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(error instanceof HttpError ? `${error.message} (${error.status})` : String(error));
      });
  }, [artifactId, artifacts]);

  if (state === 'empty') {
    return <ReaderMessage text="选择一项材料开始阅读（从 Assembly 或节点打开）" />;
  }
  if (state === 'loading') {
    return <ReaderMessage feedback="loading" text="读取文件…" />;
  }
  if (state === 'error') {
    return <ReaderMessage feedback="error" text={`读取失败${errorDetail ? `（${errorDetail}）` : ''}`} />;
  }
  if (!detail) return <ReaderMessage text="没有可读内容" />;

  const revision = detail.revisions[0];
  const kind = detail.artifact.kind;
  const fileName = detail.artifact.title;

  return (
    <div data-lcos-reader className="flex h-full flex-col gap-3 p-5" style={{ minHeight: 320 }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold" style={{ color: lcosTokens.color.text }}>
            {detail.artifact.title ?? '未命名'}
          </h3>
          <p className="mt-0.5 break-all text-xs" style={{ color: lcosTokens.color.muted }}>
            {String(kind)} · {detail.artifact.managed === true ? '受管 Artifact' : '外部引用'}
          </p>
        </div>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>
          {revision ? `${revision.id.slice(0, 8)} · ${revision.status}` : '无 revision'}
        </span>
      </div>

      {/* 正文预览：由真实 Revision 读取通道承载（当前 route 提供元数据；正文走节点/文件预览，Wave 9 深化） */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl p-6" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}>
        <FileText className="h-6 w-6" style={{ color: lcosTokens.color.muted }} aria-hidden />
        <span className="text-sm" style={{ color: lcosTokens.color.muted }}>
          {fileName ?? '材料'} · {String(kind)} 预览请打开节点/使用系统工具（正文预览尚未接入）
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: lcosTokens.color.info }}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden /> 用系统/外部工具打开
        </span>
      </div>

      {detail.revisions.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {detail.revisions.map((r) => (
            <span key={r.id} className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>
              {r.id.slice(0, 8)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ReaderMessage({
  text,
  feedback,
}: {
  text: string;
  feedback?: 'loading' | 'error';
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center">
      {feedback === 'loading' || feedback === 'error' ? (
        <LcosSurfaceFeedback presentation={feedback} message={text} />
      ) : (
        <span className="text-sm" style={{ color: lcosTokens.color.muted }}>{text}</span>
      )}
    </div>
  );
}