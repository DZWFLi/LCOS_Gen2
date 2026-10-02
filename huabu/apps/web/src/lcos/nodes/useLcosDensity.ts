// useLcosDensity — LCOS 节点信息密度唯一解析入口（Wave 9 收口）。
//
// 密度只有一个来源：Huabu NodeWrapper 经 `@/lcos-seam/nodePresentation` 发布的
// 中性呈现输入（world 尺寸 × zoom → 屏幕像素 + DPR + 交互 phase），交给
// web-gen2 的 `resolvePresentationDensity` 判定。物种 body 不再各自维护
// "按 zoom 拍脑袋" 的阶梯——那会让同一块屏幕上大节点和小节点显示同一档信息。
//
// 两条降级：
//   1. 无呈现上下文（预览/测试等不在 NodeWrapper 子树内）→ 退化为纯 zoom 阶梯。
//   2. 可见画布节点密度过高（150/300 档）→ 封顶信息档，避免整屏重内容。
//
// 只读呈现数据，不写任何 store；不做领域语义判断。

import { resolveStablePresentationDensity, type PresentationDensity, type NodePresentationInput } from '@local-creative-os/web-gen2';
import { useStore, useViewport } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { densityFromZoom, finishPresentationDensity } from './densityBudget';
export { densityFromZoom, densityCapForNodeCount, capDensity } from './densityBudget';
import { visibleFlowNodeCount } from './visibleNodeCount';
import { SEMANTIC_ZOOM_CONFIG } from '@/config/semanticZoom';

import { useLcosNodePresentation } from '@/lcos-seam/nodePresentation';


/** 当前节点应呈现的信息档。 */
export function useLcosDensity(interactionPhase?: NodePresentationInput['phase']): PresentationDensity {
  const presentation = useLcosNodePresentation();
  const { zoom } = useViewport();
  const nodeCount = useStore(visibleFlowNodeCount);
  const phase = interactionPhase ?? presentation?.phase;
  const previous = useRef<PresentationDensity | undefined>(undefined);

  const resolved = presentation
    ? resolveStablePresentationDensity({
        worldWidth: presentation.worldWidth,
        worldHeight: presentation.worldHeight,
        zoom: presentation.zoom,
        dpr: presentation.dpr,
        screenWidth: presentation.screenWidth,
        screenHeight: presentation.screenHeight,
        phase: phase ?? presentation.phase,
      }, previous.current, SEMANTIC_ZOOM_CONFIG.hysteresis)
    : densityFromZoom(zoom);

  // Capacity only reduces background information, never the active editor.
  const result = finishPresentationDensity(resolved, nodeCount, phase);
  // Remember the uncapped result so population changes do not become zoom thresholds.
  useEffect(() => { previous.current = resolved; }, [resolved]);
  return result;
}
