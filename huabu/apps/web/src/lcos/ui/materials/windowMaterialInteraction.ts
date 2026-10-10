/** Decorative response only. Never takes pointer capture, focus, selection or window geometry. */
export function mountWindowMaterialInteraction(host: HTMLElement): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  if (!win || typeof win.matchMedia !== 'function') return () => {};
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  const contrast = win.matchMedia('(forced-colors: active)');
  let frame = 0;
  let targetX = 50;
  let currentX = 50;
  let running = false;
  let disposed = false;
  let lastTime = 0;
  const eligible = (): boolean => !disposed && host.isConnected && !doc.hidden
    && !reduced.matches && !contrast.matches && !host.closest('[hidden], [inert], [aria-hidden="true"]');
  const stop = (): void => {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0; running = false; lastTime = 0;
  };
  const reset = (): void => {
    stop();
    delete host.dataset.lcosWindowMaterialHover;
    host.style.removeProperty('--lcos-window-light-x');
    currentX = targetX = 50;
  };
  const tick = (time: number): void => {
    frame = 0;
    if (!running || !eligible()) { reset(); return; }
    // Time-based damping: same response on high-refresh and ordinary displays.
    const elapsed = lastTime ? Math.min(48, time - lastTime) : 16;
    lastTime = time;
    currentX += (targetX - currentX) * (1 - Math.exp(-elapsed / 65));
    host.style.setProperty('--lcos-window-light-x', `${currentX.toFixed(2)}%`);
    if (Math.abs(targetX - currentX) > 0.06) frame = win.requestAnimationFrame(tick);
    else { currentX = targetX; running = false; lastTime = 0; }
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' || event.buttons !== 0 || !eligible()) { reset(); return; }
    const bounds = host.getBoundingClientRect();
    if (bounds.width <= 0) return;
    targetX = Math.max(0, Math.min(100, 100 * (event.clientX - bounds.left) / bounds.width));
    host.dataset.lcosWindowMaterialHover = 'true';
    if (!running) { running = true; frame = win.requestAnimationFrame(tick); }
  };
  const visibility = (): void => { if (doc.hidden || !eligible()) reset(); };
  const mediaChange = (): void => reset();
  // These listeners observe input only; all existing gestures continue to bubble.
  host.addEventListener('pointerenter', move, { passive: true });
  host.addEventListener('pointermove', move, { passive: true });
  host.addEventListener('pointerleave', reset, { passive: true });
  host.addEventListener('pointerdown', reset, { passive: true });
  host.addEventListener('pointercancel', reset, { passive: true });
  win.addEventListener('blur', reset);
  doc.addEventListener('visibilitychange', visibility);
  reduced.addEventListener('change', mediaChange);
  contrast.addEventListener('change', mediaChange);
  const region = host.closest('.lcos-professional-region');
  const observer = region && typeof win.MutationObserver === 'function'
    ? new win.MutationObserver(() => { if (!eligible()) reset(); }) : null;
  if (region) observer?.observe(region, { attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden'] });
  return () => {
    disposed = true; observer?.disconnect(); reset();
    host.removeEventListener('pointerenter', move);
    host.removeEventListener('pointermove', move);
    host.removeEventListener('pointerleave', reset);
    host.removeEventListener('pointerdown', reset);
    host.removeEventListener('pointercancel', reset);
    win.removeEventListener('blur', reset);
    doc.removeEventListener('visibilitychange', visibility);
    reduced.removeEventListener('change', mediaChange);
    contrast.removeEventListener('change', mediaChange);
  };
}
