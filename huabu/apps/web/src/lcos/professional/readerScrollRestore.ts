/** A DOM adapter for the existing Reader position memory, not another scroll
 * store. Attach only after the exact revision's renderer reports completion.
 * Late image sizing may finish an initial restore; explicit user input wins. */
export function attachReaderScrollRestore(node: HTMLElement, scrollTop: number) {
  let pending = true;
  let disposed = false;
  let frame = 0;
  const desired = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
  const images = Array.from(node.querySelectorAll('img'));
  const detachInput = () => {
    node.removeEventListener('wheel', cancel);
    node.removeEventListener('touchstart', cancel);
    node.removeEventListener('pointerdown', cancel);
    node.removeEventListener('keydown', onKey);
  };
  const cleanup = () => {
    cancelAnimationFrame(frame);
    observer?.disconnect();
    for (const image of images) { image.removeEventListener('load', schedule); image.removeEventListener('error', schedule); }
    detachInput();
  };
  function cancel() { pending = false; cleanup(); }
  function onKey(event: KeyboardEvent) {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) cancel();
  }
  function attempt() {
    if (!pending || disposed || !node.isConnected || node.clientHeight <= 0) return;
    const maximum = Math.max(0, node.scrollHeight - node.clientHeight);
    node.scrollTop = Math.min(desired, maximum);
    // If pending images can still expand the document, keep the original
    // target. A shorter fully-rendered document is safely clamped once.
    if (maximum >= desired || images.every(image => image.complete)) cancel();
  }
  function schedule() {
    if (!pending || disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(attempt);
  }
  const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
  observer?.observe(node);
  const measure = node.querySelector('.lcos-reader-measure');
  if (measure) observer?.observe(measure);
  for (const image of images) { image.addEventListener('load', schedule); image.addEventListener('error', schedule); }
  node.addEventListener('wheel', cancel, { passive: true });
  node.addEventListener('touchstart', cancel, { passive: true });
  node.addEventListener('pointerdown', cancel, { passive: true });
  node.addEventListener('keydown', onKey);
  schedule();
  return { isPending: () => pending, cancel, dispose: () => { disposed = true; cancel(); } };
}
