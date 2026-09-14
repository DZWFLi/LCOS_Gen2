// GEN2 安全取景（fit with safe insets）：把内容包围盒取景到视口内，并让出
// 四边安全边距（HUD / Railway / Composer / Dock 占用的屏幕区域）。
// 纯函数：无状态、无副作用、无 React、无 DOM、无网络。不持有 camera，也不建
// 第二套 spatial truth —— 结果只由调用方（主前端）交给 Huabu camera。
//
// Provenance（donor，A 级纯逻辑搬运 + 上限按已定位病灶收紧）：
//   owner: DZWFLi
//   repo:  LCOS-local-creativeOS（旧库，只读 donor）
//   path:  apps/web/src/features/canvas/canvasGeometry.ts
//          ::SafeInsets / NO_INSETS / fitBounds（第 6、17、37–46 行）
//          可读性 zoom 上下限取自同文件 ::MIN_RESTORED_CAMERA_ZOOM /
//          MAX_RESTORED_CAMERA_ZOOM（第 15–16 行）
//   本地读取 commit: f0841587921781bd514edf6acffcbb592e672e52
//   审计引用的 GitHub ref: 3e99769（SOURCE_ADOPTION_LEDGER T1-A03）
//   license: 该库无 LICENSE 文件、根 package.json 无 license 字段（自有库，仅内部复用）
//
// 与 GEN1 的差异（为什么改）：
//   1. GEN1 `fitBounds` 的 zoom 上限是 MAX_CANVAS_ZOOM = 2.0，而 GEN1 自己已经承认
//      "内容很少时被放大到 200%+ 文字不可读"是缺陷（同文件的 fitBoundsForReading 就是在
//      补这个洞）。本仓库已定位的病灶同样是"内容很少时 fit 放大到 217%~348%"，因此默认
//      上限取 GEN1 的阅读天花板 1.25（125%，明显低于 150%）：fit 宁可留白，也不吹成巨字。
//   2. GEN1 只对 bounds.width/height 兜 `Math.max(1, …)`，不对空 bounds 兜底；这里对
//      空 / 非正 / 非有限 bounds 返回确定的居中默认取景（zoom = 1），不抛错、不出 NaN。
//   3. 可用绘图区（viewport − insets）与内区（再减 padding）都被夹到正的最小值，
//      超大 insets 只会得到确定的小可用区，不会产生负宽高或 NaN。

/** 视口尺寸（屏幕像素）。 */
export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/** 内容包围盒（世界坐标）。 */
export interface ContentBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 四边安全边距（屏幕像素）：HUD / Railway / Composer / Dock 让出的区域。 */
export interface SafeInsets {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** 取景结果：世界坐标 → 屏幕的平移量与 zoom。 */
export interface FitResult {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** 取景选项。 */
export interface FitOptions {
  /** zoom 下限，默认 {@link DEFAULT_FIT_MIN_ZOOM}。 */
  readonly minZoom?: number;
  /** zoom 上限，默认 {@link DEFAULT_FIT_MAX_ZOOM}。 */
  readonly maxZoom?: number;
  /** 内容与可用区边缘之间的内缩（单边，屏幕像素），默认 {@link DEFAULT_FIT_PADDING}。 */
  readonly padding?: number;
}

/** 无安全边距（不需要让位时的显式输入）。 */
export const NO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * 默认 zoom 下限：0.2。
 * GEN1 `MIN_CANVAS_ZOOM` 是 0.02（"超大画布总览"的极端下限），但 GEN2 的 fit 由用户显式
 * 触发且已让出 HUD，0.02 只会把超大项目糊成不可辨认的缩略图。0.2 仍能一次看全约
 * 5000px 宽的世界内容，同时避免无意义的极小 zoom。
 */
export const DEFAULT_FIT_MIN_ZOOM = 0.2;

/**
 * 默认 zoom 上限：1.25（= GEN1 `MAX_RESTORED_CAMERA_ZOOM`）。
 * 这是**可读性上限**：已有病灶是"内容很少时 fit 放大到 217%~348%，文字不可读"，
 * 所以刻意不采用 GEN1 `fitBounds` 的 MAX_CANVAS_ZOOM = 2.0；1.25 明显低于 150%，
 * 保证少量内容取景后文字仍是可读尺寸而不是巨字。
 */
export const DEFAULT_FIT_MAX_ZOOM = 1.25;

/** 默认内缩：与 GEN1 `fitBounds` 的 74 一致。 */
export const DEFAULT_FIT_PADDING = 74;

/** 可用区/内区的最小正数尺寸（GEN1 用 `Math.max(1, …)` 兜住除零）。 */
const MIN_DRAWABLE_EXTENT = 1;

const finiteOr = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** 夹在 [minZoom, maxZoom]；若上下限颠倒则以 maxZoom 为准（确定而非随机）。 */
const clampZoom = (zoom: number, minZoom: number, maxZoom: number): number =>
  Math.min(maxZoom, Math.max(minZoom, zoom));

/** 是否可用来求 zoom：非 null、四值有限、宽高为正。 */
const isFittable = (bounds: ContentBounds | null): bounds is ContentBounds =>
  bounds !== null &&
  Number.isFinite(bounds.x) &&
  Number.isFinite(bounds.y) &&
  Number.isFinite(bounds.width) &&
  Number.isFinite(bounds.height) &&
  bounds.width > 0 &&
  bounds.height > 0;

/**
 * 把内容包围盒取景到视口内，并让出四边安全边距（HUD/Railway/Composer/Dock 占用）。
 *
 * 语义（沿用 GEN1 `fitBounds`，见文件头差异说明）：
 *   可用区 = viewport − insets；内区 = 可用区 − padding×2；
 *   zoom = clamp(min(内区宽 / 内容宽, 内区高 / 内容高), minZoom, maxZoom)；
 *   x/y 让内容中心落在**可用区**中心（不是视口中心），所以 insets 不对称时居中会随之偏移。
 *
 * @param bounds   内容包围盒（世界坐标）；null / 空 / 非有限 → 返回确定的居中默认取景（zoom = 1）
 * @param viewport 视口尺寸（屏幕像素）
 * @param insets   四边安全边距（屏幕像素），用 {@link NO_INSETS} 表示不让位
 * @param options  minZoom / maxZoom / padding 覆盖
 */
export function fitBoundsWithInsets(
  bounds: ContentBounds | null,
  viewport: ViewportSize,
  insets: SafeInsets,
  options: FitOptions = {},
): FitResult {
  const padding = Math.max(0, finiteOr(options.padding, DEFAULT_FIT_PADDING));
  const minZoom = finiteOr(options.minZoom, DEFAULT_FIT_MIN_ZOOM);
  const maxZoom = finiteOr(options.maxZoom, DEFAULT_FIT_MAX_ZOOM);

  // 负 insets 视为 0；扣完为负时夹到最小正数，不出负宽高/NaN。
  const insetLeft = Math.max(0, finiteOr(insets.left, 0));
  const insetRight = Math.max(0, finiteOr(insets.right, 0));
  const insetTop = Math.max(0, finiteOr(insets.top, 0));
  const insetBottom = Math.max(0, finiteOr(insets.bottom, 0));

  const availableWidth = Math.max(
    MIN_DRAWABLE_EXTENT,
    finiteOr(viewport.width, 0) - insetLeft - insetRight,
  );
  const availableHeight = Math.max(
    MIN_DRAWABLE_EXTENT,
    finiteOr(viewport.height, 0) - insetTop - insetBottom,
  );
  const innerWidth = Math.max(MIN_DRAWABLE_EXTENT, availableWidth - padding * 2);
  const innerHeight = Math.max(MIN_DRAWABLE_EXTENT, availableHeight - padding * 2);

  // 可用区中心（insets 不对称时不是视口中心）。
  const areaCenterX = insetLeft + availableWidth / 2;
  const areaCenterY = insetTop + availableHeight / 2;

  if (!isFittable(bounds)) {
    // 没有可取景的内容：回到确定默认 —— zoom = 1（仍被 min/max 夹住），世界原点落在可用区中心。
    return { x: areaCenterX, y: areaCenterY, zoom: clampZoom(1, minZoom, maxZoom) };
  }

  const contentWidth = Math.max(MIN_DRAWABLE_EXTENT, bounds.width);
  const contentHeight = Math.max(MIN_DRAWABLE_EXTENT, bounds.height);
  const zoom = clampZoom(
    Math.min(innerWidth / contentWidth, innerHeight / contentHeight),
    minZoom,
    maxZoom,
  );

  return {
    x: areaCenterX - (bounds.x + bounds.width / 2) * zoom,
    y: areaCenterY - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}
