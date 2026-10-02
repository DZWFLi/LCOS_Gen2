import { useEffect, useRef } from 'react';
import { RotateCw } from 'lucide-react';
import { Gen1CollectionGlyph } from './Gen1CollectionGlyph';
import type { ReactNode } from 'react';
import './gen1-collection.css';

export interface Gen1CollectionFaceProps {
  readonly title: string;
  readonly onActivate?: (() => void) | undefined;
  readonly activationLabel?: string | undefined;
  readonly selected?: boolean | undefined;
  readonly action?: ReactNode;
  readonly count?: number | undefined;
  readonly previews?: readonly ReactNode[] | undefined;
  /** Fully formed original G1 sheet elements; data loading lives in the adapter. */
  readonly sheets?: readonly ReactNode[] | undefined;
  readonly dragging?: boolean | undefined;
  readonly expanded?: boolean | undefined;
  readonly compact?: boolean | undefined;
  readonly suppressActivation?: boolean | undefined;
  readonly disabledReason?: string | undefined;
  readonly onToggle?: (() => void | Promise<boolean>) | undefined;
  readonly readError?: string | undefined;
  readonly onRetry?: (() => void) | undefined;
}

/** GEN1's folder is the action surface. Pointer observation never claims the
 * drag or changes selection; only an unmodified, non-drag click opens it. */
export function Gen1CollectionFace({ title, count, previews = [], sheets, dragging = false, expanded = false, compact = false,
  suppressActivation, disabledReason, onToggle, onActivate, activationLabel, selected, action, readError, onRetry }: Gen1CollectionFaceProps): React.JSX.Element {
  const activate = onToggle ?? onActivate;
  const press = useRef<{ x: number; y: number; moved: boolean; blocked: boolean } | null>(null);
  const stopObserving = useRef<() => void>(() => {});
  useEffect(() => () => stopObserving.current(), []);
  return <div className={`lcos-simple-collection${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}`} data-lcos-simple-collection data-expanded={expanded}
    data-selected={selected} data-has-action={!!action && !onToggle} data-compact={compact} role={activate ? 'button' : undefined} tabIndex={activate ? 0 : undefined}
    aria-label={activationLabel ?? `${expanded ? '收起' : '展开'}集合：${title}`} aria-expanded={onToggle ? expanded : undefined}
    aria-disabled={disabledReason ? true : undefined} title={disabledReason ?? title}
    onPointerDownCapture={(event) => {
      stopObserving.current();
      const target = event.target as Element;
      press.current = { x: event.clientX, y: event.clientY, moved: false,
        blocked: !!suppressActivation || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
          || !!target.closest('button, input, textarea, [contenteditable="true"]') };
      const pointerId = event.pointerId;
      const move = (e: PointerEvent) => { if (e.pointerId === pointerId && press.current
        && Math.hypot(e.clientX - press.current.x, e.clientY - press.current.y) > 4) press.current.moved = true; };
      const cancel = (e: PointerEvent) => { if (e.pointerId === pointerId) { if (press.current) press.current.blocked = true; stopObserving.current(); } };
      const up = (e: PointerEvent) => { if (e.pointerId === pointerId) stopObserving.current(); };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointercancel', cancel, true);
      window.addEventListener('pointerup', up, true);
      stopObserving.current = () => {
        window.removeEventListener('pointermove', move, true); window.removeEventListener('pointercancel', cancel, true);
        window.removeEventListener('pointerup', up, true);
      };
    }}
    onClick={(event) => {
      const gesture = press.current; press.current = null;
      if (!activate || disabledReason || event.defaultPrevented || suppressActivation || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey
        || gesture?.blocked || gesture?.moved || (event.target as Element).closest('button, input, textarea, a[href]')) return;
      event.stopPropagation(); void activate();
    }}
    onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget || event.key !== 'Enter' || event.repeat || event.nativeEvent.isComposing
        || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || suppressActivation || disabledReason || !activate) return;
      event.preventDefault(); event.stopPropagation(); void activate();
    }}>
    {/* G1 CollectionObject anatomy, not a separately designed Context card.
        Only the Chinese labels and G2 read/command adapters differ. */}
    <div className={`lcos-object lcos-collection-object lcos-material-face is-collection ${expanded ? 'is-expanded' : 'is-collapsed'}`}>
      <div className="lcos-collection-stack" aria-hidden={sheets?.length ? undefined : true}>
        {!compact && sheets?.length ? sheets : !compact && previews.length
          ? previews.slice(0, 3).map((preview, index) => <span key={index} className={`lcos-collection-stack-sheet stack-sheet-${index}`}>{preview}</span>)
          : <><i className="lcos-collection-stack-sheet stack-sheet-0"/><i className="lcos-collection-stack-sheet stack-sheet-1"/></>}
      </div>
      <div className="lcos-collection-folder-face">
        <span className="lcos-collection-folder-tab">集合</span>
        <div className="lcos-collection-folder-copy"><small>{count === undefined ? '读取中' : `${count} 项`}</small><strong>{title}</strong></div>
        <span className="lcos-collection-folder-mark" aria-hidden="true"><Gen1CollectionGlyph/></span>
        <span className="lcos-collection-folder-state" aria-hidden="true">{expanded ? '−' : '+'}</span>
      </div>
    </div>
    {action && !onToggle && <div className="lcos-simple-collection-action" onPointerDown={(event)=>event.stopPropagation()} onClick={(event)=>event.stopPropagation()}>{action}</div>}
    {readError && <button type="button" className="lcos-simple-collection-error" title={readError} aria-label="重读集合成员"
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRetry?.(); }}>
      <RotateCw size={12} aria-hidden/><span>重读</span>
    </button>}
  </div>;
}
