// WorkflowCardPool — 材料/任务卡池（Figma 卡 5335:110 取用卡 7 状态；3:4 竖卡）。
// 真实数据：warehouse 中真正的 workflow；普通 artifact/conversation 走 Assembly/会话入口，不伪装成任务卡。
// 「打开/续接」真实动作 Wave 8（当前标注）。不把卡复制进 Main。


import { CoreAssemblyClient, HttpError } from '@local-creative-os/web-gen2';
import { PlusCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';


import { isWorkflowCardItem } from './workflowCardSemantics';
import { createLcosCoreSession } from '../../app/lcosCoreClient';
import { useLcosReferenceStore } from '../../lcosReferenceState';
import { sameEntityRef } from '../../referenceBridge';
import { LcosTaskCard, type LcosTaskCardState } from '../../ui/families';
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
  // 草稿引用 = 真实 presentation state（Selection ≠ Reference）；用于卡面「草稿中」
  const draftRefs = useLcosReferenceStore((s) => s.draft.orderedEntityRefs);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState('loading');
    void assembly
      .getWarehouse(projectId, controller.signal)
      .then((snapshot) => {
        if (!active || controller.signal.aborted) return;
        setItems(snapshot.items.filter(isWorkflowCardItem));
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setState('error');
        setErrorDetail(error instanceof HttpError ? error.message : String(error));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, assembly]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return items;
    return items.filter((item) => (item.title ?? '').toLowerCase().includes(q));
  }, [items, query]);

  /**
   * 7 状态里生产可达的三种（其余 悬停/键盘焦点 由 CSS 表达；预览/已选目标 归属 R5）：
   * 草稿中 = 该实体已在 Composer 草稿；不可用 = 没有可引用的实体身份；其余为静息。
   */
  const cardState = (item: WarehouseItemV1): LcosTaskCardState => {
    const entityId = item.entityRef?.id;
    if (!entityId) return '不可用';
    const ref = { entityType: item.kind, entityId };
    return draftRefs.some((x) => sameEntityRef(x, ref)) ? '草稿中' : '静息';
  };

  return (
    <div data-lcos-workflow-pool className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <label className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2" style={{ background: lcosTokens.color.raised }}>
          <Search className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted }} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索工作流"
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: lcosTokens.color.text }}
          />
        </label>
      </div>

      {state === 'loading' && <div className="py-8"><LcosSurfaceFeedback presentation="loading" message="读取卡池…" /></div>}
      {state === 'error' && (
        <div className="py-8"><LcosSurfaceFeedback presentation="error" message={`卡池读取失败${errorDetail ? `（${errorDetail}）` : ''}`} /></div>
      )}
      {state === 'ready' && filtered.length === 0 && (
        <div className="py-8">
          <LcosSurfaceFeedback presentation="empty" message={query ? '没有匹配项' : '还没有工作流卡片'} />
        </div>
      )}

      {state === 'ready' && filtered.length > 0 && (
        <div className="flex max-h-[46vh] flex-wrap gap-3 overflow-y-auto pr-1">
          {filtered.map((item) => (
            <LcosTaskCard
              key={`${item.kind}:${item.entityRef.id}`}
              state={cardState(item)}
              title={item.title ?? '未命名'}
              meta="工作流 · 卡牌（3:4）"
              legacyWorkflowKind="workflow"
              footer={
                <>
                  <button
                    type="button"
                    data-lcos-card-take
                    onClick={() => useLcosReferenceStore.getState().addEntityToDraft({ entityType: item.kind, entityId: item.entityRef.id })}
                    className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium"
                    style={{ color: lcosTokens.color.text }}
                    title="取用 → 加入 Composer 草稿（未发送）"
                  >
                    <PlusCircle className="h-3 w-3" aria-hidden /> 取用
                  </button>
                  <span className="text-[9px]" style={{ color: lcosTokens.color.muted }} title="打开/续接尚未接入">
                    打开（尚未接入）
                  </span>
                </>
              }
            >
              <span data-lcos-card-preview className="text-[10px] opacity-60">
                工作流装备
              </span>
            </LcosTaskCard>
          ))}
        </div>
      )}
    </div>
  );
}
