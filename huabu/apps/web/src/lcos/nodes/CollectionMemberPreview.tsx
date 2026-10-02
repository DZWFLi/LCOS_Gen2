import { FileText, Folder, Image, Music, Video, MessageSquare, PanelsTopLeft, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CollectionMemberPreview as Member, CoreArtifactClient } from '@local-creative-os/web-gen2';
import { LcosButton } from '../ui/primitives/LcosButton';
import { PreviewMedia } from '../ui/spatial/PreviewMedia';
import { collectionPreviewLoadable, readCollectionPreviewMedia, COLLECTION_PREVIEW_LABELS } from './collectionPreviewMedia';

export interface CollectionMemberPreviewProps {
  readonly projectId: string;
  readonly member: Member;
  readonly client: Pick<CoreArtifactClient, 'getFileRecordContent'>;
  readonly enabled?: boolean;
  readonly presentation?: 'card' | 'gen1-sheet';
  readonly sheetIndex?: number;
}

function MemberPreview({ projectId, member, client, enabled = true, presentation = 'card', sheetIndex = 0 }: CollectionMemberPreviewProps): React.JSX.Element {
  const host = useRef<HTMLElement | null>(null);
  const setHost = useCallback((element: HTMLElement | null) => { host.current = element; }, []);
  const [visible, setVisible] = useState(false);
  const [media, setMedia] = useState<{ image?: string; text?: string; error?: boolean }>({});
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !host.current) return;
    if (typeof IntersectionObserver !== 'function') { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(host.current); return () => observer.disconnect();
  }, [enabled]);
  // Stable scalars: metadata refresh alone must not redownload or flash the cover.
  const { type, id, kind, availability, revisionId, fileRecordId, mimeType, byteSize, excerpt } = member;
  useEffect(() => {
    if (!enabled || !visible || (presentation === 'gen1-sheet' && kind !== 'image')) return;
    const controller = new AbortController(); let url: string | undefined;
    setMedia({}); setLoading(collectionPreviewLoadable(member));
    void readCollectionPreviewMedia(client, projectId, member, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      if (value instanceof Blob) { url = URL.createObjectURL(value); setMedia({ image: url }); }
      else setMedia(value === undefined ? {} : { text: value });
      setLoading(false);
    }).catch(() => { if (!controller.signal.aborted) { setMedia({ error: true }); setLoading(false); } });
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [attempt, enabled, visible, client, projectId, type, id, kind, availability, revisionId, fileRecordId, mimeType, byteSize, excerpt, presentation]);
  const Icon = member.kind === 'image' ? Image : member.kind === 'audio' ? Music : member.kind === 'video' ? Video
    : member.kind === 'collection' ? Folder : member.kind === 'conversation' ? MessageSquare
      : member.kind === 'workspace' ? PanelsTopLeft : member.kind === 'run' ? Play : FileText;
  const reason = member.availability === 'missing' ? '来源缺失'
    : member.availability === 'stale' ? '来源已变化' : member.availability === 'unreadable' ? '暂不可预览'
      : media.error ? '预览读取失败' : loading ? '正在读取' : member.archived ? '已归档' : COLLECTION_PREVIEW_LABELS[member.kind];
  if (presentation === 'gen1-sheet') return <span ref={setHost}
    className={`lcos-collection-stack-sheet stack-sheet-${Math.min(2, Math.max(0, sheetIndex))}`}
    data-stack-kind={kind} data-lcos-member-preview={`${type}:${id}`} data-member-revision={revisionId}
    data-preview-kind={kind} data-preview-state={media.error ? 'error' : loading ? 'loading' : availability}
    title={`${member.label} · ${reason}`}>
    {media.image ? <img src={media.image} alt="" draggable={false} onDragStart={(event) => event.preventDefault()}
      onError={() => setMedia({ error: true })}/>
      : <><i/><b>{member.label.slice(0, 18)}</b></>}
    {media.error ? <button type="button" className="lcos-collection-sheet-retry" aria-label={`重读预览 ${member.label}`}
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); setAttempt((value) => value + 1); }}>重读</button> : null}
  </span>;
  return <div ref={setHost} className="lcos-collection-member-preview" data-lcos-member-preview={`${member.type}:${member.id}`}
    data-member-revision={revisionId} data-preview-kind={kind} data-preview-state={media.error ? 'error' : loading ? 'loading' : availability}
    title={`${member.label} · ${reason}`}>
    {media.image ? <PreviewMedia src={media.image} label={member.label} fit="contain" />
      : <div className="lcos-collection-member-sheet"><Icon size={18} aria-hidden />
          <strong>{member.label}</strong>{media.text !== undefined ? <p>{media.text || '空文本'}</p> : null}
          <small>{reason}</small>{media.error ? <LcosButton appearance="oreo" variant="ghost" size="sm"
            className="lcos-collection-preview-retry" aria-label={`重读预览 ${member.label}`}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setAttempt((value) => value+1); }}>重读</LcosButton> : null}</div>}
  </div>;
}

/** Keyed to exact member bytes; a removed member or changed revision cannot
 * briefly display the preceding member's image while effects catch up. */
export function CollectionMemberPreview(props: CollectionMemberPreviewProps): React.JSX.Element {
  const m = props.member;
  return <MemberPreview key={JSON.stringify([props.projectId,m.type,m.id,m.revisionId,m.fileRecordId,m.availability,m.excerpt,props.enabled,props.presentation])} {...props} />;
}
