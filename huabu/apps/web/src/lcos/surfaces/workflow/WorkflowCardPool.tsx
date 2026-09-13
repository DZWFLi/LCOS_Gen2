// WorkflowCardPool — 材料/任务卡池（Figma 卡 5335:110 取用卡 7 状态；3:4 竖卡）。
// 真实数据：warehouse（artifact/conversation/workflow）；「取用」→ 加入 Composer 草稿（未发送）；
// 「打开/续接」真实动作 Wave 8（当前标注）。不把卡复制进 Main。


import { CoreAssemblyClient, HttpError } from '@local-creative-os/web-gen2';
import { PlusCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';


import { createLcosCoreSession } from '../../app/lcosCoreClient';
import { useLcosReferenceStore } from '../../lcosReferenceState';
import { LcosSurfaceFeedback } from '../../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../../ui/lcosTokens';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';

export function WorkflowCardPool({ projectId }: { readonly projectId: string }): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const assembly = useMemo(() => new CoreAssemblyClient(session.http), [session]);
  const [items, setItems] = useState<readonly WarehouseItemV1[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setState('loading');
    void assembly
      .getWarehouse(projectId)
      .then((snapshot) => {
        setItems(snapshot.items.filter((i) => i.kind === 'artifact' || i.kind === 'conversation' || i.kind === 'workflow'));
        setState('ready');
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(error instanceof HttpError ? error.message : String(error));
      });
  }, [projectId, assembly]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return items;
    return items.filter((item) => (item.title ?? '').toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div data-lcos-workflow-pool className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ background: lcosTokens.color.raised.light }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted.light }} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索材料 / 工作流"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: lcosTokens.color.text.light }}
          />
        </label>
      </div>

      {state === 'loading' && <div className="py-8"><LcosSurfaceFeedback presentation="loading" message="读取卡池…" /></div>}
      {state === 'error' && (
        <div className="py-8"><LcosSurfaceFeedback presentation="error" message={`卡池读取失败${errorDetail ? `（${errorDetail}）` : ''}`} /></div>
      )}
      {state === 'ready' && filtered.length === 0 && (
        <div className="py-8">
          <LcosSurfaceFeedback presentation="empty" message={query ? '没有匹配项' : '尚无工作流 · 从 Main/会话提炼（Wave 8）或取用下面材料'} />
        </div>
      )}

      {state === 'ready' && filtered.length > 0 && (
        <div className="grid max-h-[46vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((item) => (
            <div
              key={`${item.kind}:${item.entityRef.id}`}
              data-lcos-workflow-card
              className="flex flex-col overflow-hidden rounded-xl"
              style={{ aspectRatio: '3 / 4', border: `1px solid ${lcosTokens.color.borderSubtle.light}`, boxShadow: lcosTokens.shadow.default, background: lcosTokens.color.surface.light }}
            >
              <div className="flex flex-1 flex-col gap-2 p-3" style={{ background: item.kind === 'conversation' ? 'rgba(32,32,32,0.04)' : lcosTokens.color.raised.light }}>
                <span className="truncate text-xs font-semibold" style={{ color: lcosTokens.color.text.light }}>
                  {item.title ?? '未命名'}
                </span>
                <span className="mt-auto text-[9px]" style={{ color: lcosTokens.color.muted.light }}>
                  {item.kind} · 卡牌（3:4）
                </span>
              </div>
              <div className="flex items-center justify-between gap-1 border-t px-2 py-1.5" style={{ borderColor: lcosTokens.color.borderSubtle.light }}>
                <button
                  type="button"
                  data-lcos-card-take
                  onClick={() => useLcosReferenceStore.getState().addEntityToDraft({ entityType: item.kind, entityId: item.entityRef.id })}
                  className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium"
                  style={{ color: lcosTokens.color.text.light }}
                  title="取用 → 加入 Composer 草稿（未发送）"
                >
                  <PlusCircle className="h-3 w-3" aria-hidden /> 取用
                </button>
                <span className="text-[9px]" style={{ color: lcosTokens.color.muted.light }} title="打开/续接 Wave 8">
                  打开 · Wave 8
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}