// LcosNavigatorIsland — 顶部导航岛（Figma NavigatorIsland 5384:367：静息 52×48 → 搜索 402×48 hug）。
// Cmd/Ctrl+F 聚焦；输入防抖调真实 Core search；结果含对象/原因/位置分级。
// 同现场已投影 → 直接唯一 camera focus；跨现场 → 切真实 worksite（不假定位）。
// 岛形 tell：静息 52（仅搜索图标）→ focus 展开；Esc 分层关闭。


import { CoreSearchClient, HttpError } from '@local-creative-os/web-gen2';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';
import { LcosNavigatorIslandView } from '../ui/families';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { LcosNavigatorIslandState, LcosNavigatorPin } from '../ui/families';
import type { SearchHitVNext } from '@local-creative-os/contracts';

interface NavigatorIslandProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
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
  const requestLocate = useLcosShellStore((s) => s.requestLocate);
  const [focus, setFocus] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHitVNext[]>([]);
  const [state, setState] = useState<IslandState>('静息');
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

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
        setFocus(false);
        setQuery('');
        setHits([]);
        setState('静息');
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
    const timer = window.setTimeout(() => {
      void searchClient
        .searchProject(projectId, { query: q, limit: 12 })
        .then((result) => {
          setHits(result.hits);
          setState(result.hits.length === 0 ? 'empty' : '搜索');
          setDetail(undefined);
        })
        .catch((error: unknown) => {
          if ((error as { code?: string }).code === 'aborted') return;
          setState('error');
          setDetail(error instanceof HttpError ? error.message : String(error));
        });
    }, 260);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, query, projectId]);

  const closeSearch = useCallback((): void => {
    setFocus(false);
    setQuery('');
    setHits([]);
    setState('静息');
  }, []);

  const locateHit = useCallback(
    (hit: SearchHitVNext): void => {
      const location = hit.locationRefs?.[0];
      // 同现场已投影？（reference store nodeEntityRefs 反查 entityId）
      const store = useLcosReferenceStore.getState();
      let ownNodeId: string | undefined;
      for (const [nodeId, ref] of store.nodeEntityRefs) {
        if (ref.entityId === hit.entityId && ref.entityType === hit.entityType) {
          ownNodeId = nodeId;
          break;
        }
      }
      if (ownNodeId) {
        requestLocate({ reqId: `${Date.now()}`, surface: activeSurface, nodeId: ownNodeId, status: 'projected' });
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      } else {
        // 未在当前现场投影：给出位置语义（不假定位；跨现场真实切换/arrival Wave 8）
        setDetail(
          location
            ? `「${hit.title ?? hit.entityId}」位于 ${location.name ?? location.kind}（未在当前现场投影 · 切到目标现场后可见）`
            : undefined,
        );
      }
    },
    [activeSurface, requestLocate],
  );

  // Figma 11 状态 → 生产可达子集（静息/搜索/loading/error；empty 用静息壳 + 结果区文案）
  const viewState: LcosNavigatorIslandState =
    state === 'loading' ? 'loading' : state === 'error' ? 'error' : state === '搜索' ? '搜索' : '静息';

  return (
    <div
      data-lcos-navigator-island
      className="pointer-events-auto fixed left-1/2 top-6 z-40 -translate-x-1/2"
      style={{ maxWidth: '90vw' }}
      onMouseLeave={() => {
        if (query === '') closeSearch();
      }}
    >
      <LcosNavigatorIslandView
        state={viewState}
        pins={pins}
        query={query}
        onQueryChange={setQuery}
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
        <div className="mt-2 max-w-[90vw] rounded-xl px-4 py-2 text-xs" style={{ ...lcosGlassStyle, color: lcosTokens.color.muted }}>
          {detail}
        </div>
      )}
    </div>
  );
}
