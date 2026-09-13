// LcosFocusWhere — F 键「在哪」：当前选中对象在哪些现场/位置（真实 bindings + search locationRefs）。
// Search 找未知；Focus/Where 回答已知对象在哪（T2 C2-2B；P10 分开心智）。
// 行标签用 occurrenceRowLabel 去重逻辑；前往 = 真实 worksite 切换；未绑定 → unavailable。

import { CoreSearchClient } from '@local-creative-os/web-gen2';
import { ArrowRight, Focus, MapPin, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';


import useCanvasStore from '@/store/canvasStore';

import { occurrenceRowLabel } from './occurrenceRowLabelHost';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { SURFACE_LABEL, useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { SearchHitVNext } from '@local-creative-os/contracts';


export interface LcosFocusWhereProps {
  readonly projectId: string;
  readonly surfaceByWorkspace: Readonly<Map<string, LcosSurfaceKey>>;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
}

interface OccurrenceRow {
  readonly key: string;
  readonly surface: LcosSurfaceKey | 'unknown';
  readonly label: string;
  readonly current: boolean;
  readonly entityTitle: string | null;
}

export function LcosFocusWhere(props: LcosFocusWhereProps): React.JSX.Element {
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<readonly OccurrenceRow[]>([]);
  const [entityTitle, setEntityTitle] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | undefined>(undefined);
  const { switchWorksite } = useLcosWorksiteNav({
    projectId: props.projectId,
    canvasBySurface: props.canvasBySurface,
    ensureCanvas: props.ensureCanvas,
  });

  const session = useMemo(() => createLcosCoreSession(), []);
  const searchClient = useMemo(() => new CoreSearchClient(session.http), [session]);

  const collect = async (): Promise<void> => {
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
      setUnavailable('该节点未绑定 Core 实体（GAP）· 无法回答在哪');
      setRows([]);
      setEntityTitle(null);
      setOpen(true);
      return;
    }
    // 同现场 occurrences：同一 entity 的所有投影
    const own: OccurrenceRow[] = [];
    for (const [nid, r] of useLcosReferenceStore.getState().nodeEntityRefs) {
      if (r.entityId === ref.entityId && r.entityType === ref.entityType && nid !== nodeId) {
        own.push({
          key: nid,
          surface: activeSurface,
          label: occurrenceRowLabel({ surface: activeSurface, workspaceName: undefined }),
          current: false,
          entityTitle: null,
        });
      }
    }
    // 跨现场 locationRefs（Core search read projection）
    let cross: OccurrenceRow[] = [];
    try {
      const result = await searchClient.searchProject(props.projectId, { query: ref.entityId, limit: 5, types: [ref.entityType as never] });
      cross = result.hits
        .filter((hit: SearchHitVNext) => hit.entityId === ref.entityId)
        .flatMap((hit) =>
          (hit.locationRefs ?? [])
            .filter((loc) => loc.kind === 'workspace')
            .map((loc): OccurrenceRow => {
              const surface = props.surfaceByWorkspace.get(loc.id);
              return {
                key: `cross-${loc.id}`,
                surface: surface ?? 'unknown',
                label: occurrenceRowLabel({ surface: surface ? SURFACE_LABEL[surface] : undefined, workspaceName: loc.name }),
                current: surface === activeSurface,
                entityTitle: hit.title ?? null,
              };
            }),
        );
    } catch {
      // search 失败不阻塞同现场列表；跨现场标记失败原因
      cross = [{ key: 'search-failed', surface: 'unknown', label: '跨现场位置读取失败', current: false, entityTitle: null }];
    }
    const merged = [...own, ...cross];
    setRows(merged);
    setEntityTitle(ref.entityId);
    setUnavailable(undefined);
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (event.key.toLowerCase() === 'f' && !event.metaKey && !event.ctrlKey && !typing) {
        event.preventDefault();
        void collect();
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSurface, props.projectId, props.surfaceByWorkspace]);

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
        <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: lcosTokens.color.text.light }}>
          <Focus className="h-4 w-4" aria-hidden />
          在哪 · {entityTitle ? `实体 ${entityTitle.slice(0, 24)}` : ''}
        </span>
        <button type="button" aria-label="关闭" onClick={() => setOpen(false)} className="rounded-full p-1">
          <X className="h-4 w-4" style={{ color: lcosTokens.color.muted.light }} />
        </button>
      </div>

      {unavailable && (
        <div className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(194,91,78,0.08)', color: lcosTokens.color.danger }}>
          {unavailable}
        </div>
      )}

      {rows.length === 0 && !unavailable && (
        <div className="px-3 py-2 text-sm" style={{ color: lcosTokens.color.muted.light }}>
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
                    <MapPin className="h-3.5 w-3.5 shrink-0" style={{ color: lcosTokens.color.muted.light }} aria-hidden />
                    <span className="truncate text-sm" style={{ color: lcosTokens.color.text.light }}>{row.label}</span>
                    {row.entityTitle && (
                      <span className="truncate text-xs" style={{ color: lcosTokens.color.muted.light }}>{row.entityTitle}</span>
                    )}
                  </span>
                  {row.current ? (
                    <span className="shrink-0 text-[10px]" style={{ color: lcosTokens.color.muted.light }}>当前现场</span>
                  ) : goSurface ? (
                    <button
                      type="button"
                      onClick={() => void switchWorksite(goSurface)}
                      className="flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium"
                      style={{ color: lcosTokens.color.text.light }}
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
