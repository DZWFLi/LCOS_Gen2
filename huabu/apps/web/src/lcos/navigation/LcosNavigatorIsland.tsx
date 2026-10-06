import { CoreSearchClient, HttpError } from '@local-creative-os/web-gen2';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/Common/Button';
import { DropdownMenu, DropdownMenuItem } from '@/components/Common/DropdownMenu';

import { useNavigationHudSlot } from './NavigationHudSlot';
import { useAvoidingHudPosition } from './useAvoidingHudPosition';
import { useHudViewport } from './useHudViewport';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { lcosHudEdgeOffsets } from '../shell/lcosHudPlacement';
import { useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';
import { LcosNavigatorIslandView } from '../ui/families';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';
import { useLayerReturnFocus } from '../ui/spatial/useLayerReturnFocus';

import type { LcosNavigatorIslandState, LcosNavigatorPin } from '../ui/families';
import type { SearchHitVNext } from '@local-creative-os/contracts';

// One physical HUD slot. Search resolves identity; Where resolves complete spatial occurrences.

const SEARCH_REASON_LABELS: Readonly<Record<NonNullable<SearchHitVNext['matchReason']>, string>> = {
  title: '标题匹配',
  body: '正文匹配',
  ocr: '图片文字匹配',
  visual: '图像相似',
  semantic: '内容相关',
  source: '来源信息匹配',
  relation: '关联内容匹配',
  metadata: '内容匹配',
};

function searchReasonLabel(hit: SearchHitVNext): string | undefined {
  return hit.matchReason === undefined ? undefined : SEARCH_REASON_LABELS[hit.matchReason];
}

function locationCountLabel(hit: SearchHitVNext): string | undefined {
  const count = hit.locationCount;
  return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? `出现在 ${count} 个位置` : undefined;
}

const SEARCH_ENTITY_NAME_FALLBACKS: Readonly<Record<SearchHitVNext['entityType'], string>> = {
  artifact: '项目材料',
  note: '项目笔记',
  conversation: '会话',
  resource: '资源',
  file: '文件',
};

function searchHitName(hit: SearchHitVNext): string {
  return hit.title?.trim() || hit.snippet?.trim() || SEARCH_ENTITY_NAME_FALLBACKS[hit.entityType];
}

function ReaderSearchReturnFocusLayer(): React.JSX.Element {
  const ref = useLayerReturnFocus(true);
  return <div ref={ref} data-lcos-reader-search-focus-return style={{ display: 'contents' }} />;
}

interface NavigatorIslandProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly surfaceByWorkspace?: Readonly<Map<string, LcosSurfaceKey>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
  readonly pins?: readonly LcosNavigatorPin[];
  readonly onActivatePin?: (pin: LcosNavigatorPin) => void;
  readonly onCreatePin?: () => void;
  readonly createPinDisabled?: boolean;
}
export function LcosNavigatorIsland(props: NavigatorIslandProps): React.JSX.Element {
  const { active, activate: activateHudSlot, close: closeHudSlot } = useNavigationHudSlot();
  const focus = active === 'search';
  const viewport = useHudViewport();
  const environment = useLcosShellStore((s) => s.windowEnvironment);
  const requestFocusWhere = useLcosShellStore((s) => s.requestFocusWhere);
  const openReader = useLcosShellStore((s) => s.openReader);
  const openWindow = useLcosShellStore((s) => s.openWindow);
  const windows = useLcosShellStore((s) => s.windows);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHitVNext[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [detail, setDetail] = useState<string>();
  const [activeIndex, setActiveIndex] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [readerReturnTarget, setReaderReturnTarget] = useState<string>();
  const session = useMemo(() => createLcosCoreSession(), []);
  const search = useMemo(() => new CoreSearchClient(session.http), [session]);
  const close = useCallback(() => { closeHudSlot('search'); setQuery(''); setHits([]); setTruncated(false); setState('idle'); setDetail(undefined); }, [closeHudSlot]);
  const open = useCallback(() => {
    searchButtonRef.current?.focus();
    activateHudSlot('search'); setQuery(''); setActiveIndex(0);
  }, [activateHudSlot]);
  useEffect(() => { if (focus) inputRef.current?.focus(); }, [focus]);
  useEffect(() => { close(); }, [props.projectId, close]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      // An editor/reader owns its local Find command. Do not steal it.
      const editing = target?.closest('input,textarea,[contenteditable="true"],[data-lcos-reader],[data-lcos-reader-content]');
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && (!editing || target === inputRef.current)) {
        event.preventDefault(); open();
      } else if (event.key === 'Escape' && focus) {
        if (document.querySelector('[data-lcos-pin-overflow]')) return;
        event.preventDefault(); event.stopImmediatePropagation(); close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, focus, open]);
  useEffect(() => {
    const q = query.trim();
    if (!focus || !q) { setHits([]); setState('idle'); return; }
    let cancelled = false;
    setState('loading'); setDetail(undefined);
    const timer = window.setTimeout(() => {
      void search.searchProject(props.projectId, { query: q, limit: 50 }).then((result) => {
        if (cancelled) return;
        setHits(result.hits); setTruncated(result.truncated === true); setActiveIndex(0); setState('ready');
      }).catch((error: unknown) => {
        if (cancelled) return;
        setState('error'); setDetail(error instanceof HttpError ? error.message : String(error));
      });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [focus, query, props.projectId, search, retry]);
  const locate = (hit: SearchHitVNext): void => {
    close();
    requestFocusWhere({ reqId: crypto.randomUUID(), entityType: hit.entityType, entityId: hit.entityId, title: searchHitName(hit) });
  };
  const choose = (hit: SearchHitVNext): void => {
    const title = searchHitName(hit);
    if (hit.entityType === 'artifact') {
      // Keep a live DOM opener for the Reader's existing close path.
      searchButtonRef.current?.focus();
      setReaderReturnTarget(hit.entityId);
      close();
      openReader(`阅读 · ${title}`, hit.entityId);
      return;
    }
    if (hit.entityType === 'conversation') {
      close();
      openWindow('conversation', `会话窗口 · ${title}`, hit.entityId);
      return;
    }
    locate(hit);
  };
  const hasSearchOpenedReader = readerReturnTarget !== undefined && windows.some((window) =>
    window.bodyKey === 'reader' && window.target === readerReturnTarget && window.readerRevisionId === undefined);
  useEffect(() => {
    if (readerReturnTarget !== undefined && !hasSearchOpenedReader) setReaderReturnTarget(undefined);
  }, [hasSearchOpenedReader, readerReturnTarget]);
  const pins = props.pins ?? [];
  const viewState: LcosNavigatorIslandState = focus && state === 'loading' ? 'loading'
    : focus && state === 'error' ? 'error' : focus ? '搜索' : pins.length > 0 ? '彩色标' : '静息';
  const offsets = lcosHudEdgeOffsets(environment ?? null, viewport);
  const width = Math.max(52, viewport.width - offsets.left - offsets.right);
  const pinSlots = Math.max(0, Math.min(3, Math.floor((width - (focus ? 174 : 52)) / 44)));
  const moreVisible = pins.length > pinSlots || props.onCreatePin !== undefined;
  const visiblePinCount = Math.min(pins.length, moreVisible ? Math.max(0, pinSlots - 1) : pinSlots);
  const islandWidth = focus && state !== 'idle' ? Math.min(402, width)
    : Math.min(width, 52 + (focus ? 218 : 0) + (visiblePinCount + (moreVisible ? 1 : 0)) * 44);
  const placement = useAvoidingHudPosition({ x: (offsets.left + viewport.width - offsets.right) / 2,
    y: offsets.top, width: islandWidth, height: 48 }, { x: 'center' }, '[data-lcos-shell-project-cluster]');
  const activeHit = state === 'ready' ? hits[activeIndex] : undefined;
  const selectedHit = hits[activeIndex];
  const content = <>
    <LcosNavigatorIslandView state={viewState} expanded={focus} pins={pins} availableWidth={width}
      onActivatePin={props.onActivatePin} onCreatePin={props.onCreatePin} createPinDisabled={props.createPinDisabled}
      query={query} onQueryChange={setQuery} onToggleSearch={() => focus ? close() : open()}
      searchButtonRef={searchButtonRef} inputRef={inputRef} inputAriaControls="lcos-project-search-results"
      activeDescendant={focus && hits[activeIndex] ? `lcos-search-result-${activeIndex}` : undefined}
      onInputKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); const delta = event.key === 'ArrowDown' ? 1 : -1;
          setActiveIndex((current) => Math.max(0, Math.min(hits.length - 1, current + delta)));
        } else if (event.key === 'Enter' && selectedHit && state === 'ready') { event.preventDefault(); choose(selectedHit); }
      }} />
    {focus && state !== 'idle' && <div data-lcos-navigator-results id="lcos-project-search-results"
      className="mt-2 max-h-[50vh] overflow-y-auto rounded-xl p-2" style={{ ...lcosGlassStyle, width: Math.min(402, width) }}>
      {state === 'loading' && <div role="status" className="flex items-center gap-2 px-3 py-2 text-sm"><LoaderCircle size={16} className="lcos-static-pulse" />正在搜索…</div>}
      {state === 'error' && <div role="alert" className="px-3 py-2 text-sm" style={{ color: lcosTokens.color.danger }}>搜索失败{detail ? `：${detail}` : ''}<button className="ml-2 underline" onClick={() => setRetry((value) => value + 1)}>重试</button></div>}
      {state === 'ready' && <>
        <div role="listbox" aria-label="项目搜索结果">
          {hits.length === 0 && <div role="status" className="px-3 py-2 text-sm">没有匹配的对象</div>}
          {hits.map((hit, index) => {
            const title = searchHitName(hit);
            return <button key={`${hit.entityType}:${hit.entityId}`} id={`lcos-search-result-${index}`} type="button"
              role="option" aria-selected={activeIndex === index} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(hit)}
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left"
              style={{ background: activeIndex === index ? lcosTokens.color.raised : undefined }}>
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{title}</span>
                {hit.snippet && hit.snippet !== title && <span className="block truncate text-xs" style={{ color: lcosTokens.color.muted }}>{hit.snippet}</span>}
                {(searchReasonLabel(hit) || locationCountLabel(hit)) && <span data-lcos-search-result-context className="mt-0.5 flex min-w-0 flex-wrap gap-x-2 text-[11px]" style={{ color: lcosTokens.color.muted }}>
                  {searchReasonLabel(hit) && <span data-lcos-search-match-reason>{searchReasonLabel(hit)}</span>}
                  {locationCountLabel(hit) && <span data-lcos-search-location-count>{locationCountLabel(hit)}</span>}
                </span>}
              </span><ArrowRight size={16} aria-hidden />
            </button>;
          })}
        </div>
        {activeHit && <div data-lcos-search-secondary-actions className="mt-1 flex justify-end">
          <DropdownMenu align="bottom-right"
            trigger={<Button variant="ghost" tone="neutral" data-lcos-search-locate-trigger>查找位置</Button>}>
            <DropdownMenuItem onClick={() => locate(activeHit)}>在画布中定位“{searchHitName(activeHit)}”</DropdownMenuItem>
          </DropdownMenu>
        </div>}
        {truncated && <p className="px-3 py-2 text-xs" style={{ color: lcosTokens.color.muted }}>还有匹配结果；补充关键词可缩小范围。</p>}
      </>}
    </div>}
  </>;
  return <div ref={placement.ref} data-lcos-navigator-island className="pointer-events-auto fixed z-40"
    style={{ top: placement.rect.y, left: placement.rect.x, maxWidth: width, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    {content}
    {readerReturnTarget !== undefined && <ReaderSearchReturnFocusLayer />}
  </div>;
}
