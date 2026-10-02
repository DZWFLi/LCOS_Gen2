import { useCallback, useEffect, useRef, useState } from 'react';
import type { CoreCollectionMemberRef, CollectionMemberPreview } from '@local-creative-os/web-gen2';
import { Popover } from '@/components/Common/Popover';
import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';
import { LcosButton } from '../ui/primitives/LcosButton';
import type { CollectionMemberRemovalResult } from './collectionMemberActions';
import { COLLECTION_PREVIEW_LABELS } from './collectionPreviewMedia';

interface Props {
  readonly title: string;
  readonly members: readonly CollectionMemberPreview[];
  readonly status: 'loading' | 'ready' | 'error';
  readonly refresh: () => void;
  readonly remove: (member: CoreCollectionMemberRef) => Promise<CollectionMemberRemovalResult>;
}
/** One explicit, transient member list. No nested pseudo-canvas and no list of
 * tiny destructive buttons inside the folder title. Esc returns to its trigger.
 */
export function CollectionMembersMenu({ title, members, status, refresh, remove }: Props): React.JSX.Element {
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{x:number;y:number} | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [notice, setNotice] = useState('');
  const [unknown, setUnknown] = useState(false);
  const readingAfterUnknown = useRef(false);
  const close = useCallback(() => { setPosition(null); trigger.current?.focus({preventScroll:true}); }, []);
  useCloseOnEscape(position !== null, close);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Unknown removal cannot be retried until the same collection was re-read.
  useEffect(() => {
    if (!unknown) return;
    if (status === 'loading') readingAfterUnknown.current = true;
    if (status === 'ready' && readingAfterUnknown.current) {
      setUnknown(false); readingAfterUnknown.current = false; setNotice('已核对当前成员，未重发移除。');
    }
  }, [status, unknown]);
  const discard = async (member: CollectionMemberPreview) => {
    if (pending.current || unknown || status !== 'ready') return;
    pending.current = true; setBusy(`${member.type}:${member.id}`); setNotice('');
    let result: CollectionMemberRemovalResult = {proof:'unconfirmed',spatialPending:false};
    try { result = await remove({type:member.type,id:member.id}); } catch { /* unknown is shown below */ }
    finally { pending.current = false; }
    if (!mounted.current) return;
    setBusy(null);
    setUnknown(result.proof === 'unconfirmed'); readingAfterUnknown.current = false;
    setNotice(result.proof === 'unconfirmed' ? '移除结果尚未确认，请核对当前成员。不会自动重发。'
      : result.spatialPending ? '成员关系已更新，画布显示尚未同步；原材料保留。'
        : result.proof === 'readback' ? '已核对：当前已不在集合，没有重发移除。' : '已移出集合，原材料保留。');
    refresh();
  };
  return <div className="lcos-collection-members-trigger" onPointerDown={(e) => e.stopPropagation()}
    onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
    <LcosButton ref={trigger} appearance="oreo" variant="ghost" size="sm" data-lcos-collection-members-open
      aria-haspopup="dialog" aria-expanded={position !== null} onClick={() => {
        if (position) { close(); return; }
        const rect = trigger.current?.getBoundingClientRect();
        if (rect) setPosition({x:rect.left,y:rect.bottom + 6});
      }}>{status === 'error' ? '核对成员' : '查看成员'}</LcosButton>
    {position ? <Popover position={position} onDismiss={close} dismissOnEscape={false} className="lcos-collection-members-popover">
      <section role="dialog" aria-label={`${title}的成员`} data-lcos-collection-members-panel onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <header><strong>{title}</strong><LcosButton appearance="oreo" size="sm" variant="ghost" onClick={close} aria-label="收起成员列表">收起</LcosButton></header>
        <p className="lcos-collection-members-hint">这里只移出集合，不删除原材料，也不影响其他集合。</p>
        {status === 'error' ? <p role="alert">成员刷新失败。下方如有内容，为上次读取结果。</p> : status === 'loading' ? <p role="status">正在核对成员…</p> : null}
        <div className="lcos-collection-members-list">
          {members.map((member) => <div key={`${member.type}:${member.id}`} data-lcos-member-row={`${member.type}:${member.id}`}>
            <span><strong title={member.label}>{member.label}</strong><small>{COLLECTION_PREVIEW_LABELS[member.kind]}
              {member.revisionId ? ' · 当前版本' : ''}{member.archived ? ' · 已归档' : ''}
              {member.availability !== 'available' ? ' · 暂不可预览' : ''}</small></span>
            <LcosButton appearance="oreo" variant="ghost" size="sm" disabled={busy !== null || status !== 'ready' || unknown}
              aria-label={`从集合移除 ${member.label}`} onClick={() => { void discard(member); }}>
              {busy === `${member.type}:${member.id}` ? '移出中…' : '移出'}</LcosButton>
          </div>)}
          {status === 'ready' && members.length === 0 ? <p>集合里还没有成员。</p> : null}
        </div>
        {notice ? <p role="status" data-lcos-collection-member-notice>{notice}</p> : null}
        <footer><span>{status === 'ready' ? `${members.length} 个成员` : '以核对结果为准'}</span>
          <LcosButton appearance="oreo" variant="secondary" size="sm" disabled={status === 'loading' || busy !== null} onClick={refresh}>核对成员</LcosButton></footer>
      </section>
    </Popover> : null}
  </div>;
}
