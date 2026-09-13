// useLcosDensity — LCOS 节点信息密度唯一解析入口（Wave 9 收口）。
//
// 密度只有一个来源：Huabu NodeWrapper 经 `@/lcos-seam/nodePresentation` 发布的
// 中性呈现输入（world 尺寸 × zoom → 屏幕像素 + DPR + 交互 phase），交给
// web-gen2 的 `resolvePresentationDensity` 判定。物种 body 不再各自维护
// "按 zoom 拍脑袋" 的阶梯——那会让同一块屏幕上大节点和小节点显示同一档信息。
//
// 两条降级：
//   1. 无呈现上下文（预览/测试等不在 NodeWrapper 子树内）→ 退化为纯 zoom 阶梯。
//   2. 画布节点密度过高（80/150/300 档）→ 封顶信息档，避免整屏重内容。
//
// 只读呈现数据，不写任何 store；不做领域语义判断。

import { resolvePresentationDensity, type PresentationDensity } from '@local-creative-os/web-gen2';
import { useViewport } from '@xyflow/react';

import { useLcosNodePresentation } from '@/lcos-seam/nodePresentation';
import useCanvasStore from '@/store/canvasStore';

/** 无呈现上下文时的纯 zoom 阶梯（退化路径，非主判定）。 */
export function densityFromZoom(zoom: number): PresentationDensity {
  return zoom < 0.25 ? 'mark' : zoom < 0.55 ? 'summary' : zoom < 0.9 ? 'working' : 'reading';
}

/**
 * 节点总数 → 密度封顶档。null = 不封顶。
 * 80 以下不干预；150 以上封到 working（去掉 reading 档的长正文）；
 * 300 以上封到 summary（只留身份+角标）。
 */
export function densityCapForNodeCount(nodeCount: number): PresentationDensity | null {
  if (nodeCount > 300) return 'summary';
  if (nodeCount > 150) return 'working';
  return null;
}

const DENSITY_RANK: Readonly<Record<PresentationDensity, number>> = {
  mark: 0,
  summary: 1,
  working: 2,
  reading: 3,
};

/** 把已解析密度压到封顶档，绝不向上提升。 */
export function capDensity(
  density: PresentationDensity,
  cap: PresentationDensity | null,
): PresentationDensity {
  if (!cap) return density;
  return DENSITY_RANK[density] <= DENSITY_RANK[cap] ? density : cap;
}

/** 当前节点应呈现的信息档。 */
export function useLcosDensity(): PresentationDensity {
  const presentation = useLcosNodePresentation();
  const { zoom } = useViewport();
  const nodeCount = useCanvasStore((s) => s.nodes.length);

  const resolved = presentation
    ? resolvePresentationDensity({
        worldWidth: presentation.worldWidth,
        worldHeight: presentation.worldHeight,
        zoom: presentation.zoom,
        dpr: presentation.dpr,
        screenWidth: presentation.screenWidth,
        screenHeight: presentation.screenHeight,
        phase: presentation.phase,
      })
    : densityFromZoom(zoom);

  return capDensity(resolved, densityCapForNodeCount(nodeCount));
}
