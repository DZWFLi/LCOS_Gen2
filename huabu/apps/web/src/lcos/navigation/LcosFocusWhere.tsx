// LcosFocusWhere — F 键「在哪」：按已知实体身份枚举真实空间绑定，不通过全文搜索猜身份。
// Search 找未知；Focus/Where 回答已知对象在哪（T2 C2-2B；P10 分开心智）。
// 行标签用 occurrenceRowLabel 去重逻辑；前往 = 真实 worksite 切换；未绑定 → unavailable。

import { SqliteBindingStore } from '@local-creative-os/web-gen2';
import { ArrowRight, Focus, MapPin, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


import useCanvasStore from '@/store/canvasStore';

import { occurrenceRowLabel } from './occurrenceRowLabelHost';
import { waitForProjectedEntity } from './waitForProjectedEntity';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { SURFACE_LABEL, useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';



export interface LcosFocusWhereProps {
  readonly projectId: string;
  readonly surfaceByWorkspace: Readonly<Map<string, LcosSurfaceKey>>;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
}

interface OccurrenceRow {
  readonly key: string;
  readonly nodeId?: string;
  readonly entityId?: string;
  readonly entityType?: string;
  readonly surface: LcosSurfaceKey | 'unknown';
  readonly label: string;
  readonly current: boolean;
  readonly entityTitle: string | null;
}

export function LcosFocusWhere(props: LcosFocusWhereProps): React.JSX.Element {
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const requestLocate = useLcosShellStore((s) => s.requestLocate);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly OccurrenceRow[]>([]);
  const [entityTitle, setEntityTitle] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | undefined>(undefined);
  const collectGeneration = useRef(0);
  const arrival = useRef<AbortController | null>(null);
  const [arriving, setArriving] = useState(false);
  const { switchWorksite } = useLcosWorksiteNav({
    projectId: props.projectId,
    canvasBySurface: props.canvasBySurface,
    ensureCanvas: props.ensureCanvas,
  });

  const session = useMemo(() => createLcosCoreSession(), []);
  const bindingStore = useMemo(() => new SqliteBindingStore(session.http, props.projectId), [session, props.projectId]);

  const invalidatePendingCollect = useCallback((): void => {
    collectGeneration.current += 1;
    arrival.current?.abort();
  }, []);

  const close = useCallback((): void => {
    invalidatePendingCollect();
    setArriving(false);
    setOpen(false);
  }, [invalidatePendingCollect]);

  const collect = useCallback(async (): Promise<void> => {
    arrival.current?.abort();
    setArriving(false);
    const generation = collectGeneration.current + 1;
    collectGeneration.current = generation;
    const selected = useCanvasStore
      .getState()
      .nodes.filter((n) => n.selected)
      .map((n) => n.id);
    const nodeId = selected[0];
    if (!nodeId) {
      setUnavailable('没有选中的对象 · 先选择一个节点再按 F');
      setRows([]);
      setEntityTitle(null);
      setOpen(true);
      return;
    }
    const ref = useLcosReferenceStore.getState().nodeEntityRefs.get(nodeId);
    if (!ref) {
      setUnavailable('该对象暂时无法定位');
      setRows([]);
      setEntityTitle(null);
      setOpen(true);
      return;
    }
    // 同现场 occurrences：同一 entity 的所有投影
    const own: OccurrenceRow[] = [];
    const currentNodeIds = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
    for (const [nid, r] of useLcosReferenceStore.getState().nodeEntityRefs) {
      if (currentNodeIds.has(nid) && r.entityId === ref.entityId && r.entityType === ref.entityType && nid !== nodeId) {
        own.push({
          key: nid,
          nodeId: nid,
          surface: activeSurface,
          label: occurrenceRowLabel({ surface: activeSurface, workspaceName: undefined }),
          current: false,
          entityTitle: null,
        });
      }
    }
    // 跨现场 occurrence：绑定只证明投影存在，不把它升级成 semantic membership。
    let cross: OccurrenceRow[] = [];
    try {
      const bindings = await bindingStore.list();
      if (generation !== collectGeneration.current) return;
      const currentCanvasId = useCanvasStore.getState().canvasId;
      cross = bindings
        .filter((binding) => binding.projectId === props.projectId && binding.spatialKind === 'node'
          && binding.entityType === ref.entityType && binding.entityId === ref.entityId
          && binding.canvasId !== currentCanvasId)
        .map((binding): OccurrenceRow => {
          const surface = (Object.entries(props.canvasBySurface) as [LcosSurfaceKey, string][])
            .find(([, canvasId]) => canvasId === binding.canvasId)?.[0];
          return {
            key: `cross-${binding.canvasId}-${binding.spatialId}`,
            entityId: ref.entityId,
            entityType: ref.entityType,
            surface: surface ?? 'unknown',
            label: surface ? occurrenceRowLabel({ surface: SURFACE_LABEL[surface], workspaceName: undefined }) : '其它现场（暂不可打开）',
            current: false,
            entityTitle: null,
          };
        });
    } catch {
      if (generation !== collectGeneration.current) return;
      // 绑定读取失败不阻塞已知同现场列表；跨现场明确显示失败原因。
      cross = [{ key: 'search-failed', surface: 'unknown', label: '跨现场位置读取失败', current: false, entityTitle: null }];
    }
    const merged = [...own, ...cross];
    setRows(merged);
    setEntityTitle(ref.descriptor?.title ?? null);
    setUnavailable(undefined);
    setOpen(true);
  }, [activeSurface, props.projectId, props.canvasBySurface, bindingStore]);

  const goToOccurrence = async (row: OccurrenceRow, surface: LcosSurfaceKey): Promise<void> => {
    if (!row.entityId || !row.entityType || (arrival.current && !arrival.current.signal.aborted)) return;
    const controller = new AbortController();
    arrival.current = controller;
    setArriving(true);
    setUnavailable(undefined);
    try {
      const switched = await switchWorksite(surface);
      if (controller.signal.aborted) return;
      const canvasId = useCanvasStore.getState().canvasId;
      if (!switched || !canvasId) {
        setUnavailable('目标现场暂时无法打开，可重试。');
        return;
      }
      const nodeId = await waitForProjectedEntity({ projectId: props.projectId, canvasId,
        entityType: row.entityType, entityId: row.entityId, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!nodeId) {
        setUnavailable('已进入目标现场，但对象投影尚未就绪，可重试定位。');
        return;
      }
      requestLocate({ reqId: crypto.randomUUID(), surface, canvasId, nodeId, status: 'projected' });
      close();
    } catch {
      if (!controller.signal.aborted) setUnavailable('前往对象位置失败，可重试。');
    } finally {
      if (arrival.current === controller) {
        arrival.current = null;
        if (!controller.signal.aborted) setArriving(false);
      }
    }
  };

  useEffect(() => {
    invalidatePendingCollect();
    setOpen(false);
  }, [invalidatePendingCollect, props.projectId]);

  useEffect(() => () => invalidatePendingCollect(), [invalidatePendingCollect]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey && !typing) {
        event.preventDefault();
        void collect();
      }
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSurface, close, collect, props.projectId, props.surfaceByWorkspace]);

  if (!open) return <div data-lcos-focus-where data-open="false" className="hidden" aria-hidden />;

  return (
    <div
      data-lcos-focus-where
      data-open="true"
      className="pointer-events-auto fixed left-1/2 top-24 z-40 w-[380px] -translate-x-1/2 rounded-xl p-3"
      style={{ ...lcosGlassStyle, maxWidth: '88vw' }}
      role="dialog"
      aria-label="对象位置（在哪）"
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: lcosTokens.color.text }}>
          <Focus className="h-4 w-4" aria-hidden />
          在哪 · {entityTitle ?? '当前对象'}
        </span>
        <button type="button" aria-label="关闭" onClick={close} className="rounded-full p-1">
          <X className="h-4 w-4" style={{ color: lcosTokens.color.muted }} />
        </button>
      </div>

      {unavailable && (
        <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(194,91,78,0.08)', color: lcosTokens.color.danger }}>
          {unavailable}
        </div>
      )}

      {rows.length === 0 && !unavailable && (
        <div className="px-3 py-2 text-sm" style={{ color: lcosTokens.color.muted }}>
          在当前现场没有其它投影
        </div>
      )}

      <div className="flex max-h-[46vh] flex-col gap-1 overflow-y-auto">
        {rows.map((row) => {
              const goSurface = row.surface === 'main' || row.surface === 'context' || row.surface === 'workflow' ? row.surface : null;
              return (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
                  style={{ background: row.current ? 'rgba(0,0,0,0.04)' : 'transparent', minHeight: 44 }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: lcosTokens.color.muted }} aria-hidden />
                    <span className="truncate text-sm" style={{ color: lcosTokens.color.text }}>{row.label}</span>
                    {row.entityTitle && (
                      <span className="truncate text-xs" style={{ color: lcosTokens.color.muted }}>{row.entityTitle}</span>
                    )}
                  </span>
                  {row.current ? (
                    <span className="shrink-0 text-[10px]" style={{ color: lcosTokens.color.muted }}>当前现场</span>
                  ) : row.nodeId ? (
                    <button
                      type="button"
                      onClick={() => {
                        requestLocate({ reqId: crypto.randomUUID(), surface: activeSurface, nodeId: row.nodeId, status: 'projected' });
                        close();
                      }}
                      className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
                      style={{ color: lcosTokens.color.text }}
                    >
                      前往
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </button>
                  ) : goSurface ? (
                    <button
                      type="button"
                      disabled={arriving}
                      onClick={() => void goToOccurrence(row, goSurface)}
                      className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
                      style={{ color: lcosTokens.color.text }}
                    >
                      前往
                      <ArrowRight className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </div>
              );
            })}
      </div>
    </div>
  );
}
