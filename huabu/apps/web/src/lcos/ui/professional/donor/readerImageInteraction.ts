import { beginProfessionalPointerGesture } from '../../../professional/professionalPointerGesture';
import { fitImageInStage, imageWheelFactor, zoomImageAtPoint, centerImageAfterResize, type ReaderImageView, type ImagePoint } from './imageZoomMath';

export interface ReaderImageSnapshot extends ReaderImageView {
  readonly mode: 'fit' | 'manual';
  readonly size: ImagePoint;
}

/** G1 wheel-at-pointer / pan / 100%-reset, adapted to the existing Reader host.
 * All listeners and transforms are local to this image. No Canvas/store access.
 */
export function mountReaderImageInteraction(input: {
  readonly stage: HTMLElement;
  readonly image: HTMLImageElement;
  readonly transform: HTMLElement;
  readonly onChange: (view: ReaderImageSnapshot) => void;
  readonly onError: (failed: boolean) => void;
  readonly initial?: ReaderImageSnapshot;
}) {
  const { stage, image, transform } = input;
  const doc = stage.ownerDocument;
  const win = doc.defaultView;
  if (win === null) throw new Error('Reader image requires a document window.');
  let disposed = false;
  let visible = true;
  let failed = false;
  let cancelPan: (() => void) | undefined;
  let mode: 'fit' | 'manual' = input.initial?.mode ?? 'fit';
  let size = input.initial?.size ?? { x: 0, y: 0 };
  let view: ReaderImageView = input.initial ?? { scale: 1, pan: { x: 0, y: 0 } };
  let minimum = 0.2;
  const commit = (next: ReaderImageView): void => {
    if (disposed || ![next.scale, next.pan.x, next.pan.y].every(Number.isFinite) || next.scale <= 0) return;
    view = { scale: next.scale, pan: { ...next.pan } };
    transform.style.transform = `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.scale})`;
    stage.dataset.readerImageScale = String(view.scale);
    input.onChange({ ...view, pan: { ...view.pan }, mode, size: { ...size } });
  };
  const reflow = (): void => {
    if (disposed || !visible || failed) return;
    const nextSize = { x: stage.clientWidth, y: stage.clientHeight };
    const fit = fitImageInStage(nextSize.x, nextSize.y, image.naturalWidth, image.naturalHeight);
    if (fit === undefined) return; // A hidden/zero-size tab is not an instruction to lose its view.
    minimum = Math.min(0.2, fit.scale);
    const next = mode === 'fit' ? fit : size.x > 0 && size.y > 0 ? centerImageAfterResize(view, size, nextSize) : view;
    size = nextSize;
    commit(next);
  };
  const fit = (): void => { cancelPan?.(); mode = 'fit'; reflow(); };
  const reset = (): void => {
    cancelPan?.();
    if (!visible || failed || image.naturalWidth <= 0 || stage.clientWidth <= 0) return;
    mode = 'manual'; size = { x: stage.clientWidth, y: stage.clientHeight };
    commit({ scale: 1, pan: { x: (size.x - image.naturalWidth) / 2, y: (size.y - image.naturalHeight) / 2 } });
  };
  const zoomBy = (factor: number, point?: ImagePoint): void => {
    if (!visible || failed || factor === 1 || !Number.isFinite(factor) || factor <= 0 || size.x <= 0 || size.y <= 0) return;
    cancelPan?.(); mode = 'manual';
    commit(zoomImageAtPoint(view.scale, view.pan, point ?? { x: size.x / 2, y: size.y / 2 }, factor, minimum, 8));
  };
  const wheel = (event: WheelEvent): void => {
    if (!visible) return;
    event.preventDefault(); event.stopPropagation();
    const rect = stage.getBoundingClientRect();
    zoomBy(imageWheelFactor(event.deltaY, event.deltaMode, rect.height), { x: event.clientX - rect.x, y: event.clientY - rect.y });
  };
  const down = (event: PointerEvent): void => {
    if (disposed || !visible || failed || event.button !== 0 || event.isPrimary === false
      || (event.target as Element | null)?.closest('button,input,textarea,a,select')) return;
    cancelPan?.(); event.preventDefault(); event.stopPropagation(); stage.focus({ preventScroll: true });
    const original = { ...view, pan: { ...view.pan } };
    const originalMode = mode;
    const x = event.clientX, y = event.clientY;
    let moved = false;
    const update = (sample: PointerEvent): void => {
      if (!moved && sample.clientX === x && sample.clientY === y) return;
      moved = true;
      mode = 'manual'; stage.classList.add('is-dragging');
      commit({ scale: original.scale, pan: { x: original.pan.x + sample.clientX - x, y: original.pan.y + sample.clientY - y } });
    };
    cancelPan = beginProfessionalPointerGesture({ start: event, capture: stage, document: doc, window: win,
      isCurrent: () => !disposed && visible && !failed,
      onMove: update,
      onCommit: (sample) => { update(sample); cancelPan = undefined; stage.classList.remove('is-dragging'); },
      onCancel: () => { cancelPan = undefined; stage.classList.remove('is-dragging'); mode = originalMode; commit(original); },
    });
  };
  const key = (event: KeyboardEvent): void => {
    if (event.target !== stage || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || !visible || failed) return;
    if (!['+', '=', '-', '0'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === '0') reset(); else zoomBy(event.key === '-' ? 1 / 1.25 : 1.25);
  };
  const double = (event: MouseEvent): void => {
    if ((event.target as Element | null)?.closest('button')) return;
    event.stopPropagation(); reset();
  };
  const loaded = (): void => { failed = false; input.onError(false); reflow(); };
  const error = (): void => { cancelPan?.(); failed = true; input.onError(true); };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(reflow) : undefined;
  observer?.observe(stage);
  stage.addEventListener('wheel', wheel, { passive: false });
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('keydown', key);
  stage.addEventListener('dblclick', double);
  image.addEventListener('load', loaded);
  image.addEventListener('error', error);
  win.addEventListener('resize', reflow);
  if (image.complete && image.naturalWidth > 0) loaded(); else reflow();
  return {
    zoomBy, fit, reset, reflow,
    setVisible(value: boolean): void { visible = value; if (!value) cancelPan?.(); else reflow(); },
    snapshot: (): ReaderImageSnapshot => ({ ...view, pan: { ...view.pan }, mode, size: { ...size } }),
    dispose(): void {
      cancelPan?.(); disposed = true; observer?.disconnect();
      stage.removeEventListener('wheel', wheel); stage.removeEventListener('pointerdown', down);
      stage.removeEventListener('keydown', key); stage.removeEventListener('dblclick', double);
      image.removeEventListener('load', loaded); image.removeEventListener('error', error);
      win.removeEventListener('resize', reflow);
    },
  };
}
