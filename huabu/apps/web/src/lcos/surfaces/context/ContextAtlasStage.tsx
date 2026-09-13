// ContextAtlasStage — Context 现场强表征（Figma atlas 5388:24294 / 集合 5333:96 六变体）。
// 数据：真实 warehouse（scene/conversation 为体块；事情/时间两种组织由真实 updatedAt/kind 驱动）。
// 进入：scene → 切换真实 worksite；conversation → 画布内定位（已投影）或打开会话（Wave 8）。
// 关闭：回到 Context worksite（camera 不动；approach/restore 动效 Wave 9）。


import { CoreAssemblyClient, HttpError } from '@local-creative-os/web-gen2';
import { ArrowRight, CalendarDays, Layers, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';


import { createLcosCoreSession } from '../../app/lcosCoreClient';
import { useLcosReferenceStore } from '../../lcosReferenceState';
import { LcosSurfaceFeedback } from '../../ui/LcosSurfaceFeedback';
import { lcosGlassStyle, lcosTokens } from '../../ui/lcosTokens';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';

export interface ContextAtlasStageProps {
  readonly projectId: string;
  readonly onClose: () => void;
  readonly onEnterSurface: (item: WarehouseItemV1) => void;
}

export function ContextAtlasStage({ projectId, onClose, onEnterSurface }: ContextAtlasStageProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const assembly = useMemo(() => new CoreAssemblyClient(session.http), [session]);
  const [items, setItems] = useState<readonly WarehouseItemV1[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const [organize, setOrganize] = useState<'things' | 'time'>('things');

  useEffect(() => {
    setState('loading');
    void assembly
      .getWarehouse(projectId)
      .then((snapshot) => {
        setItems(snapshot.items.filter((i) => i.kind === 'scene' || i.kind === 'conversation' || i.kind === 'collection' || i.kind === 'workflow'));
        setState('ready');
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(error instanceof HttpError ? error.message : String(error));
      });
  }, [projectId, assembly]);

  const groups = useMemo(() => {
    if (organize === 'things') {
      const byKind = new Map<string, WarehouseItemV1[]>();
      for (const item of items) {
        const key = item.kind;
        byKind.set(key, [...(byKind.get(key) ?? []), item]);
      }
      return Array.from(byKind.entries()).map(([kind, list]) => ({ key: `kind-${kind}`, label: kind, list }));
    }
    const sorted = [...items].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    return [{
      key: 'time-all',
      label: '最近更新',
      list: sorted,
    }];
  }, [items, organize]);

  const focusOnCanvas = (item: WarehouseItemV1): void => {
    // 会话已投影 → 画布定位；未投影走真实入场/会话入口
    const store = useLcosReferenceStore.getState();
    let found: string | undefined;
    for (const [nodeId, ref] of store.nodeEntityRefs) {
      if (ref.entityId === item.entityRef.id) {
        found = nodeId;
        break;
      }
    }
    if (found) {
      onEnterSurface(item); // 意见：scene 切换；conversation 定位由调用方处理
    }
    onClose();
  };

  return (
    <div data-lcos-context-atlas className="fixed inset-0 z-40 flex items-center justify-center p-12" style={{ background: 'rgba(250,250,250,0.86)', backdropFilter: 'blur(8px)' }}>
      <div className="flex h-full w-full max-w-[1100px] flex-col rounded-2xl p-6" style={lcosGlassStyle}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold" style={{ color: lcosTokens.color.text.light }}>Context Atlas</span>
            <span className="text-xs" style={{ color: lcosTokens.color.muted.light }}>集合/现场总览 · 同身份实体</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOrganize('things')}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium"
              style={organize === 'things' ? { background: lcosTokens.color.inverse.light, color: lcosTokens.color.textOnInverse.light } : { color: lcosTokens.color.muted.light }}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden /> 事情
            </button>
            <button
              type="button"
              onClick={() => setOrganize('time')}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium"
              style={organize === 'time' ? { background: lcosTokens.color.inverse.light, color: lcosTokens.color.textOnInverse.light } : { color: lcosTokens.color.muted.light }}
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> 时间
            </button>
            <button type="button" aria-label="关闭 Atlas" onClick={onClose} className="rounded-full p-1.5" style={{ color: lcosTokens.color.muted.light }}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {state === 'loading' && <div className="py-16"><LcosSurfaceFeedback presentation="loading" message="正在读取 Atlas…" /></div>}
        {state === 'error' && (
          <div className="py-16"><LcosSurfaceFeedback presentation="error" message={`Atlas 读取失败${errorDetail ? `（${errorDetail}）` : ''}`} /></div>
        )}

        {state === 'ready' && (
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
            {groups.map((group) => (
              <section key={group.key}>
                <h4 className="mb-2 text-xs font-medium uppercase tracking-wide" style={{ color: lcosTokens.color.muted.light }}>
                  {group.label}
                </h4>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {group.list.map((item) => (
                    <button
                      key={`${item.kind}:${item.entityRef.id}`}
                      type="button"
                      onClick={() => focusOnCanvas(item)}
                      className="flex flex-col gap-2 rounded-2xl p-4 text-left transition-transform hover:-translate-y-0.5"
                      style={{
                        minHeight: 150,
                        background: item.kind === 'conversation' ? 'rgba(32,32,32,0.05)' : `${lcosTokens.color.infoBg.light}`,
                        border: `1px solid ${lcosTokens.color.borderSubtle.light}`,
                        boxShadow: lcosTokens.shadow.default,
                      }}
                      data-lcos-atlas-card={item.kind}
                    >
                      <span className="truncate text-sm font-semibold" style={{ color: lcosTokens.color.text.light }}>
                        {item.title ?? '未命名'}
                      </span>
                      <span className="text-[10px]" style={{ color: lcosTokens.color.muted.light }}>
                        {item.kind}
                        {item.updatedAt ? ` · ${new Date(item.updatedAt).toLocaleDateString('zh-CN')}` : ''}
                      </span>
                      <span className="mt-auto flex items-center gap-1 text-xs" style={{ color: lcosTokens.color.info.light }}>
                        进入 <ArrowRight className="h-3 w-3" aria-hidden />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}