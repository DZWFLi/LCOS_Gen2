// LcosCanvasCommands — 画布内命令消费者（canvas-local overlay）。
// 订阅 shell store 的 camera/locate 请求并作用于唯一 Huabu RF instance；
// 只调用 RF 相机命令（zoomIn/zoomOut/setViewport/locateNodesOnCanvas），
// 不建立第二 camera、不读写 node geometry truth。
//
// R2 返工：`fit` 不再用 RF 的裸 fitView（那会把内容很少的画布放大到 217%~348%，
// 文字不可读），改用 GEN2 的纯函数 `fitBoundsWithInsets`：
//   - 取**真实节点包围盒**（store 里的 position + 真实尺寸）；
//   - 让出 HUD / Composer / Dock 的安全边距（这些是屏幕空间浮层，落位算法看不见它们）；
//   - zoom 有可读性上限（默认 1.25）。
// 项目打开后首次拿到节点时做同样的一次取景，作为"首屏构图"。

import {
  computeLocatorGeometry,
  fitBoundsWithInsets,
  initialArrivalState,
  initialLocatorState,
  placeLocatorAnchorOutsideObstacles,
  reduceArrivalState,
  reduceLocatorState,
  toScreenRect,
  type ArrivalState,
  type LocatorState,
} from '@local-creative-os/web-gen2';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useEffect, useReducer, useRef, useState } from 'react';


import {
  locateNodesOnCanvas,
  getReliableNodeBounds,
} from '@/components/Panels/CanvasLayerPanel/focusNodesOnCanvas';
import useCanvasStore from '@/store/canvasStore';

import { cameraFitInsets } from './hudWindowGeometry';
import { LcosPersistentLocatorOverlay } from './LcosPersistentLocatorOverlay';
import { LcosSpatialCursorMark } from './LcosSpatialCursorMark';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';
import { useReducedSpatialMotion } from '../ui/motion/useReducedSpatialMotion';

import type { Node } from '@xyflow/react';

const ARRIVAL_LIFETIME_MS = 720;

interface ArrivalTarget {
  readonly surface: ReturnType<typeof useLcosShellStore.getState>['activeSurface'];
  readonly canvasId: string;
  readonly nodeId: string;
  readonly reqId: string;
}

type LocatorScreenRect = ReturnType<typeof toScreenRect>;

function canvasScreenRect(rect: DOMRect): LocatorScreenRect {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function intersectScreenRect(a: LocatorScreenRect, b: LocatorScreenRect): LocatorScreenRect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  return {
    left,
    top,
    right: Math.max(left + 1, Math.min(a.right, b.right)),
    bottom: Math.max(top + 1, Math.min(a.bottom, b.bottom)),
  };
}

/**
 * 该节点是否已有**已知尺寸**。
 *
 * 不能只看 `measured`：Canvas 开了 `onlyRenderVisibleElements`，视口外的节点根本不渲染、
 * 永远拿不到 `measured`；只等 measured 会永远等不到（实测 7 个节点只有 2 个进 DOM，
 * 取景死等超时，首屏停在 1.46 倍，剩下 5 个节点一直不出现）。
 * 引擎在建节点时就把**真实尺寸**写进 `style`（CREATE 回执 width/height），
 * 所以 `measured ?? style` 才是完整事实。
 */
function hasKnownSize(node: Node): boolean {
  const raw = node as unknown as {
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
    style?: { width?: number | string; height?: number | string };
  };
  const positive = (value: unknown): boolean =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (positive(raw.measured?.width) && positive(raw.measured?.height)) return true;
  if (positive(raw.width) && positive(raw.height)) return true;
  return positive(raw.style?.width) && positive(raw.style?.height);
}

export function LcosCanvasCommands(): React.JSX.Element {
  const cameraRequest = useLcosShellStore((s) => s.cameraRequest);
  const locateRequest = useLcosShellStore((s) => s.locateRequest);
  const windowEnvironment = useLcosShellStore((s) => s.windowEnvironment);
  const consumeCamera = useLcosShellStore((s) => s.consumeCamera);
  const consumeLocate = useLcosShellStore((s) => s.consumeLocate);
  const worksiteCameraTransition = useLcosShellStore((s) => s.worksiteCameraTransition);
  const consumeWorksiteCameraTransition = useLcosShellStore((s) => s.consumeWorksiteCameraTransition);
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const nodeCount = useCanvasStore((s) => s.nodes.length);
  const rf = useReactFlow();
  const viewport = useViewport();
  const [locatorState, dispatchLocator] = useReducer(
    reduceLocatorState,
    initialLocatorState,
  );
  const [arrivalState, dispatchArrival] = useReducer(
    reduceArrivalState,
    initialArrivalState,
  );
  const [arrivalTarget, setArrivalTarget] = useState<ArrivalTarget | null>(null);
  const locateGeneration = useRef(0);
  const arrivalTimer = useRef<number | null>(null);
  const transitionSettledCanvas = useRef<string | null>(null);
  const reducedMotion = useReducedSpatialMotion();

  const cancelArrivalTimer = (): void => {
    if (arrivalTimer.current !== null) {
      window.clearTimeout(arrivalTimer.current);
      arrivalTimer.current = null;
    }
  };

  /** 安全取景：节点真实包围盒 + HUD 安全边距 + 可读性 zoom 上限。 */
  const fitWithHud = (duration = 0): void => {
    const nodes = useCanvasStore.getState().nodes;
    const bounds = getReliableNodeBounds(rf, nodes.filter((node) => !node.hidden).map((node) => node.id));
    const size = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!size || size.width <= 0) return;
    const insets = cameraFitInsets({ x: size.left, y: size.top, width: size.width, height: size.height }, useLcosShellStore.getState().windowEnvironment);
    if (!insets) return; // All available regions are covered; never fit content behind a window.
    const result = fitBoundsWithInsets(bounds, { width: size.width, height: size.height }, insets);
    rf.setViewport(result, duration > 0 ? { duration } : undefined);
  };

  useEffect(() => {
    const transition = worksiteCameraTransition;
    if (transition === null || transition.canvasId !== canvasId) return;
    // Canvas loading publishes its ID before the child helper can attach the
    // loaded camera. This is a pending intent, not an empty one to consume.
    if (transition.targetViewport === undefined) {
      // Return navigation owns completion, including legacy returns with no pose.
      return;
    }
    const targetViewport = transition.targetViewport;

    let active = true;
    const duration = reducedMotion
      ? 0
      : transition.kind === 'return-restore'
        ? 360
        : 300;
    void rf.setViewport(
      targetViewport,
      duration > 0 ? { duration } : undefined,
    ).then(() => {
      if (!active) return;
      const shell = useLcosShellStore.getState();
      if (shell.worksiteCameraTransition?.id !== transition.id) return;
      if (useCanvasStore.getState().canvasId !== transition.canvasId) return;
      useCanvasStore.getState().setViewport(targetViewport);
      transitionSettledCanvas.current = transition.canvasId;
      if (transition.kind !== 'return-restore') consumeWorksiteCameraTransition(transition.id);
    }).catch(() => {
      // RF can reject when a newer camera request interrupts this promise.
      // Only the still-current request may be consumed here; a newer request
      // owns the next visible state and must remain intact.
      if (transition.kind !== 'return-restore' && useLcosShellStore.getState().worksiteCameraTransition?.id === transition.id) {
        consumeWorksiteCameraTransition(transition.id);
      }
    });
    return () => { active = false; };
  }, [
    canvasId,
    consumeWorksiteCameraTransition,
    reducedMotion,
    rf,
    worksiteCameraTransition,
  ]);

  useEffect(() => {
    if (!cameraRequest) return;
    switch (cameraRequest.kind) {
      case 'zoom-in':
        rf.zoomIn({ duration: reducedMotion ? 0 : 220 });
        break;
      case 'zoom-out':
        rf.zoomOut({ duration: reducedMotion ? 0 : 220 });
        break;
      case 'fit':
        fitWithHud(reducedMotion ? 0 : 380);
        break;
      case 'reset':
        rf.zoomTo(1, { duration: reducedMotion ? 0 : 380 });
        break;
    }
    consumeCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraRequest, rf, consumeCamera]);

  // 首屏构图：**在内容补齐期内跟随取景**，补齐之后永久交还相机。
  //
  // 为什么不是"只取一次"：
  //   1) Huabu 自己有 `useInitialCanvasViewport`（只 fit 少数 nodeIdsToFit、不考虑 HUD 安全边距，
  //      实测会把 2 个节点放大到 1.71 倍），它运行期间 `.react-flow` 带 `invisible` 类 —— 必须等它结束；
  //   2) R2 投影是**服务端 RFS 写**，浏览器画布 store 明显滞后（实测 reconcile 结束时 store 里只有
  //      1 个节点，而 bindings 已有 7 条），其余节点还落在视口外；Canvas 又开了
  //      `onlyRenderVisibleElements`，视口外的节点永远不会渲染 —— 于是"只取一次"会把首屏
  //      定死在"只看见 1 个节点"上，永远等不到剩下的内容。
  // 因此：只要**已登记的绑定数还没全部落到画面上**，就允许跟随内容继续取景；
  // 一旦补齐，相机永久交还用户。全程只调用 RF 相机命令，不写任何节点数据。
  const framedRef = useRef<{ canvasId: string | null; count: number }>({
    canvasId: null,
    count: 0,
  });
  // 已登记的 Core 绑定数：绑定到达时触发一次重估（内容可能还没同步到 store）。
  const registeredNodeIds = useLcosReferenceStore((s) => s.nodeEntityRefs);
  const registeredBindingCount = registeredNodeIds.size;
  const canvasLoading = useCanvasStore((s) => s.isLoading);
  useEffect(() => {
    if (canvasId === undefined || canvasLoading) return;
    if (worksiteCameraTransition) return;
    if (transitionSettledCanvas.current === canvasId) return;
    let cancelled = false;
    let tries = 0;

    const attempt = (): void => {
      if (cancelled || useLcosShellStore.getState().worksiteCameraTransition) return;
      const nodes = useCanvasStore.getState().nodes;
      const surface = document.querySelector('.react-flow');
      if (nodes.length > 0 && surface !== null && !surface.classList.contains('invisible')) {
        const expected = registeredNodeIds.size;
        // The Gen2 route registers bindings only after reconcile has completed.
        // Fitting before that point races the SSE snapshot and permanently
        // frames the first partial batch. An empty projection has no content
        // to frame, so waiting here is also the honest empty-canvas behavior.
        if (expected === 0) return;
        const presentIds = new Set(nodes.map((node) => node.id));
        const allProjectedNodesPresent = [...registeredNodeIds.keys()].every((id) => presentIds.has(id));
        const framed = framedRef.current;
        const sameCanvas = framed.canvasId === canvasId;
        // One fit after all registered projection nodes have arrived. The
        // binding ids are the completion signal; total node count can include
        // unrelated native nodes and therefore cannot prove projection ready.
        const needFrame = !sameCanvas || framed.count < expected;
        // 尺寸未齐（例如从服务端加载的节点既没有 measured 也没有 style）时先等一会儿，
        // 但必须有上限 —— 否则"视口外节点永不渲染 → 永无量到的尺寸"会死锁成空首屏。
        const allSized = nodes.every(hasKnownSize);
        if (needFrame && allProjectedNodesPresent && allSized) {
          fitWithHud(0);
          framedRef.current = { canvasId, count: expected };
          return;
        }
      }
      tries += 1;
      if (tries < 60) window.setTimeout(attempt, 150);
    };

    window.setTimeout(attempt, 120);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, nodeCount, canvasLoading, registeredBindingCount, rf, worksiteCameraTransition]);

  useEffect(() => {
    if (!locateRequest || locateRequest.surface !== activeSurface) return;
    if (locateRequest.canvasId && locateRequest.canvasId !== canvasId) return;

    const request = locateRequest;
    const requestedNodeIds = request.nodeIds ?? (request.nodeId === undefined ? [] : [request.nodeId]);
    const presentNodeIds = requestedNodeIds.filter((requestedNodeId) => {
      const node = useCanvasStore.getState().nodes.find((candidate) => candidate.id === requestedNodeId);
      return node !== undefined && node.hidden !== true;
    });
    const nodeId = request.nodeId !== undefined && presentNodeIds.includes(request.nodeId)
      ? request.nodeId
      : presentNodeIds[0];
    const generation = locateGeneration.current + 1;
    locateGeneration.current = generation;
    cancelArrivalTimer();
    dispatchLocator({ type: 'locate-requested' });
    dispatchArrival({ type: 'travel-start' });
    setArrivalTarget(
      nodeId && canvasId
        ? { surface: request.surface, canvasId, nodeId, reqId: request.reqId }
        : null,
    );

    if (nodeId === undefined || presentNodeIds.length === 0) {
      dispatchLocator({ type: request.status === 'unavailable' ? 'target-unavailable' : 'target-gone' });
      dispatchArrival({ type: 'cancel' });
      setArrivalTarget(null);
      if (request.status !== 'unavailable') consumeLocate();
      return;
    }

    let active = true;
    let completed = false;
    const cancelForUserGesture = (): void => {
      if (!active || locateGeneration.current !== generation) return;
      active = false;
      locateGeneration.current += 1;
      cancelArrivalTimer();
      dispatchLocator({ type: 'cancel' });
      dispatchArrival({ type: 'cancel' });
      setArrivalTarget(null);
      // A user gesture wins over an in-flight camera request. Clear only the
      // request this consumer started; a newer request must survive.
      if (useLcosShellStore.getState().locateRequest?.reqId === request.reqId) {
        consumeLocate();
      }
    };
    const flowRoot = document.querySelector('.react-flow');
    flowRoot?.addEventListener('pointerdown', cancelForUserGesture);
    flowRoot?.addEventListener('wheel', cancelForUserGesture, { passive: true });
    flowRoot?.addEventListener('touchstart', cancelForUserGesture, { passive: true });
    // Selection and camera share the same Huabu canvas-local owner. Temporal
    // grouping never creates a second selection/store/camera path.
    if (!request.preserveSelection) useCanvasStore.getState().selectNodes(presentNodeIds);
    const flowRect = flowRoot?.getBoundingClientRect();
    const rootSafeRect = flowRect === undefined
      ? undefined
      : canvasScreenRect(flowRect);
    const publishedSafeRect = windowEnvironment === null
      ? rootSafeRect
      : toScreenRect(windowEnvironment.safeRect);
    const focus = flowRect === undefined || rootSafeRect === undefined || publishedSafeRect === undefined
      ? Promise.resolve(false)
      : locateNodesOnCanvas(rf, presentNodeIds, {
          canvasRect: rootSafeRect,
          safeRect: intersectScreenRect(rootSafeRect, publishedSafeRect),
          duration: reducedMotion ? 0 : 800,
          padding: 24,
        });
    void focus.then((settled) => {
      if (!active || locateGeneration.current !== generation) return;
      if (!settled) {
        dispatchLocator({ type: 'target-gone' });
        dispatchArrival({ type: 'cancel' });
        setArrivalTarget(null);
        if (useLcosShellStore.getState().locateRequest?.reqId === request.reqId) {
          consumeLocate();
        }
        return;
      }

      // The locate helper resolves from Huabu's setViewport promise. Arrival is
      // therefore driven by the actual camera settle, never by a guessed
      // timeout. The request remains alive until the target-local cue closes.
      dispatchLocator({ type: 'camera-settled' });
      dispatchArrival({ type: 'camera-settled' });
      cancelArrivalTimer();
      arrivalTimer.current = window.setTimeout(() => {
        if (locateGeneration.current !== generation) return;
        completed = true;
        dispatchLocator({ type: 'arrival-done' });
        dispatchArrival({ type: 'arrival-complete' });
        setArrivalTarget(null);
        consumeLocate();
        arrivalTimer.current = null;
      }, ARRIVAL_LIFETIME_MS);
    });

    return () => {
      active = false;
      flowRoot?.removeEventListener('pointerdown', cancelForUserGesture);
      flowRoot?.removeEventListener('wheel', cancelForUserGesture);
      flowRoot?.removeEventListener('touchstart', cancelForUserGesture);
      if (completed) return;
      locateGeneration.current += 1;
      cancelArrivalTimer();
      dispatchLocator({ type: 'cancel' });
      dispatchArrival({ type: 'cancel' });
      setArrivalTarget(null);
    };
    // The shell request is the existing locate command seam; all state below
    // is transient presentation state owned by this canvas-local consumer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateRequest?.reqId, activeSurface, canvasId, rf]);

  useEffect(() => () => {
    cancelArrivalTimer();
  }, []);

  return (
    <>
      <span
        data-lcos-canvas-commands
        data-lcos-locator-phase={locatorState.phase}
        data-lcos-arrival-phase={arrivalState.phase}
        aria-hidden
        className="pointer-events-none absolute top-1 left-1 text-[10px] opacity-60"
        style={{ display: 'none' }}
      >
        {Math.round(viewport.zoom * 100)}%
      </span>
      <LcosPersistentLocatorOverlay />
      <LcosLocatorCue
        request={locateRequest}
        activeSurface={activeSurface}
        canvasId={canvasId}
        rf={rf}
        viewport={viewport}
        locatorState={locatorState}
        arrivalState={arrivalState}
        arrivalTarget={arrivalTarget}
        windowEnvironment={windowEnvironment}
      />
    </>
  );
}

function LcosLocatorCue({
  request,
  activeSurface,
  canvasId,
  rf,
  viewport,
  locatorState,
  arrivalState,
  arrivalTarget,
  windowEnvironment,
}: {
  readonly request: ReturnType<typeof useLcosShellStore.getState>['locateRequest'];
  readonly activeSurface: ReturnType<typeof useLcosShellStore.getState>['activeSurface'];
  readonly canvasId: string | null | undefined;
  readonly rf: ReturnType<typeof useReactFlow>;
  readonly viewport: ReturnType<typeof useViewport>;
  readonly locatorState: LocatorState;
  readonly arrivalState: ArrivalState;
  readonly arrivalTarget: ArrivalTarget | null;
  readonly windowEnvironment: ReturnType<typeof useLcosShellStore.getState>['windowEnvironment'];
}): React.JSX.Element | null {
  const presentationRequest = request ?? (
    arrivalTarget === null
      ? null
      : {
          reqId: arrivalTarget.reqId,
          surface: arrivalTarget.surface,
          canvasId: arrivalTarget.canvasId,
          nodeId: arrivalTarget.nodeId,
          status: 'projected' as const,
        }
  );
  if (!presentationRequest || presentationRequest.surface !== activeSurface) return null;
  if (presentationRequest.canvasId !== undefined && presentationRequest.canvasId !== canvasId) return null;

  const root = document.querySelector('.react-flow');
  if (!(root instanceof HTMLElement)) return null;
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return null;

  if (presentationRequest.status === 'unavailable' || locatorState.phase === 'unavailable') {
    return (
      <div
        data-lcos-locator="unavailable"
        role="status"
        className="pointer-events-none fixed z-[65] rounded-full px-3 py-2 text-xs font-medium"
        style={{
          left: rootRect.left + rootRect.width / 2,
          top: rootRect.top + 24,
          transform: 'translateX(-50%)',
          background: 'rgba(255,255,255,.88)',
          color: lcosTokens.color.accent,
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,.8)',
          boxShadow: lcosTokens.glass.shadow,
        }}
      >
        这个对象暂时无法定位
      </div>
    );
  }

  if (!presentationRequest.nodeId) return null;
  const internal = rf.getInternalNode(presentationRequest.nodeId);
  if (!internal || internal.hidden) return null;
  const width = internal.measured.width ?? internal.width ?? internal.initialWidth ?? 280;
  const height = internal.measured.height ?? internal.height ?? internal.initialHeight ?? 200;
  const targetRect = {
    x: rootRect.left + internal.internals.positionAbsolute.x * viewport.zoom + viewport.x,
    y: rootRect.top + internal.internals.positionAbsolute.y * viewport.zoom + viewport.y,
    width: width * viewport.zoom,
    height: height * viewport.zoom,
  };
  const rootSafeRect = canvasScreenRect(rootRect);
  const safeRect = windowEnvironment === null
    ? rootSafeRect
    : intersectScreenRect(rootSafeRect, toScreenRect(windowEnvironment.safeRect));
  const occupiedRects = windowEnvironment?.occupiedRects.map(toScreenRect) ?? [];
  const geometry = computeLocatorGeometry({
    safeRect,
    targetRect: {
      left: targetRect.x,
      top: targetRect.y,
      right: targetRect.x + targetRect.width,
      bottom: targetRect.y + targetRect.height,
    },
    edgeInset: 12,
    nearEdgeDistance: 72,
  });

  if (arrivalState.phase === 'arriving' && arrivalTarget !== null) {
    return (
      <div
        data-lcos-arrival="arriving"
        data-lcos-arrival-node-id={arrivalTarget.nodeId}
        role="status"
        aria-label="已抵达目标"
        className="pointer-events-none fixed z-[65]"
        style={{
          left: targetRect.x,
          top: targetRect.y,
          width: targetRect.width,
          height: targetRect.height,
        }}
      >
        <span data-lcos-arrival-frame />
        <span data-lcos-arrival-cursor>
          <LcosSpatialCursorMark surface={activeSurface} phase="arrival" accent={lcosTokens.color.accent} />
        </span>
      </div>
    );
  }

  if (locatorState.phase === 'arriving' || locatorState.phase === 'hidden') return null;
  if (geometry.state === 'local') return null;

  const anchor = placeLocatorAnchorOutsideObstacles(
    geometry.edgeAnchor ?? geometry.directionAnchor ?? geometry.targetCenter,
    safeRect,
    occupiedRects,
    18,
  );
  const angle = Math.atan2(geometry.direction.y, geometry.direction.x) * 180 / Math.PI;
  return (
    <div
      data-lcos-locator={geometry.state}
      role="status"
      aria-label={geometry.state === 'edge' ? '目标在画外，正在抵达' : '目标接近画布边缘'}
      className="pointer-events-none fixed z-[65] grid h-11 w-11 place-items-center"
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: 'translate(-50%, -50%)',
      }}
    >
      <LcosSpatialCursorMark
        surface={activeSurface}
        phase={geometry.state}
        angleDeg={angle}
        progress={geometry.progress}
        accent={lcosTokens.color.accent}
      />
      <span className="sr-only">{geometry.state === 'edge' ? '正在定位' : '目标在边缘'}</span>
    </div>
  );
}
