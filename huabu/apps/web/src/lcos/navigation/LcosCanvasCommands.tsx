// LcosCanvasCommands — 画布内命令消费者（canvas-local overlay）。
// 订阅 shell store 的 camera/locate 请求并作用于唯一 Huabu RF instance；
// 只调用 RF 相机命令（zoomIn/zoomOut/setViewport/focusNodesOnCanvas），
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
  type SafeInsets,
} from '@local-creative-os/web-gen2';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useEffect, useRef } from 'react';


import { focusNodesOnCanvas } from '@/components/Panels/CanvasLayerPanel/focusNodesOnCanvas';
import useCanvasStore from '@/store/canvasStore';

import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { lcosTokens } from '../ui/lcosTokens';

import type { Node } from '@xyflow/react';

/** HUD / Composer / Dock 在屏幕上的占用（对齐 R1 族的真实几何 + 24 边距）。 */
const HUD_INSETS: SafeInsets = {
  left: 24 + 52 + 16, // Railway 宽 52 + 左右呼吸
  right: 24 + 24,
  top: 24 + 48 + 16, // NavigatorIsland 高 48
  bottom: 24 + 56 + 16, // Composer 高约 56
};

const LOCATOR_SAFE_INSETS = {
  left: HUD_INSETS.left,
  right: HUD_INSETS.right,
  top: HUD_INSETS.top,
  bottom: HUD_INSETS.bottom,
};

interface Box {
  width: number;
  height: number;
}

function boxOf(node: Node): Box {
  const raw = node as unknown as {
    measured?: { width?: number; height?: number };
    width?: number;
    height?: number;
    style?: { width?: number | string; height?: number | string };
  };
  const num = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  return {
    width: num(raw.measured?.width) ?? num(raw.width) ?? num(raw.style?.width) ?? 280,
    height: num(raw.measured?.height) ?? num(raw.height) ?? num(raw.style?.height) ?? 200,
  };
}

/** 全部节点的真实包围盒（无节点返回 null）。 */
function contentBounds(nodes: readonly Node[]): { x: number; y: number; width: number; height: number } | null {
  if (nodes.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const box = boxOf(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + box.width);
    maxY = Math.max(maxY, node.position.y + box.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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
  const consumeCamera = useLcosShellStore((s) => s.consumeCamera);
  const consumeLocate = useLcosShellStore((s) => s.consumeLocate);
  const activeSurface = useLcosShellStore((s) => s.activeSurface);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const nodeCount = useCanvasStore((s) => s.nodes.length);
  const rf = useReactFlow();
  const viewport = useViewport();

  /** 安全取景：节点真实包围盒 + HUD 安全边距 + 可读性 zoom 上限。 */
  const fitWithHud = (duration = 0): void => {
    const nodes = useCanvasStore.getState().nodes;
    const bounds = contentBounds(nodes);
    const size = document.querySelector('.react-flow')?.getBoundingClientRect();
    if (!size || size.width <= 0) return;
    const result = fitBoundsWithInsets(bounds, { width: size.width, height: size.height }, HUD_INSETS);
    rf.setViewport(result, duration > 0 ? { duration } : undefined);
  };

  useEffect(() => {
    if (!cameraRequest) return;
    switch (cameraRequest.kind) {
      case 'zoom-in':
        rf.zoomIn({ duration: 220 });
        break;
      case 'zoom-out':
        rf.zoomOut({ duration: 220 });
        break;
      case 'fit':
        fitWithHud(380);
        break;
      case 'reset':
        rf.setViewport({ x: 0, y: 0, zoom: 1 }, { duration: 380 });
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
    let cancelled = false;
    let tries = 0;

    const attempt = (): void => {
      if (cancelled) return;
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
  }, [canvasId, nodeCount, canvasLoading, registeredBindingCount, rf]);

  useEffect(() => {
    if (!locateRequest || locateRequest.surface !== activeSurface) return;
    if (locateRequest.canvasId && locateRequest.canvasId !== canvasId) return;
    // 本现场内已投影：直接 focus 唯一 camera
    if (locateRequest.nodeId && useCanvasStore.getState().nodes.some((node) => node.id === locateRequest.nodeId)) {
      focusNodesOnCanvas(rf, [locateRequest.nodeId]);
    }
    // Keep the request alive for the same camera settle window as the focus
    // animation. The locator cue is rendered from this request; consuming it
    // synchronously would make the cue disappear before the user can perceive
    // where the object is travelling from.
    const timer = window.setTimeout(() => consumeLocate(), 900);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateRequest?.reqId, activeSurface, canvasId]);

  return (
    <>
      <span
        data-lcos-canvas-commands
        aria-hidden
        className="pointer-events-none absolute top-1 left-1 text-[10px] opacity-60"
        style={{ display: 'none' }}
      >
        {Math.round(viewport.zoom * 100)}%
      </span>
      <LcosLocatorCue
        request={locateRequest}
        activeSurface={activeSurface}
        canvasId={canvasId}
        rf={rf}
        viewport={viewport}
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
}: {
  readonly request: ReturnType<typeof useLcosShellStore.getState>['locateRequest'];
  readonly activeSurface: ReturnType<typeof useLcosShellStore.getState>['activeSurface'];
  readonly canvasId: string | null | undefined;
  readonly rf: ReturnType<typeof useReactFlow>;
  readonly viewport: ReturnType<typeof useViewport>;
}): React.JSX.Element | null {
  if (!request || request.surface !== activeSurface) return null;
  if (request.canvasId !== undefined && request.canvasId !== canvasId) return null;

  const root = document.querySelector('.react-flow');
  if (!(root instanceof HTMLElement)) return null;
  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return null;

  if (request.status === 'unavailable') {
    return (
      <div
        data-lcos-locator="unavailable"
        role="status"
        className="pointer-events-none fixed z-[65] rounded-full px-3 py-2 text-xs font-medium"
        style={{
          left: rootRect.left + rootRect.width / 2,
          top: rootRect.top + 24,
          transform: 'translateX(-50%)',
          background: lcosTokens.color.inverse,
          color: lcosTokens.color.textOnInverse,
          boxShadow: lcosTokens.glass.shadow,
        }}
      >
        这个对象暂时无法定位
      </div>
    );
  }

  if (!request.nodeId) return null;
  const internal = rf.getInternalNode(request.nodeId);
  if (!internal || internal.hidden) return null;
  const width = internal.measured.width ?? internal.width ?? internal.initialWidth ?? 280;
  const height = internal.measured.height ?? internal.height ?? internal.initialHeight ?? 200;
  const targetRect = {
    x: rootRect.left + internal.internals.positionAbsolute.x * viewport.zoom + viewport.x,
    y: rootRect.top + internal.internals.positionAbsolute.y * viewport.zoom + viewport.y,
    width: width * viewport.zoom,
    height: height * viewport.zoom,
  };
  const professionalStage = document.querySelector('[data-lcos-professional-stage]');
  const professionalRect = professionalStage instanceof HTMLElement
    ? professionalStage.getBoundingClientRect()
    : undefined;
  const rightInset = professionalRect !== undefined && professionalRect.left > rootRect.left
    ? Math.max(LOCATOR_SAFE_INSETS.right, rootRect.right - professionalRect.left + 16)
    : LOCATOR_SAFE_INSETS.right;
  const safeLeft = rootRect.left + LOCATOR_SAFE_INSETS.left;
  const safeTop = rootRect.top + LOCATOR_SAFE_INSETS.top;
  const safeRect = {
    left: safeLeft,
    top: safeTop,
    // On a narrow viewport a professional window can consume almost the
    // entire width. Keep a one-pixel mathematical safe rect instead of
    // feeding an inverted rectangle into the pure geometry function.
    right: Math.max(safeLeft + 1, rootRect.right - rightInset),
    bottom: Math.max(safeTop + 1, rootRect.bottom - LOCATOR_SAFE_INSETS.bottom),
  };
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
  if (geometry.state === 'local') return null;

  const anchor = geometry.edgeAnchor ?? geometry.directionAnchor ?? geometry.targetCenter;
  const angle = Math.atan2(geometry.direction.y, geometry.direction.x) * 180 / Math.PI;
  return (
    <div
      data-lcos-locator={geometry.state}
      role="status"
      aria-label={geometry.state === 'edge' ? '目标在画外，正在抵达' : '目标接近画布边缘'}
      className="pointer-events-none fixed z-[65] flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium"
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: 'translate(-50%, -50%)',
          background: lcosTokens.color.inverse,
          color: lcosTokens.color.textOnInverse,
          boxShadow: lcosTokens.glass.shadow,
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-block',
          width: 0,
          height: 0,
          borderTop: '4px solid transparent',
          borderBottom: '4px solid transparent',
          borderLeft: '6px solid currentColor',
          transform: `rotate(${angle}deg)`,
        }}
      />
      {geometry.state === 'edge' ? '正在定位' : '目标在边缘'}
    </div>
  );
}
