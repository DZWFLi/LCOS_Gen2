/** Object-local material response. Adapted from LCOS W1's time-based pointer damping.
 * Observes input only: no pointer capture, preventDefault, programmatic focus, scrolling, Core state or window.
 * One delegated controller per mounted ProjectShell. Selectors are an explicit allowlist.
 */
export interface ObjectFeedbackOptions {
  readonly selector?: string;
  readonly enabled?: boolean;
}
export const LCOS_FEEDBACK_TARGETS = [
  '[data-lcos-optic]',
  '[data-lcos-railway-item]',
  '[data-lcos-window-icon-button]',
  '.lcos-composer-reference-open',
  '.lcos-composer-reference-remove',
  '.lcos-composer-tool-hit',
  '.lcos-inline-peek-trigger',
  '.lcos-member-open',
  '.glyth-whisper-main',
  '.glyth-whisper-open',
  '.lcos-action-orb-hit',
  '.lcos-assembly-item-actions button',
  '.lcos-assembly-primary-action button',
  '[data-lcos-diagnostics-toggle]',
].join(',');

export function mountObjectFeedback(scope: Document | HTMLElement, options: ObjectFeedbackOptions = {}) {
  const doc = scope.nodeType === 9 ? scope as Document : scope.ownerDocument!;
  const win = doc.defaultView!;
  const selector = options.selector ?? LCOS_FEEDBACK_TARGETS;
  const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  const contrast = win.matchMedia?.('(forced-colors: active)');
  let disposed = false, enabled = options.enabled ?? true;
  let active: HTMLElement | null = null, frame = 0, timer = 0;
  let x = 50, y = 50, tx = 50, ty = 50, last = 0, writes = 0;
  let kind: 'hover' | 'focus' | 'press' = 'hover';
  const props = ['--lcos-optic-x', '--lcos-optic-y'] as const;
  let previous: { name: string; value: string; priority: string }[] = [];
  let observed: MutationObserver | null = null;
  const allowed = (node: HTMLElement) => !disposed && enabled && node.isConnected && !doc.hidden
    && !node.closest('[hidden],[inert],[aria-hidden="true"],[disabled],[aria-disabled="true"],[data-lcos-optic-off]');
  const motion = () => !reduce?.matches && !contrast?.matches;
  const stop = () => { if (frame) win.cancelAnimationFrame(frame); frame = 0; last = 0; };
  const reset = () => {
    stop(); win.clearTimeout(timer); timer = 0; observed?.disconnect();
    if (active) {
      active.classList.remove('lcos-optic-live');
      delete active.dataset.lcosOpticMode;
      for (const old of previous) {
        if (old.value) active.style.setProperty(old.name, old.value, old.priority);
        else active.style.removeProperty(old.name);
      }
    }
    active = null; previous = [];
  };
  const paint = () => {
    if (!active) return;
    active.style.setProperty('--lcos-optic-x', x.toFixed(2) + '%');
    active.style.setProperty('--lcos-optic-y', y.toFixed(2) + '%'); writes++;
  };
  const tick = (time: number) => {
    frame = 0;
    if (!active || !allowed(active) || !motion()) { reset(); return; }
    const dt = last ? Math.min(48, time - last) : 16; last = time;
    const gain = 1 - Math.exp(-dt / 65);
    x += (tx - x) * gain; y += (ty - y) * gain;
    paint();
    if (Math.abs(tx - x) + Math.abs(ty - y) > .1) frame = win.requestAnimationFrame(tick);
    else { x = tx; y = ty; paint(); last = 0; }
  };
  const find = (event: Event): HTMLElement | null => {
    const target = event.target;
    if (!(target instanceof win.Element)) return null;
    const node = target.closest<HTMLElement>(selector);
    return node && (scope.nodeType === 9 || (scope as HTMLElement).contains(node)) ? node : null;
  };
  const enter = (node: HTMLElement, nextKind: typeof kind, event?: PointerEvent) => {
    if (!allowed(node) || contrast?.matches) { reset(); return; }
    if (active !== node) {
      reset(); active = node; x = tx = 50; y = ty = 55;
      previous = props.map(name => ({name, value: node.style.getPropertyValue(name), priority: node.style.getPropertyPriority(name)}));
      active.classList.add('lcos-optic-live');
      observed ??= new win.MutationObserver(() => { if (active && !allowed(active)) reset(); });
      // Observe only the current element and its ancestry, not the whole changing canvas.
      for (let p: HTMLElement | null = node; p; p = p.parentElement) {
        observed.observe(p, {attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'disabled', 'aria-disabled', 'data-lcos-optic-off']});
      }
    }
    win.clearTimeout(timer); kind = nextKind; node.dataset.lcosOpticMode = kind;
    if (event) {
      const b = node.getBoundingClientRect();
      tx = b.width > 0 ? Math.max(0, Math.min(100, 100 * (event.clientX - b.left) / b.width)) : 50;
      ty = b.height > 0 ? Math.max(0, Math.min(100, 100 * (event.clientY - b.top) / b.height)) : 55;
    }
    if (!motion()) { x = tx = 50; y = ty = 55; paint(); return; }
    if (!frame) frame = win.requestAnimationFrame(tick);
  };
  const pointer = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType === 'touch') return;
    if (e.buttons !== 0) { reset(); return; }
    const node = find(e);
    if (node) enter(node, 'hover', e); else if (kind !== 'focus') reset();
  };
  const out = (event: Event) => {
    const e = event as PointerEvent;
    if (!active) return;
    if (e.relatedTarget instanceof win.Node && active.contains(e.relatedTarget)) return;
    if (kind === 'hover') reset();
  };
  const down = (event: Event) => {
    const e = event as PointerEvent;
    // During drag use the owner's own drag feedback. A tap pulse is not a success receipt.
    if (e.button !== 0) { reset(); return; }
    const node = find(e); if (!node) { reset(); return; }
    enter(node, 'press', e); stop(); x = tx; y = ty; paint();
    timer = win.setTimeout(reset, 130);
  };
  const focus = (event: Event) => { const n = find(event); if (n) enter(n, 'focus'); };
  const blur = (event: Event) => {
    const related = (event as FocusEvent).relatedTarget;
    if (active && related instanceof win.Node && active.contains(related)) return;
    if (kind === 'focus') reset();
  };
  const inactive = () => reset();
  const listeners: [string, EventListener][] = [
    ['pointerover', pointer], ['pointermove', pointer], ['pointerout', out],
    ['pointerdown', down], ['pointercancel', inactive], ['dragstart', inactive],
    ['focusin', focus], ['focusout', blur], ['scroll', inactive],
  ];
  for (const [name, handler] of listeners) scope.addEventListener(name, handler, {passive: true, capture: true});
  win.addEventListener('blur', inactive); doc.addEventListener('visibilitychange', inactive);
  reduce?.addEventListener?.('change', inactive); contrast?.addEventListener?.('change', inactive);
  return {
    setEnabled(value: boolean) { enabled = value; if (!value) reset(); },
    inspect: () => ({active: active?.getAttribute('aria-label') ?? active?.className ?? null, running: frame !== 0, writes, kind, reduced: reduce?.matches ?? false, disposed}),
    destroy() {
      if (disposed) return; disposed = true; reset();
      for (const [name, handler] of listeners) scope.removeEventListener(name, handler, true);
      win.removeEventListener('blur', inactive); doc.removeEventListener('visibilitychange', inactive);
      reduce?.removeEventListener?.('change', inactive); contrast?.removeEventListener?.('change', inactive);
    },
  };
}
