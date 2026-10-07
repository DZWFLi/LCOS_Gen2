import { useEffect, useMemo, useState } from 'react';

import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosButton } from '../ui/primitives/LcosButton';
import { lcosTokens } from '../ui/lcosTokens';

type MemberRef = {
  readonly type: 'artifact' | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run';
  readonly id: string;
};

type MemberRow = {
  readonly ref: MemberRef;
  readonly label: string;
  readonly availability?: string;
};

const fallbackLabel: Readonly<Record<MemberRef['type'], string>> = {
  artifact: '材料',
  note: '笔记',
  collection: '集合',
  scope: '空间',
  workspace: '工作现场',
  conversation: '会话',
  run: '任务',
};

/**
 * Read-only collection body used by Railway spatial bookmarks.
 * Canonical membership stays in CoreCollectionClient; this body owns no second
 * collection, layout, camera, or membership truth.
 */
export function CollectionWorkViewBody({
  projectId,
  collectionId,
}: {
  readonly projectId: string;
  readonly collectionId?: string;
}): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const [rows, setRows] = useState<readonly MemberRow[]>([]);
  const [title, setTitle] = useState('集合');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!collectionId) {
      setStatus('error');
      setError('集合身份缺失。');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    setError(undefined);
    void session.collections.members(projectId, collectionId, controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        setTitle(snapshot.collection.title);
        const previews = new Map(
          (snapshot.previews ?? []).map((preview) => [
            JSON.stringify([preview.type, preview.id]),
            preview,
          ]),
        );
        setRows(snapshot.members.map(({ memberRef }) => {
          const preview = previews.get(JSON.stringify([memberRef.type, memberRef.id]));
          return {
            ref: memberRef,
            label: preview?.label?.trim() || fallbackLabel[memberRef.type],
            ...(preview?.availability === undefined ? {} : { availability: preview.availability }),
          };
        }));
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setStatus('error');
        setError(reason instanceof Error ? reason.message : '集合读取失败。');
      });
    return () => controller.abort();
  }, [collectionId, projectId, session]);

  const open = (row: MemberRow): void => {
    const shell = useLcosShellStore.getState();
    if (shell.projectId !== projectId) return;
    switch (row.ref.type) {
      case 'artifact':
        shell.openReader(`阅读 · ${row.label}`, row.ref.id);
        return;
      case 'conversation':
        shell.openWindow('conversation', `会话 · ${row.label}`, row.ref.id);
        return;
      case 'run':
        shell.openWindow('run-review', `任务 · ${row.label}`, row.ref.id);
        return;
      case 'collection':
        shell.openWindow('collection', `集合 · ${row.label}`, row.ref.id);
        return;
      default:
        return;
    }
  };

  return (
    <section
      data-lcos-collection-work-view={collectionId}
      className="flex h-full min-h-0 flex-col"
      style={{ background: lcosTokens.color.canvas, color: lcosTokens.color.text }}
    >
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{ borderColor: lcosTokens.color.borderSubtle }}>
        <div className="min-w-0">
          <strong className="block truncate text-sm">{title}</strong>
          <small style={{ color: lcosTokens.color.muted }}>
            {status === 'ready' ? `${rows.length} 个成员 · Core 集合` : '读取 Core 集合…'}
          </small>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {status === 'loading' && <p role="status" className="p-3 text-sm">正在读取集合内容…</p>}
        {status === 'error' && <p role="status" className="p-3 text-sm" style={{ color: lcosTokens.color.danger }}>{error}</p>}
        {status === 'ready' && rows.length === 0 && <p role="status" className="p-3 text-sm" style={{ color: lcosTokens.color.muted }}>这个集合暂时为空。</p>}
        {status === 'ready' && rows.map((row) => {
          const openable = row.ref.type === 'artifact' || row.ref.type === 'conversation'
            || row.ref.type === 'run' || row.ref.type === 'collection';
          return (
            <div key={`${row.ref.type}:${row.ref.id}`}
              data-lcos-collection-member={row.ref.type}
              className="mb-2 flex min-h-12 items-center justify-between gap-3 rounded-xl px-3 py-2"
              style={{ background: lcosTokens.color.surface }}>
              <div className="min-w-0">
                <strong className="block truncate text-sm">{row.label}</strong>
                <small style={{ color: lcosTokens.color.muted }}>{fallbackLabel[row.ref.type]}{row.availability ? ` · ${row.availability}` : ''}</small>
              </div>
              {openable && <LcosButton appearance="oreo" variant="secondary" onClick={() => open(row)}>打开</LcosButton>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
