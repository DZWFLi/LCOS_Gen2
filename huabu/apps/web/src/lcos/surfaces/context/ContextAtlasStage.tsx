// ContextAtlasStage — Context 现场强表征（Figma atlas 5388:24294 / 集合 5333:96 六变体）。
// 数据：真实 warehouse；事情/时间是表征轴，不把实体 kind 当组织语义。
// 进入：有明确 Workspace 映射的集合进入子现场；普通实体仅对已有投影发定位请求。
// 关闭：回到 Context worksite（camera 不动；approach/restore 动效 Wave 9）。


import { CoreAssemblyClient } from '@local-creative-os/web-gen2';
import { useIsPresent } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

import { DropdownMenu, DropdownMenuItem } from '@/components/Common/DropdownMenu';
import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';
import { useCanvasAttentionStore } from '@/store/canvasAttentionStore';

import { buildAtlasGroups, canAtlasLocate, isAtlasItem, isCanonicalCollectionItem } from './contextAtlasSemantics';
import { createLcosCoreSession } from '../../app/lcosCoreClient';
import { useLcosReferenceStore } from '../../lcosReferenceState';
import useCanvasStore from '@/store/canvasStore';
import { waitForProjectedEntity } from '../../navigation/waitForProjectedEntity';
import { useLcosShellStore } from '../../shell/lcosShellStore';
import { childSurfaceForItem, workspaceTargetsForItem } from '../../navigation/workspaceTargets';
import { useWarehouseBrowse } from '../../professional/useWarehouseBrowse';
import atlasCloseIcon from '../../ui/context/assets/atlas-close.svg';
import { ContextAtlasView } from '../../ui/context/ContextAtlasView';
import { ContextCollectionActionGlyph } from '../../ui/context/ContextCollectionFace';
import { CanonicalCollectionView } from '../../nodes/CanonicalCollectionView';
import { ContextCollectionView } from '../../ui/context/ContextCollectionView';
import { LcosSurfaceFeedback } from '../../ui/LcosSurfaceFeedback';
import { lcosTokens } from '../../ui/lcosTokens';
import '../../ui/context/context-spatial.css';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';

export interface ContextAtlasStageProps {
  /** Context keeps its worksite Atlas semantics; Main is a canonical Collection-only projection. */
  readonly mode?: 'context' | 'main-collections';
  readonly projectId: string;
  readonly workspaces: readonly Workspace[];
  /** Context identity comes from the active workspace's canonical scopeId. */
  readonly currentContextId?: string;
  readonly onClose: () => void;
  readonly onEnterSurface: (item: WarehouseItemV1, workspace?: Workspace) => boolean | Promise<boolean>;
}

export function ContextAtlasStage({ projectId, workspaces, currentContextId, mode = 'context', onClose, onEnterSurface }: ContextAtlasStageProps): React.JSX.Element {
  const session = useMemo(() => createLcosCoreSession(), []);
  const assembly = useMemo(() => new CoreAssemblyClient(session.http), [session]);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createMessage, setCreateMessage] = useState('');
  const [focusedItemRef, setFocusedItemRef] = useState<string | null>(null);
  const warehouse = useWarehouseBrowse(assembly, projectId, query, mode === 'main-collections' ? 'collection' : 'context');
  const items = useMemo(() => warehouse.items.filter(mode === 'main-collections' ? isCanonicalCollectionItem : isAtlasItem), [mode, warehouse.items]);
  const { state, error: errorDetail } = warehouse;
  const present = useIsPresent();
  useCloseOnEscape(present, onClose);
  useEffect(() => { useCanvasAttentionStore.getState().setCanvasEngaged(false); }, []);

  const groups = useMemo(() => buildAtlasGroups(items), [items]);
  const focusedItem = items.find((item) => `${item.entityRef.type}:${item.entityRef.id}` === focusedItemRef);

  const focusOnCanvas = (item: WarehouseItemV1): boolean | Promise<boolean> => onEnterSurface(item);
  const projected = (item: WarehouseItemV1): boolean => canAtlasLocate(item, useLcosReferenceStore.getState().nodeEntityRefs.values());

  const createCanonicalCollection = async (): Promise<void> => {
    const title = createTitle.trim();
    if (!title) { setCreateMessage('先填写集合名称。'); return; }
    setCreateBusy(true); setCreateMessage('');
    try {
      const { collection } = await session.collections.create(projectId, title);
      const canvasId = useCanvasStore.getState().canvasId;
      if (!canvasId) { setCreateMessage('集合已创建；当前现场没有可定位画布。'); return; }
      useLcosReferenceStore.getState().requestNodeBindingRefresh();
      const nodeId = await waitForProjectedEntity({ projectId, canvasId, entityType: 'collection', entityId: collection.id, timeoutMs: 8000 });
      if (!nodeId) { setCreateMessage('集合已创建，但画布投影尚未确认；可稍后刷新现场再定位。'); return; }
      const surface = useLcosShellStore.getState().activeSurface;
      useLcosShellStore.getState().requestLocate({ reqId: crypto.randomUUID(), surface, canvasId, nodeId, status: 'projected', preserveSelection: true });
      onClose();
    } catch (error) {
      setCreateMessage(`新建失败：${error instanceof Error ? error.message : 'Core 请求未成功'}`);
    } finally { setCreateBusy(false); }
  };

  const kindLabel = (): string => mode === 'main-collections' ? '集合' : '上下文集合';
  const noun = mode === 'main-collections' ? '集合' : '上下文集合';
  const evidenceLabel = (item: WarehouseItemV1): string => {
    const facts = [
      item.relationHint && item.relationHint.neighborCount > 0 ? `关联 ${item.relationHint.neighborCount} 项` : undefined,
      item.provenance?.origin ? `来源 ${({ 'run-return': '运行结果', import: '导入', capture: '采集', unknown: '未注明' } as const)[item.provenance.origin]}` : undefined,
      item.updatedAt ? `更新于 ${item.updatedAt.slice(0, 10)}` : undefined,
    ].filter((fact): fact is string => fact !== undefined);
    return facts.length > 0 ? `${kindLabel()} · ${facts.join(' · ')}` : kindLabel();
  };

  return (
    <ContextAtlasView ariaLabel={mode === 'main-collections' ? '集合总览' : '上下文集合'} onClose={onClose} header={<>
          <label className="lcos-atlas-search"><input type="search" aria-label={`搜索${noun}`} placeholder={`搜索${noun}`} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <span role="status" aria-live="polite">{items.length} 个{noun}</span>
          {mode === 'main-collections' && <button type="button" className="lcos-atlas-create-toggle" aria-expanded={createOpen}
            onClick={() => { setCreateOpen((open) => !open); setCreateMessage(''); }}>新建集合</button>}
          <button type="button" aria-label="收回集合总览" onClick={onClose} className="lcos-atlas-close">
            <img src={atlasCloseIcon} width={22} height={22} alt="" draggable={false} />
          </button>
        </>}
    >
        {mode === 'main-collections' && createOpen && <form className="lcos-atlas-create" onSubmit={(event) => { event.preventDefault(); void createCanonicalCollection(); }}>
          <input aria-label="集合名称" autoFocus maxLength={200} value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} placeholder="集合名称" />
          <button type="submit" disabled={createBusy}>{createBusy ? '创建并定位…' : '创建并定位'}</button>
          <button type="button" disabled={createBusy} onClick={() => setCreateOpen(false)}>取消</button>
          {createMessage && <span role="status" aria-live="polite">{createMessage}</span>}
        </form>}
        {state === 'loading' && items.length === 0 && <div className="py-16"><LcosSurfaceFeedback presentation="loading" message={`正在读取${noun}…`} /></div>}
        {state === 'error' && items.length === 0 && (
          <div className="py-16"><LcosSurfaceFeedback presentation="error" message={`${noun}读取失败${errorDetail ? `（${errorDetail}）` : ''}`} onAction={warehouse.retry} actionLabel="重试" /></div>
        )}
        {state === 'ready' && items.length === 0 ? <LcosSurfaceFeedback presentation="empty" message={query.trim() ? `没有匹配的${noun}` : `还没有${noun}`} /> : null}
        {items.length > 0 && (
          <>
          {focusedItem && <div className="lcos-atlas-focus-summary" role="status" aria-live="polite">
            <strong>已聚焦：{focusedItem.title || '未命名'}</strong>
            <span>聚焦只保留当前选中；用卡片右下角的动作定位画布或进入子现场。</span>
          </div>}
          <div className="lcos-atlas-grid">
            {groups.map((group) => (
              <section key={group.key} style={{ display: 'contents' }}>
                <div style={{ display: 'contents' }}>
                  {group.list.map((item) => {
                    const childTargets = mode === 'context' ? workspaceTargetsForItem(item, workspaces) : [];
                    const soleTarget = childTargets.length === 1 ? childTargets[0] : undefined;
                    const targetReason = (workspace: Workspace): string | undefined => !workspace.canvasId
                      ? '现场画布尚未就绪' : childSurfaceForItem(item, workspace) === undefined ? '现场类型尚未确认' : undefined;
                    const hasDestination = childTargets.some((workspace) => targetReason(workspace) === undefined);
                    const hasProjection = projected(item);
                    const activate = (): void => { setFocusedItemRef(`${item.entityRef.type}:${item.entityRef.id}`); };
                    const CollectionView = mode === 'main-collections' ? CanonicalCollectionView : ContextCollectionView;
                    return (
                      <CollectionView projectId={projectId} collectionId={item.entityRef.id}
                        key={`${item.kind}:${item.entityRef.id}`}
                        title={item.title ?? '未命名'}
                        atlasVisualKind={mode === 'main-collections' ? 'collection' : 'context'}
                        active={mode === 'context' && item.entityRef.id === currentContextId}
                        selected={focusedItemRef === `${item.entityRef.type}:${item.entityRef.id}`}
                        sourceLabel={kindLabel()}
                        memberSummary={evidenceLabel(item)}
                        onActivate={activate}
                        activationLabel={`聚焦 · ${item.title ?? '未命名'}`}
                        {...(item.previewRef === undefined ? {} : { previewUrl: item.previewRef })}
                        legacyAtlasKind={item.kind}
                        action={
                          <span style={{ color: hasProjection || hasDestination ? lcosTokens.color.info : lcosTokens.color.muted }}>
                            {childTargets.length === 1 ? (
                              <button type="button" aria-label={`进入 ${item.title ?? '集合'} 现场${soleTarget && targetReason(soleTarget) ? ` · ${targetReason(soleTarget)}` : ''}`} title={soleTarget && targetReason(soleTarget) ? targetReason(soleTarget) : `进入 ${item.title ?? '集合'} 现场`} disabled={soleTarget === undefined || targetReason(soleTarget) !== undefined} onClick={() => { onEnterSurface(item, childTargets[0]); }}>
                              <ContextCollectionActionGlyph /><span>{soleTarget && targetReason(soleTarget) ? '未就绪' : '进入'}</span>
                              </button>
                            ) : childTargets.length > 1 ? (
                            <DropdownMenu trigger={<button type="button" aria-label={`选择 ${item.title ?? '集合'} 的现场`} title={`选择 ${item.title ?? '集合'} 的现场`}><ContextCollectionActionGlyph /></button>}>
                                {childTargets.map((workspace) => (
                                  <DropdownMenuItem key={String(workspace.id)} disabled={targetReason(workspace) !== undefined} onClick={() => { onEnterSurface(item, workspace); }}>
                                    {workspace.name}{targetReason(workspace) === undefined ? '' : ` · ${targetReason(workspace)}`}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenu>
                            ) : hasProjection ? <button type="button" aria-label={`定位 ${item.title ?? kindLabel()}`} title={`定位到画布中的 ${item.title ?? kindLabel()}`} onClick={() => { focusOnCanvas(item); }}><ContextCollectionActionGlyph /><span>定位</span></button> : <span className="lcos-context-action-unavailable" title={mode === 'main-collections' ? '当前画布尚无可定位的集合投影' : '当前没有可进入或定位的目标'}>暂无目标</span>}
                          </span>
                        }
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          </>
        )}
        {/* Page feedback belongs after the retained field: loading/retry never displaces its objects. */}
        {state === 'error' && items.length > 0 && <div className="lcos-atlas-pagination-feedback">
          <LcosSurfaceFeedback presentation="error" message={`后续集合读取失败${errorDetail ? `（${errorDetail}）` : ''}，已显示的集合仍可使用。`}
            onAction={warehouse.retry} actionLabel="重试" />
        </div>}
        {warehouse.nextCursor !== undefined && state !== 'error' && <button type="button" className="lcos-atlas-load-more" disabled={state === 'loading'} aria-busy={state === 'loading' || undefined} onClick={warehouse.loadMore}>
          {state === 'loading' ? '正在读取更多集合…' : '继续读取集合'}
        </button>}
    </ContextAtlasView>
  );
}
