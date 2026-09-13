// T2 C2-3A · Locator pure geometry (React-free, Core-free, Camera-free).
//
// 本模块只做一件事：把"当前 Huabu 目标相对当前可用屏幕区域在哪"算成纯几何。
// 输入全部是屏幕空间（safeRect 来自 T4 ProfessionalWindowEnvironment，
// targetRect 来自 Huabu geometry + viewport + wrapper rect，见 C2-3A §16/§17）。
// 不持有任何状态；不碰 camera；不读 DOM；不返回 canonical 实体。
//
// 状态语义（C2-3A §1）：
//   LOCAL     —— 目标中心在安全区内舒适内区 → 无边缘 cue（可交 T5 目标本地 cue）
//   NEAR_EDGE —— 目标仍在安全区内但逼近边界 → 连续 progress 驱动形态压缩
//   EDGE      —— 目标中心在安全区外 → 从安全区中心向目标中心作射线，与
//                内缩边相交得 edgeAnchor，返回方向/距离（C2-3A §21）
//
// Oversized target（C2-3A §23）：只看目标中心，不围绕已覆盖安全区的大目标
// 打边缘标记。

import type { Point } from './types.js';

/** 屏幕空间矩形（left/top/right/bottom，viewport 坐标）。 */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type LocatorStateKind = 'local' | 'near-edge' | 'edge';

export interface LocatorGeometryInput {
  safeRect: ScreenRect;
  targetRect: ScreenRect;
  /** 边缘 cue 停在安全区边内的内缩量（像素）。 */
  edgeInset: number;
  /** 触发 NEAR_EDGE 的"接近安全区边界"距离（像素）。 */
  nearEdgeDistance: number;
  /** 舒适内区 inset（LOCAL 判定用，默认 0 = 仅安全区判定）。 */
  comfortableInset?: number;
}

export interface LocatorGeometry {
  state: LocatorStateKind;
  targetCenter: Point;
  /** 指向目标中心的归一化方向（目标=中心时为 (0,0)）。 */
  direction: Point;
  /** 目标中心到安全区中心的距离（像素）。 */
  distance: number;
  /** 连续进度 0..1：NEAR_EDGE 时从舒适内区边界向安全区边界逼近；EDGE=1。 */
  progress: number;
  /** EDGE 时的屏幕锚点（安全区内缩边上）；其他状态为 undefined。 */
  edgeAnchor?: Point;
  /** NEAR_EDGE 时的方向性锚点（方向射线与安全区边界交点），供压缩 cue 定位。 */
  directionAnchor?: Point;
}

export function toScreenRect(rect: { x: number; y: number; width: number; height: number }): ScreenRect {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
}

function center(rect: ScreenRect): Point {
  return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 目标中心相对 safeRect 中心的归一化方向（目标=中心时不产生方向）。 */
function directionToward(from: Point, to: Point): Point {
  const d = distance(from, to);
  if (d === 0) return { x: 0, y: 0 };
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d };
}

/**
 * 从 rayOrigin 沿 unitDir 出发，求与内缩矩形边界的最近交点。
 * 经典 slab 求交：对每个轴取 t 区间，取最大下界与最小上界的交集。
 */
function rayRectIntersection(origin: Point, unitDir: Point, rect: ScreenRect): Point | undefined {
  let tMin = 0;
  let tMax = Number.POSITIVE_INFINITY;

  const axis = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) {
      // 平行轴：原点必须在 [lo, hi] 内才有交点
      return o >= lo && o <= hi;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    const a = Math.min(t1, t2);
    const b = Math.max(t1, t2);
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    return tMin <= tMax;
  };

  const hitX = axis(origin.x, unitDir.x, rect.left, rect.right);
  const hitY = axis(origin.y, unitDir.y, rect.top, rect.bottom);
  if (!hitX || !hitY || tMax < tMin) return undefined;
  const t = tMin > 0 ? tMin : tMax;
  return { x: origin.x + unitDir.x * t, y: origin.y + unitDir.y * t };
}

export function computeLocatorGeometry(input: LocatorGeometryInput): LocatorGeometry {
  // 舒适内区默认 = 安全区向内收 nearEdgeDistance（LOCAL 与 NEAR_EDGE 的分界
  // 就是这条内区边界；目标中心落在外带即 NEAR_EDGE）。
  const comfortableInset = input.comfortableInset ?? input.nearEdgeDistance;
  const safeCenter = center(input.safeRect);
  const targetCenter = center(input.targetRect);
  const distanceToTarget = distance(safeCenter, targetCenter);
  const unitDir = directionToward(safeCenter, targetCenter);

  const comfortable: ScreenRect = {
    left: input.safeRect.left + comfortableInset,
    top: input.safeRect.top + comfortableInset,
    right: input.safeRect.right - comfortableInset,
    bottom: input.safeRect.bottom - comfortableInset,
  };

  const insideSafe =
    targetCenter.x >= input.safeRect.left &&
    targetCenter.x <= input.safeRect.right &&
    targetCenter.y >= input.safeRect.top &&
    targetCenter.y <= input.safeRect.bottom;

  if (!insideSafe) {
    // EDGE：目标中心在安全区外 → 射线交内缩边。
    const insetRect: ScreenRect = {
      left: input.safeRect.left + input.edgeInset,
      top: input.safeRect.top + input.edgeInset,
      right: input.safeRect.right - input.edgeInset,
      bottom: input.safeRect.bottom - input.edgeInset,
    };
    const edgeAnchor = rayRectIntersection(safeCenter, unitDir, insetRect);
    return {
      state: 'edge',
      targetCenter,
      direction: unitDir,
      distance: distanceToTarget,
      progress: 1,
      edgeAnchor,
    };
  }

  const insideComfortable =
    targetCenter.x >= comfortable.left &&
    targetCenter.x <= comfortable.right &&
    targetCenter.y >= comfortable.top &&
    targetCenter.y <= comfortable.bottom;

  if (insideComfortable) {
    return { state: 'local', targetCenter, direction: { x: 0, y: 0 }, distance: distanceToTarget, progress: 0 };
  }

  // NEAR_EDGE：目标在安全区内但超出舒适内区 → 按"到最近安全区边界的距离"给连续 progress。
  const dxEdge = Math.min(
    input.safeRect.right - targetCenter.x,
    targetCenter.x - input.safeRect.left,
  );
  const dyEdge = Math.min(
    input.safeRect.bottom - targetCenter.y,
    targetCenter.y - input.safeRect.top,
  );
  const distToEdge = Math.min(dxEdge, dyEdge);
  const progress =
    input.nearEdgeDistance <= 0
      ? 1
      : Math.min(1, Math.max(0, (input.nearEdgeDistance - distToEdge) / input.nearEdgeDistance));

  return {
    state: 'near-edge',
    targetCenter,
    direction: unitDir,
    distance: distanceToTarget,
    progress,
    // 方向射线与安全区边界交点：压缩 cue 的稳定锚点（无 DOM 猜测）。
    directionAnchor: rayRectIntersection(safeCenter, unitDir, input.safeRect),
  };
}
