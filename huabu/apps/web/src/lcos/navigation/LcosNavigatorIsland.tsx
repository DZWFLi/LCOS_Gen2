// LcosNavigatorIsland — 顶部导航岛（Figma NavigatorIsland 5384:367：静息 52×48 → 搜索 402×48 hug）。
// Cmd/Ctrl+F 聚焦；输入防抖调真实 Core search；结果含对象/原因/位置分级。
// 同现场已投影 → 直接唯一 camera focus；跨现场 → 切真实 worksite（不假定位）。
// 岛形 tell：静息 52（仅搜索图标）→ focus 展开；Esc 分层关闭。


import { CoreSearchClient, HttpError } from '@local-creative-os/web-gen2';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


import useCanvasStore from '@/store/canvasStore';

import { waitForProjectedEntity } from './waitForProjectedEntity';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';
import { lcosHudEdgeOffsets } from '../shell/lcosHudPlacement';
import { LcosNavigatorIslandView } from '../ui/families';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { LcosNavigatorIslandState, LcosNavigatorPin } from '../ui/families';
import type { SearchHitVNext } from '@local-creative-os/contracts';

interface NavigatorIslandProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly surfaceByWorkspace?: Readonly<Map<string, LcosSurfaceKey>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
  /**
   * 彩色标 Pin（Figma 状态=彩色标）。Pin = 颜色分组偏好及成员关系（00 页 5409:2）。
   * Core 目前没有 pin/color-group producer，故生产恒为空数组 → 岛停在「静息 / 搜索」；
   * 彩色标等其余状态由 dev gallery 覆盖，生产 producer 归属 R4/T2。
   */
  readonly pins?: readonly LcosNavigatorPin[];
}

/** 搜索链路的真实状态；变体语言与 Figma 11 状态同名。 */
type IslandState = '静息' | '搜索' | 'loading' | 'error' | 'empty';

export function LcosNavigatorIsland(_props: NavigatorIslandProps): React.JSX.Element {
  const { projectId, pins = [] } = _props;
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const windowEnvironment = useLcosShellStore((s) => s.windowEnvironment);
  const requestLocate = useLcosShellStore((s) => s.requestLocate);
  const [focus, setFocus] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHitVNext[]>([]);
  const [state, setState] = useState<IslandState>('静息');
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const arrival = useRef<AbortController | null>(null);
  const [destinationHit, setDestinationHit] = useState<SearchHitVNext | null>(null);
  const [arriving, setArriving] = useState(false);
  const { switchWorksite } = useLcosWorksiteNav({ projectId, canvasBySurface: _props.canvasBySurface, ensureCanvas: _props.ensureCanvas });

  useEffect(() => () => { arrival.current?.abort(); }, [projectId, query, focus]);

  const session = useMemo(() => createLcosCoreSession(), []);
  const searchClient = useMemo(() => new CoreSearchClient(session.http), [session]);

  // Cmd/Ctrl+F 全局热键展开
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFocus(true);
        setQuery('');
        window.setTimeout(() => inputRef.current?.focus(), 30);
      }
      if (event.key === 'Escape') {
        arrival.current?.abort();
        setDestinationHit(null);
        setArriving(false);
        setFocus(false);
        setQuery('');
        setHits([]);
        setState('静息');
        setDetail(undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 防抖搜索
  useEffect(() => {
    const q = query.trim();
    if (!focus || q === '') {
      setHits([]);
      setState(q === '' ? '静息' : 'empty');
      return;
    }
    setState('loading');
    const controller = new AbortController();
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchClient
        .searchProject(projectId, { query: q, limit: 12 })
        .then((result) => {
          if (cancelled) return;
          setHits(result.hits);
          setState(result.hits.length === 0 ? 'empty' : '搜索');
          setDetail(undefined);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          if ((error as { code?: string }).code === 'aborted') return;
          setState('error');
          setDetail(error instanceof HttpError ? error.message : String(error));
        });
    }, 260);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, query, projectId]);

  const closeSearch = useCallback((): void => {
    arrival.current?.abort();
    setDestinationHit(null);
    setArriving(false);
    setFocus(false);
    setQuery('');
    setHits([]);
    setState('静息');
    setDetail(undefined);
  }, []);

  const goToLocation = async (hit: SearchHitVNext, surface: LcosSurfaceKey): Promise<void> => {
    if (arrival.current && !arrival.current.signal.aborted) return;
    arrival.current?.abort();
    const controller = new AbortController();
    arrival.current = controller;
    setArriving(true);
    setDetail('正在前往对象所在的现场…');
    try {
      if (!await switchWorksite(surface) || controller.signal.aborted) {
        if (!controller.signal.aborted) setDetail('现场切换未完成，请重试。');
        return;
      }
      const canvasId = useCanvasStore.getState().canvasId;
      if (!canvasId) { setDetail('目标现场的画布尚未就绪。'); return; }
      const nodeId = await waitForProjectedEntity({ projectId, canvasId, entityType: hit.entityType, entityId: hit.entityId, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!nodeId) {
        setDetail('已进入目标现场，但对象投影尚未就绪。可重试定位，搜索结果已保留。');
        return;
      }
      requestLocate({ reqId: crypto.randomUUID(), surface, canvasId, nodeId, status: 'projected' });
      closeSearch();
    } catch (error: unknown) {
      if (!controller.signal.aborted) setDetail(error instanceof Error ? error.message : '定位失败，请重试。');
    } finally {
      if (arrival.current === controller) { arrival.current = null; setArriving(false); }
    }
  };

  const locateHit = useCallback(
    (hit: SearchHitVNext): void => {
      const location = hit.locationRefs?.[0];
      // 同现场已投影？（reference store nodeEntityRefs 反查 entityId）
      const store = useLcosReferenceStore.getState();
      const currentNodeIds = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
      let ownNodeId: string | undefined;
      for (const [nodeId, ref] of store.nodeEntityRefs) {
        if (currentNodeIds.has(nodeId) && ref.entityId === hit.entityId && ref.entityType === hit.entityType) {
          ownNodeId = nodeId;
          break;
        }
      }
      if (ownNodeId) {
        requestLocate({ reqId: `${Date.now()}`, surface: activeSurface, nodeId: ownNodeId, status: 'projected' });
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        // Search is a transient replacement for the resting island. Once the
        // projected target is handed to the camera consumer, restore the island
        // so stale query/results do not remain over the arrival target.
        closeSearch();
      } else {
        setDestinationHit(hit);
        setDetail(
          location
            ? `选择「${hit.title ?? hit.entityId}」的位置`
            : '该对象尚无可定位的位置；可以从装配中查找并取用。',
        );
      }
    },
    [activeSurface, closeSearch, requestLocate],
  );

  // 输入是否展开由用户意图决定；异步读取/空结果不能卸载正在输入的文本框。
  const viewState: LcosNavigatorIslandState =
    focus ? '搜索' : pins.length > 0 ? '彩色标' : '静息';
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const edgeOffsets = lcosHudEdgeOffsets(windowEnvironment, viewport);
  // R2-B：与 SurfaceDock 同一规则 —— 导航岛在 safe area 内居中，右侧停靠窗口不会盖住它。
  // 无窗口 / 只有浮动窗口时结果仍是视口中心（与旧行为一致）。
  const safeCenteredLeft = (edgeOffsets.left + (viewport.width - edgeOffsets.right)) / 2;

  return (
    <div
      data-lcos-navigator-island
      className="pointer-events-auto fixed top-6 z-40 -translate-x-1/2"
      style={{ maxWidth: '90vw', top: edgeOffsets.top, left: safeCenteredLeft }}
    >
      <LcosNavigatorIslandView
        state={viewState}
        pins={pins}
        query={query}
        onQueryChange={(value) => {
          arrival.current?.abort();
          setDestinationHit(null);
          setArriving(false);
          setDetail(undefined);
          setQuery(value);
        }}
        onToggleSearch={() => {
          if (focus) {
            closeSearch();
            return;
          }
          setFocus(true);
          setQuery('');
          window.setTimeout(() => inputRef.current?.focus(), 30);
        }}
        message={state === 'error' ? `搜索失败${detail ? `（${detail}）` : ''} · 请重试` : undefined}
        inputRef={inputRef}
      />

      {focus && (state === '搜索' || state === 'loading' || state === 'empty' || state === 'error') && (
        <div
          data-lcos-navigator-results
          className="mt-2 max-h-[50vh] overflow-y-auto rounded-xl p-2"
          style={{ ...lcosGlassStyle, width: 402, maxWidth: '90vw' }}
        >
          {state === 'loading' && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm" style={{ color: lcosTokens.color.muted }}>
              <LoaderCircle className="h-4 w-4 lcos-static-pulse" aria-hidden />
              正在搜索…
            </div>
          )}
          {state === 'empty' && (
            <div className="px-3 py-2 text-sm" style={{ color: lcosTokens.color.muted }}>
              没有匹配的对象
            </div>
          )}
          {state === 'error' && (
            <div className="px-3 py-2 text-sm" style={{ color: lcosTokens.color.danger }}>
              搜索失败{detail ? `（${detail}）` : ''} · 请重试
            </div>
          )}
          {state === '搜索' &&
            hits.map((hit) => (
              <button
                key={`${hit.entityType}:${hit.entityId}`}
                type="button"
                disabled={arriving}
                onClick={() => locateHit(hit)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors"
                style={{ minHeight: 44 }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium" style={{ color: lcosTokens.color.text }}>
                    {hit.title ?? (hit.entityId ?? '未命名')}
                  </span>
                  <span className="block truncate text-xs" style={{ color: lcosTokens.color.muted }}>
                    {hit.entityType} · {hit.locationRefs?.[0]?.name ?? '位置未知'}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0" style={{ color: lcosTokens.color.muted }} aria-hidden />
              </button>
            ))}
        </div>
      )}

      {detail && (
        <div className="mt-2 max-w-[90vw] rounded-xl px-4 py-2 text-xs" style={{ ...lcosGlassStyle, color: lcosTokens.color.muted }} aria-live="polite">
          <p>{detail}</p>
          {destinationHit?.locationRefs?.map((location) => {
            const surface = _props.surfaceByWorkspace?.get(location.id);
            return <button key={location.id} type="button" disabled={!surface || arriving}
              className="mt-1 flex min-h-11 w-full items-center justify-between gap-2 text-left disabled:opacity-50"
              onClick={() => { if (surface) void goToLocation(destinationHit, surface); }}>
              <span>{location.name ?? surface ?? '未知现场'}</span>
              <span>{surface ? (arriving ? '前往中…' : '前往并定位') : '位置暂不可打开'}</span>
            </button>;
          })}
        </div>
      )}
    </div>
  );
}
