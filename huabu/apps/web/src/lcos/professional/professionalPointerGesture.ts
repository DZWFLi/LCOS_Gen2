/** Listener lifecycle for the existing Professional Stage gestures.
 * Adopted interruption semantics from Huabu PreviewWorkspace's tab drag:
 * blur/hidden-document cancels. Esc is captured before the window-close stack.
 * This owns no geometry, topology, project state, or Canvas pointer routing.
 */
export interface ProfessionalPointerSample {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly isPrimary?: boolean;
}

export type ProfessionalGestureCancelReason =
  | 'escape' | 'pointer-cancel' | 'capture-lost' | 'blur' | 'hidden'
  | 'viewport-change' | 'stale-source' | 'button-lost' | 'replaced';

export function beginProfessionalPointerGesture(input: {
  readonly start: ProfessionalPointerSample;
  readonly capture?: HTMLElement;
  readonly document: Document;
  readonly window: Window;
  readonly isCurrent: () => boolean;
  readonly onMove: (event: PointerEvent) => void;
  readonly onCommit: (event: PointerEvent) => void;
  readonly onCancel: (reason: ProfessionalGestureCancelReason) => void;
}): () => void {
  const { start, capture, document: doc, window: win } = input;
  if (start.button !== 0 || start.isPrimary === false || !input.isCurrent()) return () => undefined;
  let ended = false;
  const cleanup = (): void => {
    win.removeEventListener('pointermove', onMove);
    win.removeEventListener('pointerup', onUp);
    win.removeEventListener('pointercancel', onCancel);
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('resize', onResize);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('visibilitychange', onVisibility);
    capture?.removeEventListener('lostpointercapture', onLost);
    try {
      if (capture?.hasPointerCapture(start.pointerId)) capture.releasePointerCapture(start.pointerId);
    } catch { /* Detached handles may already have released capture. */ }
  };
  const cancel = (reason: ProfessionalGestureCancelReason): void => {
    if (ended) return;
    ended = true;
    cleanup();
    input.onCancel(reason);
  };
  const onMove = (event: PointerEvent): void => {
    if (ended || event.pointerId !== start.pointerId) return;
    if (!input.isCurrent()) { cancel('stale-source'); return; }
    if ((event.buttons & 1) === 0) { cancel('button-lost'); return; }
    input.onMove(event);
  };
  const onUp = (event: PointerEvent): void => {
    if (ended || event.pointerId !== start.pointerId || event.button !== 0) return;
    if (!input.isCurrent()) { cancel('stale-source'); return; }
    ended = true;
    cleanup();
    input.onCommit(event);
  };
  const onCancel = (event: PointerEvent): void => {
    if (event.pointerId === start.pointerId) cancel('pointer-cancel');
  };
  const onLost = (event: Event): void => {
    if ((event as PointerEvent).pointerId === start.pointerId) cancel('capture-lost');
  };
  const onBlur = (): void => cancel('blur');
  const onResize = (): void => cancel('viewport-change');
  const onVisibility = (): void => { if (doc.visibilityState === 'hidden') cancel('hidden'); };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    cancel('escape');
  };
  win.addEventListener('pointermove', onMove);
  win.addEventListener('pointerup', onUp);
  win.addEventListener('pointercancel', onCancel);
  win.addEventListener('blur', onBlur);
  win.addEventListener('resize', onResize);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('visibilitychange', onVisibility);
  capture?.addEventListener('lostpointercapture', onLost);
  try { capture?.setPointerCapture(start.pointerId); } catch { /* Window listeners still observe this pointer. */ }
  return () => cancel('replaced');
}
