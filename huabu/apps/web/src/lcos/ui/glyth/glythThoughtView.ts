import type { GlythThought } from '../../collaboration/glythThought';

export interface ThoughtViewOptions {
  readonly onOpen: () => void;
  readonly onDismiss?: () => void;
  readonly onVisibility?: (visible: boolean) => void;
  readonly reducedMotion?: boolean;
  readonly now?: () => number;
}
export interface ThoughtViewInput {
  readonly thought?: GlythThought;
  readonly engaged?: boolean;
  readonly suppressed?: boolean;
}

const DWELL = 6200;
const CHANGE_GAP = 1300;
const toneLabels = { thinking: '正在梳理', working: '正在推进', attention: '需要你', done: '已带回结果', error: '暂时中断' } as const;

/** Same DOM view runs inside the existing React floating host and the offline visual rehearsal. */
export function mountGlythThoughtView(host: HTMLElement, options: ThoughtViewOptions) {
  const doc = host.ownerDocument;
  const win = doc.defaultView!;
  const now = options.now ?? (() => Date.now());
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
    const el = doc.createElement(tag); el.className = className; return el;
  };
  const root = make('div', 'lcos-glyth-whisper lcos-soft-underlight');
  root.dataset.lcosGlythThought = '';
  root.setAttribute('role', 'group'); root.setAttribute('aria-label', '当前进展');
  const glow = make('span', 'glyth-whisper-glow lcos-soft-underlight-field'); glow.setAttribute('aria-hidden', 'true');
  const shell = make('div', 'glyth-whisper-shell lcos-soft-underlight-surface');
  const headline = make('button', 'glyth-whisper-main'); headline.type = 'button';
  const head = make('span', 'glyth-whisper-head');
  const light = make('span', 'glyth-whisper-signal'); light.setAttribute('aria-hidden', 'true');
  light.append(make('i', ''), make('i', ''), make('i', ''));
  const label = make('span', 'glyth-whisper-label');
  const arrow = make('span', 'glyth-whisper-arrow'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
  head.append(light, label, arrow);
  const copy = make('span', 'glyth-whisper-copy');
  headline.append(head, copy);
  const details = make('div', 'glyth-whisper-detail');
  const detailInner = make('div', 'glyth-whisper-detail-inner');
  const full = make('p', 'glyth-whisper-full');
  const history = make('ol', 'glyth-whisper-history'); history.setAttribute('aria-label', '最近进展');
  const foot = make('div', 'glyth-whisper-foot');
  const hint = make('span', 'glyth-whisper-hint');
  const open = make('button', 'glyth-whisper-open'); open.type = 'button'; open.textContent = '查看过程 ↗';
  foot.append(hint, open); detailInner.append(full, history, foot); details.append(detailInner);
  const live = make('span', 'glyth-whisper-live'); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  shell.append(headline, details); root.append(glow, shell, live); host.append(root);
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = options.reducedMotion ?? media.matches;
  let input: ThoughtViewInput = {};
  let current: GlythThought | undefined;
  let pending: GlythThought | undefined;
  let rows: GlythThought[] = [];
  let visible = false, destroyed = false, hovering = false, focused = false, tapExpanded = false;
  let keySeen: string | undefined, dismissed: string | undefined, scope: string | undefined;
  let shownAt = 0, revision = 0;
  let timer: number | undefined, exitTimer: number | undefined, updateTimer: number | undefined, bridgeTimer: number | undefined;
  const timers = () => { [timer, exitTimer, updateTimer, bridgeTimer].forEach(t => win.clearTimeout(t)); timer = exitTimer = updateTimer = bridgeTimer = undefined; };
  const engaged = () => hovering || focused || tapExpanded || input.engaged === true;
  const animate = (el: HTMLElement, frames: Keyframe[], duration: number) => {
    el.getAnimations().forEach(animation => animation.cancel());
    if (!reduced && typeof el.animate === 'function') el.animate(frames, { duration, easing: 'cubic-bezier(.22,.78,.2,1)' });
  };
  const hide = (immediate = false) => {
    win.clearTimeout(timer); win.clearTimeout(exitTimer);
    visible = false; root.dataset.open = 'false'; root.setAttribute('inert', '');
    options.onVisibility?.(false);
    const finish = () => { root.hidden = true; };
    if (immediate || reduced) finish(); else exitTimer = win.setTimeout(finish, 190);
  };
  const drawDetails = () => {
    const expanded = hovering || focused || tapExpanded;
    root.dataset.expanded = String(expanded);
    details.inert = !expanded;
    headline.setAttribute('aria-expanded', String(expanded));
    history.replaceChildren();
    const previous = rows.filter(row => row.key !== current?.key).slice(-2).reverse();
    for (const row of previous) { const li = make('li', ''); li.textContent = row.text; history.append(li); }
    history.hidden = previous.length === 0;
    full.textContent = current?.detail ?? ''; full.hidden = !current?.detail;
    hint.textContent = pending ? '有新进展，移开后更新' : current?.source === 'task' ? '等待新的进展摘要' : '来自当前会话';
  };
  const scheduleHide = () => {
    win.clearTimeout(timer);
    if (!current || current.sticky || engaged() || !visible) return;
    timer = win.setTimeout(() => hide(), current.tone === 'done' ? 4400 : DWELL);
  };
  const show = () => {
    if (!current || input.suppressed || doc.hidden || dismissed === current.key) return;
    win.clearTimeout(exitTimer); root.hidden = false; root.removeAttribute('inert');
    if (!visible && !reduced) animate(root, [{opacity: 0, transform: 'translateY(6px) scale(.966)'}, {opacity: 1, transform: 'translateY(0) scale(1)'}], 280);
    root.dataset.open = 'true'; visible = true;
    options.onVisibility?.(true); scheduleHide();
  };
  const present = (thought: GlythThought, shouldShow: boolean) => {
    current = thought; shownAt = now(); pending = undefined;
    const timestamp = thought.occurredAt ? Date.parse(thought.occurredAt) : NaN;
    const stale = thought.source === 'progress' && Number.isFinite(timestamp) && now() - timestamp > 60_000;
    root.dataset.tone = thought.tone; root.dataset.source = thought.source; root.dataset.stale = String(stale);
    root.dataset.reduced = String(reduced); root.dataset.revision = String(++revision);
    label.textContent = stale ? '上次进展' : thought.source === 'task' ? '当前任务' : toneLabels[thought.tone];
    // The decorative label is never a substitute for the contextual sentence.
    copy.textContent = thought.source === 'task' ? thought.text.replace(/^当前任务：/, '') : thought.text;
    headline.setAttribute('aria-label', `当前进展：${thought.text}。点击展开。`);
    live.textContent = thought.text;
    animate(copy, [{ opacity: 0, transform: 'translateY(5px)', filter: 'blur(2px)' }, { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' }], 260);
    drawDetails();
    if (shouldShow) show();
  };
  const drain = () => {
    if (!pending || engaged() || input.suppressed) return;
    win.clearTimeout(updateTimer);
    const delay = Math.max(0, CHANGE_GAP - (now() - shownAt));
    updateTimer = win.setTimeout(() => { if (pending && !engaged()) present(pending, true); }, delay);
  };
  const update = (next: ThoughtViewInput) => {
    if (destroyed) return;
    const wasEngaged = engaged(); input = next;
    const t = next.thought;
    if (!t) { timers(); current = pending = undefined; rows = []; keySeen = scope = undefined; hide(true); return; }
    if (scope !== t.scope) {
      timers(); hide(true); scope = t.scope; current = pending = undefined; rows = []; keySeen = dismissed = undefined;
      hovering = focused = tapExpanded = false;
    }
    if (keySeen !== t.key) {
      keySeen = t.key; dismissed = undefined;
      if (!rows.some(row => row.key === t.key)) rows = [...rows, t].slice(-4);
      if (!current || t.sticky || t.tone === 'done') {
        const historical = !current && (t.tone === 'done' || (t.occurredAt !== undefined && now() - Date.parse(t.occurredAt) > 60_000));
        present(t, !next.suppressed && (!historical || t.sticky));
      }
      else { pending = t; if (!engaged()) drain(); else drawDetails(); }
    }
    if (next.suppressed) { timers(); hide(true); }
    else if (engaged()) { win.clearTimeout(timer); show(); }
    else if (wasEngaged) { drain(); scheduleHide(); }
    drawDetails();
  };
  const stopPointer = (e: Event) => e.stopPropagation();
  const enter = () => { hovering = true; win.clearTimeout(bridgeTimer); show(); drawDetails(); };
  const leave = () => {
    hovering = false;
    bridgeTimer = win.setTimeout(() => { drawDetails(); drain(); scheduleHide(); }, 160);
  };
  const focusIn = () => { focused = true; show(); drawDetails(); };
  const focusOut = (event: FocusEvent) => {
    if (event.relatedTarget instanceof win.Node && root.contains(event.relatedTarget as Node)) return;
    focused = false; drawDetails(); drain(); scheduleHide();
  };
  const keydown = (event: KeyboardEvent) => {
    // Space remains a canvas pan shortcut outside this focused interactive surface.
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    if (event.key === 'Escape') {
      event.stopPropagation(); event.preventDefault(); dismissed = current?.key; hide(); options.onDismiss?.();
    }
  };
  const toggle = () => { tapExpanded = !tapExpanded; drawDetails(); scheduleHide(); };
  const openView = (event: Event) => { event.stopPropagation(); options.onOpen(); };
  const visibility = () => { root.dataset.documentHidden = String(doc.hidden); if (doc.hidden) { timers(); hide(true); } };
  const motion = () => { reduced = options.reducedMotion ?? media.matches; root.dataset.reduced = String(reduced); if (reduced) root.getAnimations({ subtree: true }).forEach(a => a.cancel()); };
  root.addEventListener('pointerdown', stopPointer); root.addEventListener('click', stopPointer); root.addEventListener('dblclick', stopPointer);
  root.addEventListener('pointerenter', enter); root.addEventListener('pointerleave', leave);
  root.addEventListener('focusin', focusIn); root.addEventListener('focusout', focusOut); root.addEventListener('keydown', keydown);
  headline.addEventListener('click', toggle); open.addEventListener('click', openView);
  doc.addEventListener('visibilitychange', visibility); media.addEventListener('change', motion);
  root.hidden = true; root.dataset.open = 'false'; root.dataset.reduced = String(reduced);
  return {
    update,
    inspect: () => ({ visible, key: current?.key, pending: pending?.key, history: rows.length, revision, destroyed }),
    destroy() {
      if (destroyed) return; destroyed = true; timers(); root.getAnimations({ subtree: true }).forEach(a => a.cancel());
      doc.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', motion); root.remove();
    },
  };
}
