/** GEN1 ImageZoomStage math: Reader media-local view, never Canvas geometry. */
export interface ImagePoint { readonly x: number; readonly y: number }
export interface ReaderImageView { readonly scale: number; readonly pan: ImagePoint }
export function zoomImageAtPoint(
  scale: number, pan: ImagePoint, point: ImagePoint, factor: number, minimum: number, maximum: number,
): ReaderImageView {
  if (![scale, pan.x, pan.y, point.x, point.y, factor, minimum, maximum].every(Number.isFinite)
    || scale <= 0 || factor <= 0 || minimum <= 0 || maximum < minimum) return { scale, pan };
  const nextScale = Math.min(maximum, Math.max(minimum, scale * factor));
  const worldX = (point.x - pan.x) / scale;
  const worldY = (point.y - pan.y) / scale;
  return { scale: nextScale, pan: { x: point.x - worldX * nextScale, y: point.y - worldY * nextScale } };
}
export function fitImageInStage(cw: number, ch: number, nw: number, nh: number): ReaderImageView | undefined {
  if (![cw, ch, nw, nh].every(value => Number.isFinite(value) && value > 0)) return undefined;
  const fit = Math.min(cw / nw, ch / nh, 1);
  return { scale: fit, pan: { x: (cw - nw * fit) / 2, y: (ch - nh * fit) / 2 } };
}
/** Wheel deltas may be pixels, lines or pages. Zero/horizontal-only input is not zoom-out. */
export function imageWheelFactor(deltaY: number, deltaMode: number, pageHeight: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(1, pageHeight) : 1;
  return Math.exp(-Math.min(240, Math.max(-240, deltaY * unit)) * Math.log(1.15) / 100);
}
export function centerImageAfterResize(view: ReaderImageView, previous: ImagePoint, next: ImagePoint): ReaderImageView {
  return { scale: view.scale, pan: { x: view.pan.x + (next.x - previous.x) / 2, y: view.pan.y + (next.y - previous.y) / 2 } };
}
