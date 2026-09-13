// AssemblyBody — 项目共享仓库（Figma Assembly/瀑布流；真实 Core warehouse read model）。
// 内容优先：瀑布流卡片 + 搜索/类型筛选；动作：阅读（Reader）、加入 Composer 草稿、
// 投放 Main（统一 apply 通道，逐项回执 partial 如实展示）。
// Assembly 不拥有第二 Project truth——只读 warehouse + 既有 apply。


import {
  CoreAssemblyClient,
  HttpError,
} from '@local-creative-os/web-gen2';
import { BookOpen, PlusCircle, Search, Send } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';


import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { LcosSurfaceFeedback } from '../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../ui/lcosTokens';

import type { AssemblyApplyResultV1, WarehouseItemV1, WarehouseEntityKindV1 } from '@local-creative-os/contracts';

const KIND_LABEL: Readonly<Record<WarehouseEntityKindV1, string>> = {
  artifact: '材料',
  note: '便签',
  conversation: '会话',
  resource: '资源',
  context: '上下文',
  workflow: '工作流',
  scene: '现场',
  collection: '集合',
};

export function AssemblyBody({ projectId }: { readonly projectId: string }): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const assembly = useMemo(() => new CoreAssemblyClient(session.http), [session]);
  const openWindow = useLcosShellStore((s) => s.openWindow);

  const [items, setItems] = useState<readonly WarehouseItemV1[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [applyResult, setApplyResult] = useState<AssemblyApplyResultV1 | null>(null);
  const [applying, setApplying] = useState(false);

  const load = (): void => {
    setState('loading');
    void assembly
      .getWarehouse(projectId)
      .then((snapshot) => {
        setItems(snapshot.items);
        setState('ready');
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(error instanceof HttpError ? error.message : String(error));
      });
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return items;
    return items.filter((item) => (item.title ?? '').toLowerCase().includes(q));
  }, [items, query]);

  const refOf = (item: WarehouseItemV1): { entityType: string; entityId: string } => ({
    entityType: item.kind,
    entityId: item.entityRef.id,
  });

  const addToComposer = (item: WarehouseItemV1): void => {
    // 加入统一 Composer 草稿（reference store draft；Selection≠Reference）
    useLcosReferenceStore.getState().addEntityToDraft(refOf(item));
  };

  const dropToMain = (item: WarehouseItemV1): void => {
    setApplying(true);
    setApplyResult(null);
    void assembly
      .apply(projectId, {
        schemaVersion: 1,
        projectId,
        sourceRefs: [{ kind: 'artifactView', id: item.entityRef.id }],
        targetRef: { kind: 'main' },
      })
      .then((result) => setApplyResult(result))
      .catch((error: unknown) => {
        setApplyResult({
          schemaVersion: 1,
          projectId,
          results: [{ sourceRef: { kind: 'artifactView', id: item.entityRef.id }, status: 'failed', channel: 'error', message: error instanceof Error ? error.message : String(error) }],
          allApplied: false,
        });
      })
      .finally(() => setApplying(false));
  };

  return (
    <div data-lcos-assembly className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ background: lcosTokens.color.raised.light }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted.light }} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索仓库（当前页过滤）"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: lcosTokens.color.text.light }}
          />
        </label>
        <span className="text-xs" style={{ color: lcosTokens.color.muted.light }}>
          {items.length} 项
        </span>
      </div>

      {state === 'loading' && (
        <div className="py-10"><LcosSurfaceFeedback presentation="loading" message="正在读取项目仓库…" /></div>
      )}
      {state === 'error' && (
        <div className="py-10">
          <LcosSurfaceFeedback presentation="error" message={`仓库读取失败${errorDetail ? `（${errorDetail}）` : ''}`} onAction={load} />
        </div>
      )}
      {state === 'ready' && filtered.length === 0 && (
        <div className="py-10"><LcosSurfaceFeedback presentation="empty" message="仓库还没有内容" /></div>
      )}

      {state === 'ready' && filtered.length > 0 && (
        <div className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
          {filtered.map((item) => (
            <div
              key={`${item.kind}:${item.entityRef.id}`}
              data-lcos-assembly-item={item.entityRef.id}
              data-lcos-assembly-item-kind={item.kind}
              className="flex flex-col gap-2 rounded-xl p-3"
              style={{ background: lcosTokens.color.surface.light, border: `1px solid ${lcosTokens.color.borderSubtle.light}`, boxShadow: lcosTokens.shadow.default }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium" style={{ color: lcosTokens.color.text.light }}>
                  {item.title ?? '未命名'}
                </span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px]"
                  style={{ background: lcosTokens.color.raised.light, color: lcosTokens.color.muted.light }}
                  data-lcos-assembly-kind={item.kind}
                >
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[10px]" style={{ color: lcosTokens.color.muted.light }}>
                {item.visualFamily ? <span>{item.visualFamily}</span> : null}
                {item.usageCount > 0 ? <span>· 使用 {item.usageCount}</span> : null}
                {item.provenance ? <span>· {item.provenance.origin}</span> : null}
              </div>
              <div className="mt-auto flex items-center gap-1">
                <button type="button" onClick={() => addToComposer(item)} title="加入 Composer 草稿" data-lcos-assembly-add className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs" style={{ color: lcosTokens.color.text.light }} >
                  <PlusCircle className="h-3.5 w-3.5" aria-hidden /> 草稿
                </button>
                <button
                  type="button"
                  onClick={() => openWindow('reader', `阅读 · ${item.title ?? '材料'}`, item.entityRef.id)}
                  title="阅读"
                  className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs"
                  style={{ color: lcosTokens.color.info.light }}
                >
                  <BookOpen className="h-3.5 w-3.5" aria-hidden /> 阅读
                </button>
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => dropToMain(item)}
                  title="投放 Main（真实 apply 回执）"
                  data-lcos-assembly-drop
                  className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium"
                  style={{ background: lcosTokens.color.inverse.light, color: lcosTokens.color.textOnInverse.light, minHeight: 32 }}
                >
                  <Send className="h-3.5 w-3.5" aria-hidden /> 投放 Main
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {applyResult && (
        <div data-lcos-assembly-receipt className="rounded-xl px-3 py-2" style={{ background: applyResult.allApplied ? 'rgba(84,116,100,0.08)' : 'rgba(194,91,78,0.08)', color: applyResult.allApplied ? lcosTokens.color.accent.light : lcosTokens.color.danger }}>
          {applyResult.results.map((r) => (
            <div key={`${r.sourceRef.kind}:${r.sourceRef.id}`} className="flex items-center justify-between gap-2 py-0.5 text-xs">
              <span>
                {r.status === 'applied' ? '已投放' : r.status === 'skipped' ? '跳过' : '失败'} · {r.channel}
                {r.message ? ` · ${r.message}` : ''}
              </span>
              {r.changeSetId && <span className="shrink-0 text-[10px] opacity-70">changeSet {r.changeSetId.slice(0, 8)}</span>}
            </div>
          ))}
          {applyResult.allApplied ? '全部成功' : '部分失败 · 未全部投放（fail-close 语义）'}
        </div>
      )}
    </div>
  );
}