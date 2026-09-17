// Sprint 2B（T4）：Professional Window 布局纯模型（React-free）。
//
// 唯一拓扑 owner 是 ProfessionalWindowStage（T4 §2.1）：safeRect/occupiedRects
// 只有 Stage 一个 producer；body registry 只把 bodyKey 解析到唯一 factory。
// 本文件只做纯几何/身份推导，不持有任何业务状态、不碰 Canvas camera/selection。

/** 专业 body 类型（T4 §3 五类 + Assembly/Conversation Work View 容器 + Doctor 诊断）。 */
export type ProfessionalBodyKeyV1 =
  | 'assembly'
  | 'conversation-work'
  | 'receiver'
  | 'capture-inbox'
  | 'connector-source'
  | 'waiting-input'
  | 'recovery'
  | 'doctor'

export interface ProfessionalRectV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 一个 Professional region 的稳定身份：regionId 由 bodyKey+target 推导，不猜。 */
export interface ProfessionalRegionRefV1 {
  readonly regionId: string;
  readonly bodyKey: ProfessionalBodyKeyV1;
  /** canonical target identity（ConnectedConversation.id / AssemblyTargetRef 等），generation guard 的 key。 */
  readonly targetKey: string;
}

/** Stage 一次性冻结的 window environment（T4 §2.1：唯一 producer = Stage）。 */
export interface ProfessionalWindowEnvironmentV1 {
  readonly safeRect: ProfessionalRectV1;
  readonly occupiedRects: readonly ProfessionalRectV1[];
  readonly activeRegionId: string | undefined;
}

/** Stage 目前支持的两种真实区域布局；group 由同一 region 的多个 instance 表达。 */
export type ProfessionalRegionLayoutV1 = 'floating' | 'docked-right';

export interface ProfessionalRegionPlacementV1 {
  readonly regionId: string;
  readonly layout: ProfessionalRegionLayoutV1;
  readonly rect: ProfessionalRectV1;
}

export interface ProfessionalEdgeInsetsV1 {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export type ProfessionalResizeHandleV1 =
  | 'n'
  | 'ne'
  | 'e'
  | 'se'
  | 's'
  | 'sw'
  | 'w'
  | 'nw';

const DEFAULT_MIN_WIDTH = 320;
const DEFAULT_MIN_HEIGHT = 240;
const DEFAULT_DOCK_GAP = 16;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function rectRight(rect: ProfessionalRectV1): number {
  return rect.x + rect.width;
}

function rectBottom(rect: ProfessionalRectV1): number {
  return rect.y + rect.height;
}

function normalizeInsets(insets: Partial<ProfessionalEdgeInsetsV1> | undefined): ProfessionalEdgeInsetsV1 {
  return {
    top: finiteNonNegative(insets?.top ?? 0),
    right: finiteNonNegative(insets?.right ?? 0),
    bottom: finiteNonNegative(insets?.bottom ?? 0),
    left: finiteNonNegative(insets?.left ?? 0),
  };
}

/**
 * Derive the single environment published by ProfessionalWindowStage.
 * Docked regions constrain the usable edge rectangle; floating regions remain
 * precise obstructions and never collapse the whole viewport into one inset.
 */
export function deriveProfessionalWindowEnvironmentV1(input: {
  readonly viewport: ProfessionalRectV1;
  readonly regions: readonly ProfessionalRegionPlacementV1[];
  readonly activeRegionId?: string;
  readonly edgeInsets?: Partial<ProfessionalEdgeInsetsV1>;
  readonly dockGap?: number;
}): ProfessionalWindowEnvironmentV1 {
  const insets = normalizeInsets(input.edgeInsets);
  const viewport = input.viewport;
  const safeRect: ProfessionalRectV1 = {
    x: viewport.x + insets.left,
    y: viewport.y + insets.top,
    width: Math.max(0, viewport.width - insets.left - insets.right),
    height: Math.max(0, viewport.height - insets.top - insets.bottom),
  };
  const dockGap = finiteNonNegative(input.dockGap ?? DEFAULT_DOCK_GAP);
  const viewportRight = rectRight(viewport);
  const viewportBottom = rectBottom(viewport);
  let right = rectRight(safeRect);
  let left = safeRect.x;
  let top = safeRect.y;
  let bottom = rectBottom(safeRect);

  for (const region of input.regions) {
    const rect = region.rect;
    if (region.layout !== 'docked-right') continue;
    const touchesRight = Math.abs(rectRight(rect) - viewportRight) <= 1;
    const touchesLeft = Math.abs(rect.x - viewport.x) <= 1;
    const touchesTop = Math.abs(rect.y - viewport.y) <= 1;
    const touchesBottom = Math.abs(rectBottom(rect) - viewportBottom) <= 1;
    if (touchesRight && rect.y < bottom && rectBottom(rect) > top) {
      right = Math.min(right, rect.x - dockGap);
    }
    if (touchesLeft && rect.y < bottom && rectBottom(rect) > top) {
      left = Math.max(left, rectRight(rect) + dockGap);
    }
    if (touchesTop && rect.x < right && rectRight(rect) > left) {
      top = Math.max(top, rectBottom(rect) + dockGap);
    }
    if (touchesBottom && rect.x < right && rectRight(rect) > left) {
      bottom = Math.min(bottom, rect.y - dockGap);
    }
  }

  return {
    safeRect: {
      x: left,
      y: top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    },
    occupiedRects: input.regions.map((region) => region.rect),
    activeRegionId: input.activeRegionId,
  };
}

/** Convert a viewport and safe rectangle into the edge insets used by fit/locator consumers. */
export function safeInsetsFromRectV1(
  viewport: ProfessionalRectV1,
  safeRect: ProfessionalRectV1,
): ProfessionalEdgeInsetsV1 {
  return {
    top: finiteNonNegative(safeRect.y - viewport.y),
    right: finiteNonNegative(rectRight(viewport) - rectRight(safeRect)),
    bottom: finiteNonNegative(rectBottom(viewport) - rectBottom(safeRect)),
    left: finiteNonNegative(safeRect.x - viewport.x),
  };
}

/** Clamp a window to the viewport while preserving minimum usable dimensions. */
export function clampProfessionalRectV1(
  rect: ProfessionalRectV1,
  viewport: ProfessionalRectV1,
  minWidth = DEFAULT_MIN_WIDTH,
  minHeight = DEFAULT_MIN_HEIGHT,
): ProfessionalRectV1 {
  const width = Math.min(viewport.width, Math.max(Math.max(0, minWidth), Math.max(0, rect.width)));
  const height = Math.min(viewport.height, Math.max(Math.max(0, minHeight), Math.max(0, rect.height)));
  const x = Math.min(
    viewport.x + Math.max(0, viewport.width - width),
    Math.max(viewport.x, rect.x),
  );
  const y = Math.min(
    viewport.y + Math.max(0, viewport.height - height),
    Math.max(viewport.y, rect.y),
  );
  return { x, y, width, height };
}

/** Resize one or more edges and clamp the result; no camera or canvas state is involved. */
export function resizeProfessionalRectV1(
  rect: ProfessionalRectV1,
  handle: ProfessionalResizeHandleV1,
  delta: { readonly x: number; readonly y: number },
  viewport: ProfessionalRectV1,
  minWidth = DEFAULT_MIN_WIDTH,
  minHeight = DEFAULT_MIN_HEIGHT,
): ProfessionalRectV1 {
  const minW = Math.min(viewport.width, Math.max(0, minWidth));
  const minH = Math.min(viewport.height, Math.max(0, minHeight));
  let left = rect.x;
  let right = rectRight(rect);
  let top = rect.y;
  let bottom = rectBottom(rect);
  if (handle.includes('w')) left += delta.x;
  if (handle.includes('e')) right += delta.x;
  if (handle.includes('n')) top += delta.y;
  if (handle.includes('s')) bottom += delta.y;

  if (right - left < minW) {
    if (handle.includes('w')) left = right - minW;
    else right = left + minW;
  }
  if (bottom - top < minH) {
    if (handle.includes('n')) top = bottom - minH;
    else bottom = top + minH;
  }

  const next: ProfessionalRectV1 = { x: left, y: top, width: right - left, height: bottom - top };
  return clampProfessionalRectV1(next, viewport, minW, minH);
}

/** 唯一 region identity 规则：Conversation Work View 按 ConnectedConversation.id 定位。 */
export function professionalRegionRefV1(
  bodyKey: ProfessionalBodyKeyV1,
  targetKey: string,
): ProfessionalRegionRefV1 {
  const regionId =
    bodyKey === 'conversation-work'
      ? `lcos:conversation:${targetKey}`
      : `lcos:${bodyKey}:${targetKey}`;
  return { regionId, bodyKey, targetKey };
}

/** 两矩形是否重叠（边界相接不算重叠）。 */
export function rectsOverlapV1(a: ProfessionalRectV1, b: ProfessionalRectV1): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * 在 env 中放置 region：preferred 与所有 occupied 都不重叠则直接返回；
 * 否则尝试向右错位一格；仍冲突返回 undefined（由 Stage 决定隐藏/堆叠，不覆盖稳定锚点）。
 */
export function placeProfessionalRegionV1(
  env: ProfessionalWindowEnvironmentV1,
  preferred: ProfessionalRectV1,
  stepX = 24,
  stepY = 24,
): ProfessionalRectV1 | undefined {
  const candidates: readonly ProfessionalRectV1[] = [
    preferred,
    { ...preferred, x: preferred.x + stepX, y: preferred.y + stepY },
  ];
  for (const candidate of candidates) {
    const overlapsAny = env.occupiedRects.some((occupied) => rectsOverlapV1(candidate, occupied));
    if (!overlapsAny) return candidate;
  }
  return undefined;
}
