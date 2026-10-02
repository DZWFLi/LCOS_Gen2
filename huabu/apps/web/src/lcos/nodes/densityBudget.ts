import type { PresentationDensity, InteractionPhase } from '@local-creative-os/web-gen2';
/** 无呈现上下文时的纯 zoom 阶梯（退化路径，非主判定）。 */
export function densityFromZoom(zoom: number): PresentationDensity {
  return zoom < 0.25 ? 'mark' : zoom < 0.55 ? 'summary' : zoom < 0.9 ? 'working' : 'reading';
}

/**
 * 可见节点数 → 密度封顶档。null = 不封顶。
 * 150 以下不干预；150 以上封到 working（去掉 reading 档的长正文）；
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

/** Final active-work override. Capacity affects background content only. */
export function finishPresentationDensity(density: PresentationDensity, visibleCount: number, phase?: InteractionPhase): PresentationDensity {
  return phase === 'editing' || phase === 'dragging' || phase === 'resizing'
    ? density : capDensity(density, densityCapForNodeCount(visibleCount));
}
