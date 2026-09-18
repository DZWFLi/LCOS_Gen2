// LcosNavigatorIsland — 顶部导航岛（Figma NavigatorIsland 5384:367：静息 52×48 → 搜索 402×48 hug）。
// Cmd/Ctrl+F 聚焦；输入防抖调真实 Core search；结果含对象/原因/位置分级。
// 同现场已投影 → 直接唯一 camera focus；跨现场 → 切真实 worksite（不假定位）。
// 岛形 tell：静息 52（仅搜索图标）→ focus 展开；Esc 分层关闭。


import { CoreSearchClient, HttpError, isCoreAbortError } from '@local-creative-os/web-gen2';
import { ArrowRight, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';


import useCanvasStore from '@/store/canvasStore';

import { waitForProjectedEntity } from './waitForProjectedEntity';
import { paletteTonesV1, readColorPinPaletteV1, toneForColorPinV1, type LcosColorPinTone } from './lcosColorPinPalette';
import {
  LCOS_SURFACE_MARKER_REASON_TEXT,
  resolveSurfaceMarkerTargetV1,
  sameSurfaceMarkerTargetV1,
  type LcosSurfaceScopeTruthV1,
  type LcosSurfaceWorkspaceTruthV1,
} from './lcosSurfaceMarkerTarget';
import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useLcosWorksiteNav } from '../app/useLcosWorksiteNav';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';
import { lcosHudEdgeOffsets } from '../shell/lcosHudPlacement';
import { LcosNavigatorIslandView } from '../ui/families';
import { lcosGlassStyle, lcosTokens } from '../ui/lcosTokens';

import type { LcosNavigatorIslandState, LcosNavigatorPin } from '../ui/families';
import type {
  ColorPinMembershipV0,
  ColorPinSnapshotV0,
  NavigationResolutionV0,
  SearchHitVNext,
} from '@local-creative-os/contracts';

/** 取消不是失败（共用 web-gen2 的 HttpClient abort 归一）。 */
const isAbortLikeV1 = isCoreAbortError;

interface NavigatorIslandProps {
  readonly projectId: string;
  readonly canvasBySurface: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  readonly surfaceByWorkspace?: Readonly<Map<string, LcosSurfaceKey>>;
  readonly ensureCanvas: (surface: LcosSurfaceKey, force?: boolean) => Promise<string | undefined>;
  /** 进入子现场（颜色组指向 workspace: 目标时用；与 Railway activateDestination 同一通道）。 */
  readonly ensureWorkspaceCanvas?: (workspaceId: string) => Promise<string | undefined>;
  /** route ?workspaceId= —— 显式子工作现场（ColorPin target 必须用它，不得用 activeWorkspaceId 冒充 root surface）。 */
  readonly childWorkspaceId?: string;
  /**
   * 彩色标 Pin（Figma 状态=彩色标）。Pin = 颜色分组偏好及成员关系（00 页 5409:2）。
   * R6：生产 producer 已接通 —— 未显式传入时由 canonical color-pins owner
   * （GET /projects/:pid/color-pins）驱动；显式传入只用于 dev gallery 覆盖。
   */
  readonly pins?: readonly LcosNavigatorPin[];
}

/** 搜索链路的真实状态；变体语言与 Figma 11 状态同名。 */
type IslandState = '静息' | '搜索' | 'loading' | 'error' | 'empty';

export function LcosNavigatorIsland(_props: NavigatorIslandProps): React.JSX.Element {
  const { projectId } = _props;
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const openWindow = useLcosShellStore((s) => s.openWindow);
  const windowEnvironment = useLcosShellStore((s) => s.windowEnvironment);
  const requestLocate = useLcosShellStore((s) => s.requestLocate);
  const setActiveSurface = useLcosShellStore((s) => s.setActiveSurface);
  const navigate = useNavigate();
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

  // ---- R6 ColorPin：颜色组（canonical color-pins owner）----
  //
  // 岛消费 canonical snapshot（definitions + memberships），不建第二 pin store。
  // 标记目标由 pure helper 从 current route + project graph truth 解出：
  //   root Main → surface:main；root Context/Workflow → surface:scope:<exact id>；
  //   显式子工作现场 → surface:workspace:<exact id>；无法唯一解析 → fail closed（不猜）。
  // many-to-many：同一 target 可属于多个颜色组；已属的 swatch 只标记 assigned，其余仍可继续标记。

  const [palette, setPalette] = useState<Readonly<Record<LcosColorPinTone, string>> | undefined>(undefined);
  const [pinSnapshot, setPinSnapshot] = useState<ColorPinSnapshotV0 | undefined>(undefined);
  const [graphTruth, setGraphTruth] = useState<{
    readonly scopes: readonly LcosSurfaceScopeTruthV1[];
    readonly workspaces: readonly LcosSurfaceWorkspaceTruthV1[];
  } | undefined>(undefined);
  const [pinNote, setPinNote] = useState<string | undefined>(undefined);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinPaletteOpen, setPinPaletteOpen] = useState(false);
  const [openPinId, setOpenPinId] = useState<string | undefined>(undefined);

  /**
   * ColorPin local project generation：Project A 的迟到回包不得写进 Project B 的 HUD。
   * project 切换 / 新的请求都让旧 completion 失效；Abort 也不得写成 error。
   */
  const pinGeneration = useRef(0);

  useEffect(() => { setPalette(readColorPinPaletteV1()); }, []);

  const loadPins = useCallback((generation: number): void => {
    void session.colorPins
      .snapshot(projectId)
      .then((value) => {
        if (pinGeneration.current !== generation) return;
        setPinSnapshot(value);
      })
      .catch((error: unknown) => {
        if (isAbortLikeV1(error) || pinGeneration.current !== generation) return;
        setPinNote(`颜色组读取失败${error instanceof Error ? `（${error.message}）` : ''}`);
      });
  }, [projectId, session]);

  const reloadPins = useCallback((): void => {
    pinGeneration.current += 1;
    loadPins(pinGeneration.current);
  }, [loadPins]);

  useEffect(() => { reloadPins(); }, [reloadPins]);

  // project graph truth（scopes/workspaces）：只读，用于解出 canonical surface target。
  useEffect(() => {
    let active = true;
    void session.projects
      .getProjectGraph(projectId)
      .then((graph) => {
        if (!active) return;
        setGraphTruth({
          scopes: (graph?.scopes ?? []) as readonly LcosSurfaceScopeTruthV1[],
          workspaces: (graph?.workspaces ?? []) as readonly LcosSurfaceWorkspaceTruthV1[],
        });
      })
      .catch(() => { if (active) setGraphTruth(undefined); });
    return () => { active = false; };
  }, [projectId, session]);

  // project 切换：清掉旧 Project 的颜色组视图态（不把 A 的 snapshot/回执留在 B）。
  useEffect(() => {
    pinGeneration.current += 1;
    setPinSnapshot(undefined);
    setPinNote(undefined);
    setPinPaletteOpen(false);
    setOpenPinId(undefined);
    setPinBusy(false);
    setGraphTruth(undefined);
  }, [projectId]);

  /** canonical surface target（pure helper；graph 未就绪时诚实为 undefined）。 */
  const surfaceTarget = graphTruth === undefined
    ? undefined
    : resolveSurfaceMarkerTargetV1({
        projectId,
        surface: activeSurface,
        childWorkspaceId: _props.childWorkspaceId,
        scopes: graphTruth.scopes,
        workspaces: graphTruth.workspaces,
      });
  const surfaceTargetRef = surfaceTarget?.status === 'resolved' ? surfaceTarget.targetRef : undefined;
  const surfaceTargetReason = surfaceTarget?.status === 'unresolved'
    ? LCOS_SURFACE_MARKER_REASON_TEXT[surfaceTarget.reason]
    : graphTruth === undefined ? '正在读取项目真值…' : undefined;

  const pinList: readonly LcosNavigatorPin[] = useMemo(() => {
    if (pinSnapshot === undefined || palette === undefined) return [];
    // 颜色组 = 成员关系：没有成员的定义不渲染（canonical 定义仍保留，可被重新标记复用）。
    return pinSnapshot.definitions
      .map((definition) => ({
        id: definition.id,
        tone: toneForColorPinV1(definition.color, palette),
        label: definition.label ?? `颜色组 ${definition.color}`,
        color: definition.color,
        count: pinSnapshot.memberships.filter((membership) => membership.colorPinId === definition.id).length,
      }))
      .filter((pin) => (pin.count ?? 0) > 0);
  }, [palette, pinSnapshot]);

  const pins = _props.pins ?? pinList;

  const definitionsById = useMemo(
    () => new Map((pinSnapshot?.definitions ?? []).map((definition) => [definition.id, definition])),
    [pinSnapshot],
  );
  const membershipsByPin = useMemo(() => {
    const grouped = new Map<string, readonly ColorPinMembershipV0[]>();
    for (const membership of pinSnapshot?.memberships ?? []) {
      grouped.set(membership.colorPinId, [...(grouped.get(membership.colorPinId) ?? []), membership]);
    }
    return grouped;
  }, [pinSnapshot]);

  /** 当前现场已有的 canonical 成员关系**集合**（many-to-many；不是单值）。 */
  const currentSurfaceMemberships: readonly ColorPinMembershipV0[] = useMemo(() => {
    if (pinSnapshot === undefined || surfaceTargetRef === undefined) return [];
    return pinSnapshot.memberships.filter((membership) => sameSurfaceMarkerTargetV1(membership.targetRef, surfaceTargetRef));
  }, [pinSnapshot, surfaceTargetRef]);

  /** 已属于哪个调色板色（只用于把该 swatch 标成 assigned；不影响其它颜色继续标记）。 */
  const assignedPaletteColors = useMemo(() => {
    const colors = new Set<string>();
    for (const membership of currentSurfaceMemberships) {
      const color = definitionsById.get(membership.colorPinId)?.color;
      if (color !== undefined) colors.add(color.toUpperCase());
    }
    return colors;
  }, [currentSurfaceMemberships, definitionsById]);

  const assignPin = (tone: LcosColorPinTone): void => {
    if (palette === undefined) { setPinNote('颜色组调色板不可用（设计 token 未加载）'); return; }
    if (surfaceTargetRef === undefined) { setPinNote(`无法标记：${surfaceTargetReason ?? '当前现场无法解析'}`); return; }
    // 已发出的 canonical mutation 用 invocation 时刻捕获的 project/target；回执只在仍是当前 context 时回写。
    const invocationProjectId = projectId;
    const invocationTarget = surfaceTargetRef;
    pinGeneration.current += 1;
    const generation = pinGeneration.current;
    setPinBusy(true);
    setPinNote(undefined);
    void session.colorPins
      .assign(invocationProjectId, { targetRef: invocationTarget, color: palette[tone] })
      .then((receipt) => {
        if (pinGeneration.current !== generation) return;
        setPinBusy(false);
        setPinNote(receipt.changeSetId === undefined ? '已标为颜色组' : `已标为颜色组 · 变更 ${receipt.changeSetId.slice(0, 8)}`);
        pinGeneration.current += 1;
        loadPins(pinGeneration.current);
      })
      .catch((error: unknown) => {
        if (pinGeneration.current !== generation) return;
        setPinBusy(false);
        if (isAbortLikeV1(error)) return;
        setPinNote(`标记失败${error instanceof Error ? `（${error.message}）` : ''}`);
      });
  };

  const removeMembership = (membershipId: string): void => {
    const invocationProjectId = projectId;
    pinGeneration.current += 1;
    const generation = pinGeneration.current;
    setPinBusy(true);
    setPinNote(undefined);
    void session.colorPins
      .removeMembership(invocationProjectId, membershipId)
      .then((receipt) => {
        if (pinGeneration.current !== generation) return;
        setPinBusy(false);
        setPinNote(receipt.changeSetId === undefined ? '已移除颜色组' : `已移除颜色组 · 变更 ${receipt.changeSetId.slice(0, 8)}`);
        pinGeneration.current += 1;
        loadPins(pinGeneration.current);
      })
      .catch((error: unknown) => {
        if (pinGeneration.current !== generation) return;
        setPinBusy(false);
        if (isAbortLikeV1(error)) return;
        setPinNote(`移除失败${error instanceof Error ? `（${error.message}）` : ''}`);
      });
  };

  /** 前往颜色组成员：canonical resolve → 真实前往；unresolved 是合法结果（诚实说明）。 */
  const travelToMembership = async (membership: ColorPinMembershipV0): Promise<void> => {
    const invocationProjectId = projectId;
    pinGeneration.current += 1;
    const generation = pinGeneration.current;
    setPinBusy(true);
    setPinNote(undefined);
    try {
      const resolution: NavigationResolutionV0 = await session.navigation.resolveTarget(invocationProjectId, membership.targetRef);
      if (pinGeneration.current !== generation) return;
      if (resolution.status === 'unresolved') {
        setPinNote(`无法前往：目标已失效（${resolution.reason}）`);
        return;
      }
      const { surfaceKind, surfaceRef } = resolution.target;
      if (surfaceKind === 'main' || surfaceKind === 'context' || surfaceKind === 'workflow') {
        await switchWorksite(surfaceKind);
        return;
      }
      if (surfaceKind === 'conversation') {
        const conversationId = surfaceRef.startsWith('conversation:') ? surfaceRef.slice('conversation:'.length) : '';
        if (conversationId === '') { setPinNote('无法前往：会话身份不完整'); return; }
        openWindow('conversation', '会话', conversationId);
        return;
      }
      if (surfaceRef.startsWith('workspace:')) {
        const workspaceId = surfaceRef.slice('workspace:'.length);
        const canvasId = await _props.ensureWorkspaceCanvas?.(workspaceId);
        if (pinGeneration.current !== generation) return;
        if (canvasId === undefined) { setPinNote('目标现场还没有可用画布'); return; }
        const loaded = await useCanvasStore.getState().switchCanvas(canvasId);
        if (pinGeneration.current !== generation) return;
        if (!loaded) { setPinNote('未能读取目标现场，请重试'); return; }
        const surface = _props.surfaceByWorkspace?.get(workspaceId);
        if (surface !== undefined) setActiveSurface(surface);
        navigate(`/projects/${encodeURIComponent(invocationProjectId)}/${surface ?? 'main'}?workspaceId=${encodeURIComponent(workspaceId)}`, { replace: true });
        return;
      }
      setPinNote('该颜色组目标暂不支持前往');
    } catch (error: unknown) {
      if (pinGeneration.current !== generation) return;
      if (isAbortLikeV1(error)) return;
      setPinNote(`前往失败${error instanceof Error ? `（${error.message}）` : ''}`);
    } finally {
      if (pinGeneration.current === generation) setPinBusy(false);
    }
  };

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
        onActivatePin={(pin) => {
          setPinPaletteOpen(false);
          setPinNote(undefined);
          setOpenPinId((current) => (current === pin.id ? undefined : pin.id));
        }}
        onCreatePin={() => {
          setOpenPinId(undefined);
          setPinNote(undefined);
          setPinPaletteOpen((open) => !open);
        }}
        createPinDisabled={pinBusy}
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

      {/* R6 ColorPin：标记当前现场（many-to-many；调色板值直接来自设计 token，canonical #RRGGBB） */}
      {pinPaletteOpen && (
        <div
          data-lcos-color-pin-palette
          data-lcos-color-pin-target={surfaceTargetRef?.id ?? ''}
          data-lcos-color-pin-target-kind={surfaceTargetRef?.kind ?? ''}
          data-lcos-color-pin-target-state={surfaceTargetRef === undefined ? 'unavailable' : 'resolved'}
          className="mt-2 rounded-xl p-2"
          style={{ ...lcosGlassStyle, width: 260 }}
        >
          <p className="px-2 pb-1 text-xs" style={{ color: lcosTokens.color.muted }}>把当前现场标为颜色组</p>
          {surfaceTargetRef === undefined ? (
            // fail closed：解析不出唯一 canonical target 时绝不写一个「大概是这里」的目标。
            <p data-lcos-color-pin-target-unavailable className="px-2 py-1 text-xs" style={{ color: lcosTokens.color.danger }}>
              {surfaceTargetReason ?? '当前现场无法解析为 canonical surface'}
            </p>
          ) : (
            <>
              <p data-lcos-color-pin-target-ref className="px-2 pb-1 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                {surfaceTargetRef.id}
              </p>
              {palette === undefined ? (
                <p className="px-2 py-1 text-xs" style={{ color: lcosTokens.color.danger }}>调色板不可用（设计 token 未加载）</p>
              ) : (
                <div className="flex items-center gap-2 px-2 py-1">
                  {paletteTonesV1().map((tone) => {
                    // 已属于该颜色组的 swatch 只标 assigned（禁止重复）；**其它颜色仍可继续标记**。
                    const assigned = assignedPaletteColors.has(palette[tone]);
                    return (
                      <button
                        key={tone}
                        type="button"
                        data-lcos-color-pin-swatch={tone}
                        data-lcos-color-pin-swatch-assigned={assigned ? 'true' : 'false'}
                        aria-label={assigned ? `${tone} · 已属于该颜色组` : `标为 ${tone}`}
                        aria-pressed={assigned}
                        title={assigned ? `${tone} · 已属于该颜色组` : `标为 ${tone}`}
                        disabled={pinBusy || assigned}
                        onClick={() => assignPin(tone)}
                        className="h-8 w-8 rounded-full disabled:opacity-40"
                        style={{ background: palette[tone], minHeight: 32, minWidth: 32 }}
                      />
                    );
                  })}
                </div>
              )}
              {currentSurfaceMemberships.length > 0 && (
                <div className="flex flex-col gap-0.5 pt-1">
                  {currentSurfaceMemberships.map((membership) => (
                    <button
                      key={membership.id}
                      type="button"
                      data-lcos-color-pin-remove-current={membership.colorPinId}
                      disabled={pinBusy}
                      onClick={() => removeMembership(membership.id)}
                      className="w-full rounded-lg px-2 py-1 text-left text-xs"
                      style={{ color: lcosTokens.color.danger, minHeight: 32 }}
                    >
                      移除 {definitionsById.get(membership.colorPinId)?.color ?? membership.colorPinId}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* R6 ColorPin：颜色组成员 + canonical resolve 前往 */}
      {openPinId !== undefined && (
        <div data-lcos-color-pin-members className="mt-2 max-h-[40vh] overflow-y-auto rounded-xl p-2" style={{ ...lcosGlassStyle, width: 320 }}>
          <p className="px-2 pb-1 text-xs" style={{ color: lcosTokens.color.muted }}>
            {(definitionsById.get(openPinId)?.label ?? '颜色组')} · 成员 {(membershipsByPin.get(openPinId) ?? []).length}
          </p>
          {(membershipsByPin.get(openPinId) ?? []).length === 0 && (
            <p className="px-2 py-1 text-xs" style={{ color: lcosTokens.color.muted }}>这个颜色组还没有成员</p>
          )}
          {(membershipsByPin.get(openPinId) ?? []).map((membership) => (
            <div key={membership.id} data-lcos-color-pin-member={membership.id} className="flex items-center gap-1 px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-xs" style={{ color: lcosTokens.color.text }}>
                {membership.targetRef.kind} · {membership.targetRef.id}
              </span>
              <button
                type="button"
                data-lcos-color-pin-travel
                disabled={pinBusy}
                onClick={() => { void travelToMembership(membership); }}
                className="shrink-0 rounded-full px-2 py-1 text-xs"
                style={{ color: lcosTokens.color.info, minHeight: 32 }}
              >
                前往
              </button>
              <button
                type="button"
                data-lcos-color-pin-remove
                disabled={pinBusy}
                onClick={() => removeMembership(membership.id)}
                className="shrink-0 rounded-full px-2 py-1 text-xs"
                style={{ color: lcosTokens.color.danger, minHeight: 32 }}
              >
                移除
              </button>
            </div>
          ))}
        </div>
      )}

      {pinNote !== undefined && (
        <div
          data-lcos-color-pin-note
          className="mt-2 max-w-[90vw] rounded-xl px-4 py-2 text-xs"
          style={{ ...lcosGlassStyle, color: lcosTokens.color.muted }}
          aria-live="polite"
        >
          {pinNote}
        </div>
      )}
    </div>
  );
}
