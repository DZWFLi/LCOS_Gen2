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

import { fitBoundsWithInsets, type SafeInsets } from '@local-creative-os/web-gen2';
import { useReactFlow, useViewport } from '@xyflow/react';
import { useEffect, useRef } from 'react';


import { focusNodesOnCanvas } from '@/components/Panels/CanvasLayerPanel/focusNodesOnCanvas';
import useCanvasStore from '@/store/canvasStore';

import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';

import type { Node } from '@xyflow/react';

/** HUD / Composer / Dock 在屏幕上的占用（对齐 R1 族的真实几何 + 24 边距）。 */
const HUD_INSETS: SafeInsets = {
  left: 24 + 52 + 16, // Railway 宽 52 + 左右呼吸
  right: 24 + 24,
  top: 24 + 48 + 16, // NavigatorIsland 高 48
  bottom: 24 + 56 + 16, // Composer 高约 56
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
  const registeredBindingCount = useLcosReferenceStore((s) => s.nodeEntityRefs.size);
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
        const expected = Math.max(useLcosReferenceStore.getState().nodeEntityRefs.size, 1);
        const framed = framedRef.current;
        const sameCanvas = framed.canvasId === canvasId;
        // 需要取景：换画布，或内容还没补齐到"已登记绑定数"。
        const needFrame = !sameCanvas || (framed.count < expected && nodes.length > framed.count);
        // 尺寸未齐（例如从服务端加载的节点既没有 measured 也没有 style）时先等一会儿，
        // 但必须有上限 —— 否则"视口外节点永不渲染 → 永无量到的尺寸"会死锁成空首屏。
        const allSized = nodes.every(hasKnownSize);
        if (needFrame && (allSized || tries >= 25)) {
          fitWithHud(0);
          framedRef.current = { canvasId, count: nodes.length };
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
    // 本现场内已投影：直接 focus 唯一 camera
    if (locateRequest.nodeId) {
      focusNodesOnCanvas(rf, [locateRequest.nodeId]);
    }
    consumeLocate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locateRequest?.reqId]);

  return (
    <span
      data-lcos-canvas-commands
      aria-hidden
      className="pointer-events-none absolute top-1 left-1 text-[10px] opacity-60"
      style={{ display: 'none' }}
    >
      {Math.round(viewport.zoom * 100)}%
    </span>
  );
}
