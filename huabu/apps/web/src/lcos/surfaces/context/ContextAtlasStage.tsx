// ContextAtlasStage — Context 现场强表征（Figma atlas 5388:24294 / 集合 5333:96 六变体）。
// 数据：真实 warehouse；事情/时间是表征轴，不把实体 kind 当组织语义。
// 进入：有明确 Workspace 映射的集合进入子现场；普通实体仅对已有投影发定位请求。
// 关闭：回到 Context worksite（camera 不动；approach/restore 动效 Wave 9）。


import { CoreAssemblyClient, HttpError } from '@local-creative-os/web-gen2';
import { ArrowRight, CalendarDays, Layers, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { DropdownMenu, DropdownMenuItem } from '@/components/Common/DropdownMenu';
import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';

import { buildAtlasGroups, canAtlasLocate, isAtlasItem } from './contextAtlasSemantics';
import { createLcosCoreSession } from '../../app/lcosCoreClient';
import { useLcosReferenceStore } from '../../lcosReferenceState';
import { workspaceTargetsForItem } from '../../navigation/workspaceTargets';
import { LcosCollectionSurface } from '../../ui/families';
import { LcosSurfaceFeedback } from '../../ui/LcosSurfaceFeedback';
import { lcosGlassStyle, lcosTokens } from '../../ui/lcosTokens';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';

export interface ContextAtlasStageProps {
  readonly projectId: string;
  readonly workspaces: readonly Workspace[];
  readonly onClose: () => void;
  readonly onEnterSurface: (item: WarehouseItemV1, workspace?: Workspace) => boolean;
}

export function ContextAtlasStage({ projectId, workspaces, onClose, onEnterSurface }: ContextAtlasStageProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const assembly = useMemo(() => new CoreAssemblyClient(session.http), [session]);
  const [items, setItems] = useState<readonly WarehouseItemV1[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const requestSequence = useRef(0);
  useCloseOnEscape(true, onClose);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const controller = new AbortController();
    let active = true;
    // A project switch must not leave the previous project's cards visible
    // while the new warehouse is loading (or after it fails).
    setItems([]);
    setErrorDetail(undefined);
    setState('loading');
    void assembly
      .getWarehouse(projectId, controller.signal)
      .then((snapshot) => {
        if (!active || sequence !== requestSequence.current) return;
        setItems(snapshot.items.filter(isAtlasItem));
        setState('ready');
      })
      .catch((error: unknown) => {
        if (!active || sequence !== requestSequence.current || controller.signal.aborted) return;
        setState('error');
        setErrorDetail(error instanceof HttpError ? error.message : String(error));
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, assembly]);

  const groups = useMemo(() => buildAtlasGroups(items), [items]);

  const focusOnCanvas = (item: WarehouseItemV1): boolean => onEnterSurface(item);
  const projected = (item: WarehouseItemV1): boolean => canAtlasLocate(item, useLcosReferenceStore.getState().nodeEntityRefs.values());

  const kindLabel = (item: WarehouseItemV1): string => item.kind === 'scene' ? '现场' : item.kind === 'collection' ? '集合' : 'Context';

  return (
    <div data-lcos-context-atlas className="fixed inset-0 z-40 flex items-center justify-center p-12" style={{ background: 'rgba(250,250,250,0.86)', backdropFilter: 'blur(8px)' }}>
      <div className="flex h-full w-full max-w-[1180px] flex-col rounded-2xl p-7" style={{ ...lcosGlassStyle, background: 'rgba(255,255,255,0.72)' }}>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold" style={{ color: lcosTokens.color.text }}>Context Atlas</span>
            <span className="text-xs" style={{ color: lcosTokens.color.muted }}>Context 集合光幕 · 同身份实体</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="当前数据没有明确的事情组织字段"
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ color: lcosTokens.color.muted, opacity: 0.55, cursor: 'not-allowed' }}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden /> 事情（不可用）
            </button>
            <button
              type="button"
              disabled
              aria-disabled="true"
              title="当前数据没有明确的时间组织字段"
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium"
              style={{ color: lcosTokens.color.muted, opacity: 0.55, cursor: 'not-allowed' }}
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden /> 时间（不可用）
            </button>
            <button type="button" aria-label="关闭 Atlas" onClick={onClose} className="rounded-full p-1.5" style={{ color: lcosTokens.color.muted }}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {state === 'loading' && <div className="py-16"><LcosSurfaceFeedback presentation="loading" message="正在读取 Atlas…" /></div>}
        {state === 'error' && (
          <div className="py-16"><LcosSurfaceFeedback presentation="error" message={`Atlas 读取失败${errorDetail ? `（${errorDetail}）` : ''}`} /></div>
        )}

        {state === 'ready' && (
          <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto">
            {groups.map((group) => (
              <section key={group.key}>
                  <h4 className="mb-4 text-xs font-medium tracking-wide" style={{ color: lcosTokens.color.muted }}>
                  {group.label}
                </h4>
                {/* Figma atlas：体块 248×244、列间 32（gap-8）；体块语言 = 族 Collection 5333:96 */}
                <div className="flex flex-wrap gap-8">
                  {group.list.map((item) => {
                    const childTargets = workspaceTargetsForItem(item, workspaces);
                    return (
                      <LcosCollectionSurface
                        key={`${item.kind}:${item.entityRef.id}`}
                        organize="未指定"
                        rendition="总览"
                        title={item.title ?? '未命名'}
                        meta={`${kindLabel(item)}${item.updatedAt ? ` · 更新时间 ${new Date(item.updatedAt).toLocaleDateString('zh-CN')}` : ''}`}
                        legacyAtlasKind={item.kind}
                        renderAs="div"
                      >
                        <span className="mt-auto flex items-center gap-2 text-xs" style={{ color: projected(item) || childTargets.length > 0 ? lcosTokens.color.info : lcosTokens.color.muted }}>
                          {childTargets.length === 1 ? (
                            <button type="button" disabled={!childTargets[0]?.canvasId} className="flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { onEnterSurface(item, childTargets[0]); }}>
                              进入现场 <ArrowRight className="h-3 w-3" aria-hidden />
                            </button>
                          ) : childTargets.length > 1 ? (
                            <DropdownMenu trigger={<button type="button" className="flex items-center gap-1">选择现场 <ArrowRight className="h-3 w-3" aria-hidden /></button>}>
                              {childTargets.map((workspace) => (
                                <DropdownMenuItem key={String(workspace.id)} disabled={!workspace.canvasId} onClick={() => { onEnterSurface(item, workspace); }}>
                                  {workspace.name}{workspace.canvasId ? '' : ' · 画布尚未就绪'}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenu>
                          ) : projected(item) ? <button type="button" className="flex items-center gap-1" onClick={() => { focusOnCanvas(item); }}>定位 <ArrowRight className="h-3 w-3" aria-hidden /></button> : item.kind === 'scene' ? '暂无可进入现场' : '当前现场不可用'}
                        </span>
                      </LcosCollectionSurface>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
