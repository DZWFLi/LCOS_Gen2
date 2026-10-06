import {
  collectionPreviewMembers,
  type CollectionMemberPreview as CoreCollectionMemberPreview,
  type CoreCollectionMembersSnapshot,
  type CoreCollectionMemberRef,
} from '@local-creative-os/web-gen2';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { removeCollectionMember } from './collectionMemberActions';
import { CollectionMemberPreview, isReadableCollectionArtifact } from './CollectionMemberPreview';
import { CollectionMembersMenu } from './CollectionMembersMenu';
import { Gen1CollectionFace, type Gen1CollectionFaceProps } from './Gen1CollectionFace';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import { SessionRefreshQueue } from '../collaboration/sessionRefreshQueue';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { ContextCollectionView, type ContextCollectionViewProps } from '../ui/context/ContextCollectionView';
import './collection-preview.css';

export interface CanonicalCollectionViewProps extends ContextCollectionViewProps {
  readonly presentation?: 'context' | 'compact';
  /** Canvas owns dimensions. Only gallery tiles scale to their available width. */
  readonly sizing?: 'tile' | 'canvas';
  readonly folder?: Omit<Gen1CollectionFaceProps, 'title' | 'previews' | 'sheets' | 'count' | 'readError' | 'onRetry'>;
  readonly projectId: string;
  readonly collectionId: string;
  readonly density?: 'mark' | 'summary' | 'working' | 'reading';
  readonly onReadMember?: (member: CoreCollectionMemberPreview) => void;
}
const EMPTY_MEMBERS = [] as const;
/** Ephemeral read projection only: all bodies consume the existing Core members
 * endpoint and project invalidation subscription. No new membership store.
 */
function CollectionReadView({ projectId, collectionId, density, presentation = 'compact', sizing = 'tile', folder, onReadMember, ...props }: CanonicalCollectionViewProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const [snapshot, setSnapshot] = useState<CoreCollectionMembersSnapshot>();
  const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (sizing === 'canvas') { setScale(1); return; }
    const element = host.current; if (!element) return;
    const measure = () => { const width = element.clientWidth; if (width > 0) setScale(Math.min(1,width/(presentation === 'compact' ? 250 : 248))); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, [presentation, sizing]);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    const queue = new SessionRefreshQueue(); const key = JSON.stringify([projectId, collectionId]);
    let live = true, visible = false, requestedRead = 0;
    const read = () => {
      if (!live || !visible) return;
      requestedRead += 1; setStatus('loading');
      void queue.refresh(key, async (signal) => {
        const sequence = requestedRead;
        return {value:await session.collections.members(projectId, collectionId, signal),sequence};
      }, ({value,sequence}) => { setSnapshot(value); setStatus(sequence === requestedRead ? 'ready' : 'loading'); }, () => setStatus('error'));
    };
    refreshRef.current = read;
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      visible = true; observer?.disconnect(); read();
    }, {rootMargin:'180px'}) : undefined;
    if (observer && host.current) observer.observe(host.current); else { visible = true; read(); }
    const unwatch = useCollaborationSessionStore.getState().watchProjectChanges(projectId, read);
    const unsubscribe = useLcosReferenceStore.subscribe((next, prev) => {
      if (next.projectId === projectId && next.bindingRefreshVersion !== prev.bindingRefreshVersion) read();
    });
    return () => { live = false; refreshRef.current = () => {}; queue.release(key); observer?.disconnect(); unwatch(); unsubscribe(); };
  }, [session, projectId, collectionId]);
  const refresh = useCallback(() => refreshRef.current(), []);
  const remove = useCallback((member: CoreCollectionMemberRef) => removeCollectionMember(session.collections, projectId, collectionId, member), [session, projectId, collectionId]);
  const members = useMemo(() => snapshot ? collectionPreviewMembers(snapshot) : EMPTY_MEMBERS, [snapshot]);
  const summary = status === 'error' ? snapshot ? '刷新失败 · 上次读取结果' : '成员读取失败'
    : snapshot ? members.length === 0 ? '空集合' : `${members.length} 个成员${status === 'loading' ? ' · 核对中' : ''}` : '正在读取成员…';
  return <div ref={host} className="lcos-canonical-collection" data-lcos-canonical-collection={collectionId}
    data-collection-presentation={presentation} data-collection-sizing={sizing} data-lcos-atlas-card={props.legacyAtlasKind} data-focused={props.selected || undefined} style={{height: sizing === 'canvas' ? '100%' : (presentation === 'compact' ? 146 : 244)*scale}} data-member-read-status={status} data-member-count={snapshot ? members.length : undefined}>
    <div className="lcos-canonical-collection-layout" style={{transform: sizing === 'canvas' ? undefined : `scale(${scale})`,transformOrigin:'top left'}}>
    {presentation === 'compact' ? <Gen1CollectionFace {...folder} title={snapshot?.collection.title ?? props.title}
      onActivate={props.onActivate} activationLabel={props.activationLabel} selected={props.selected ?? folder?.selected} action={props.action}
      count={snapshot ? members.length : undefined} compact={density === 'mark'}
      readError={status === 'error' ? summary : undefined} onRetry={refresh}
      sheets={members.slice(0, 3).map((member, index) =>
        <CollectionMemberPreview key={JSON.stringify([member.type,member.id])} projectId={projectId} member={member}
          client={session.artifacts} enabled={density !== 'mark'} presentation="gen1-sheet" sheetIndex={index}
          onRead={status === 'ready' && isReadableCollectionArtifact(member) && onReadMember
            ? () => onReadMember(member) : undefined}/>)}/>
      : <ContextCollectionView {...props} title={snapshot?.collection.title ?? props.title} atlasVisualKind="collection" organization="未指定"
      memberSummary={summary} memberLabels={undefined} members={undefined} onRemoveMember={undefined}
      previewUrl={undefined} secondaryPreviewUrl={undefined} hideEmptyPreviews
      primaryPreview={members[0] ? <CollectionMemberPreview projectId={projectId} member={members[0]} client={session.artifacts} enabled={density !== 'mark'} /> : undefined}
      secondaryPreview={members[1] ? <CollectionMemberPreview projectId={projectId} member={members[1]} client={session.artifacts} enabled={density !== 'mark' && density !== 'summary'} /> : undefined}
      memberControls={density === 'mark' ? undefined : <CollectionMembersMenu title={snapshot?.collection.title ?? props.title} members={members}
        status={status} refresh={refresh} remove={remove} />} />}
    </div>
  </div>;
}
export function CanonicalCollectionView(props: CanonicalCollectionViewProps): React.JSX.Element {
  return <CollectionReadView key={JSON.stringify([props.projectId,props.collectionId])} {...props} />;
}
