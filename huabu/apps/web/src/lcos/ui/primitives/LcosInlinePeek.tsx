import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import './inline-peek.css';

export interface LcosInlinePeekProps {
  readonly label: string;
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

/** Read-only disclosure in normal flow: no portal, window, router or domain state.
 * Hover/focus previews; click pins. Esc consumes only this open disclosure.
 * Kept local so it cannot change Selection, Receiver, Camera or draft ownership.
 */
export function LcosInlinePeek({ label, summary, children, action, className }: LcosInlinePeekProps): React.JSX.Element {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const enterTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  const hovering = useRef(false);
  const keyboardInside = useRef(false);
  const dismissed = useRef(false);
  const pinnedRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [pinned, setPinned] = useState(false);
  const clearTimers = useCallback(() => {
    window.clearTimeout(enterTimer.current);
    window.clearTimeout(leaveTimer.current);
  }, []);
  const close = useCallback(() => {
    clearTimers(); pinnedRef.current = false; setPinned(false); setExpanded(false);
  }, [clearTimers]);
  useEffect(() => () => {
    window.clearTimeout(enterTimer.current);
    window.clearTimeout(leaveTimer.current);
  }, []);
  useLayoutEffect(() => { content.current?.toggleAttribute('inert', !expanded); }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    // A hover-only preview also needs Esc while keyboard focus is elsewhere.
    // Install only while visible, and only handle the hovered/focused instance.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const modal = document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]');
      if (modal && !modal.contains(root.current)) return;
      const ownsFocus = event.target instanceof Node && root.current?.contains(event.target);
      if (!hovering.current && !ownsFocus) return;
      event.preventDefault(); event.stopPropagation(); dismissed.current = true;
      close();
      if (ownsFocus) trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, [expanded, close]);
  return <div ref={root} className={['lcos-inline-peek', className].filter(Boolean).join(' ')}
    onDragStartCapture={() => { close(); hovering.current = false; }}
    data-lcos-inline-peek data-expanded={expanded ? 'true' : 'false'} data-pinned={pinned || undefined}
    onPointerEnter={(event) => {
      if (event.pointerType === 'touch' || event.buttons !== 0) return;
      hovering.current = true; dismissed.current = false;
      clearTimers();
      enterTimer.current = window.setTimeout(() => {
        if (hovering.current && !dismissed.current) setExpanded(true);
      }, 180);
    }}
    onPointerLeave={() => {
      hovering.current = false; window.clearTimeout(enterTimer.current);
      leaveTimer.current = window.setTimeout(() => {
        if (!hovering.current && !keyboardInside.current && !pinnedRef.current) setExpanded(false);
      }, 160);
    }}
    onPointerDown={(event) => { if (event.buttons !== 0) window.clearTimeout(enterTimer.current); }}
    onFocusCapture={(event) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      if (!event.target.matches(':focus-visible')) return;
      keyboardInside.current = true; clearTimers();
      if (!dismissed.current) setExpanded(true);
    }}
    onBlurCapture={(event) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      keyboardInside.current = false; dismissed.current = false;
      if (!hovering.current && !pinnedRef.current) setExpanded(false);
    }}
    onKeyDown={(event) => {
      if (event.key !== 'Escape' || !expanded) return;
      event.preventDefault(); event.stopPropagation(); dismissed.current = true;
      close(); trigger.current?.focus({ preventScroll: true });
    }}>
    <div className="lcos-inline-peek-heading">
      <button ref={trigger} type="button" className="lcos-inline-peek-trigger"
        aria-label={label} aria-controls={id} aria-expanded={expanded}
        onClick={() => {
          clearTimers();
          if (pinnedRef.current) { dismissed.current = true; close(); }
          else { dismissed.current = false; pinnedRef.current = true; setPinned(true); setExpanded(true); }
        }}>
        <span className="lcos-inline-peek-summary">{summary}</span>
        <svg className="lcos-inline-peek-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {action == null ? null : <div className="lcos-inline-peek-action">{action}</div>}
    </div>
    <div id={id} ref={content} className="lcos-inline-peek-content" aria-hidden={!expanded}>
      <div className="lcos-inline-peek-clip"><div className="lcos-inline-peek-detail">{children}</div></div>
    </div>
  </div>;
}
