import { useId, useState } from 'react';

import moreIcon from '../nearfield/assets/more.svg';
import { LcosButton } from '../primitives/LcosButton';
import './professional-assembly.css';

import type { HTMLAttributes, ReactNode } from 'react';

export interface AssemblyItemViewProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children'> {
  readonly title: string;
  readonly identity?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  readonly actions: ReactNode;
  readonly referenced?: boolean;
  readonly selected?: boolean;
  readonly onSelect?: () => void;
  readonly hideCaption?: boolean;
  readonly onPreview?: () => void;
}
/** GEN1 identity/reference separation; C02 actions reveal without changing masonry height. */
export function AssemblyItemView({ title, identity, subtitle, children, actions, referenced = false,
  selected = false, onSelect, onPreview, hideCaption = false, className, ...rest }: AssemblyItemViewProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  return <div {...rest} className={`lcos-assembly-item ${className ?? ''}`} data-selected={selected}
    data-referenced={referenced} data-visual-active={expanded} data-object-only={hideCaption} onKeyDownCapture={(event) => {
      rest.onKeyDownCapture?.(event);
      if (!event.defaultPrevented && event.key === 'Escape' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229 && expanded) {
        event.preventDefault(); event.stopPropagation(); setExpanded(false);
        event.currentTarget.querySelector<HTMLButtonElement>('[data-lcos-assembly-more]')?.focus();
      }
    }}>
    <div className="lcos-assembly-item-object" onDoubleClick={(event) => {
      if (!onPreview || (event.target as HTMLElement).closest('button,input,a,textarea,select,[contenteditable="true"]') || window.getSelection()?.toString()) return;
      event.stopPropagation();
      event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-lcos-assembly-quick-preview]')?.focus({ preventScroll: true });
      onPreview();
    }}>{children}</div>
    {onPreview ? <LcosButton appearance="oreo" variant="ghost" className="lcos-assembly-preview-trigger" aria-label={`预览 ${title}`}
      data-lcos-assembly-quick-preview onClick={onPreview}>预览</LcosButton> : null}
    {onSelect ? <label className="lcos-assembly-select" title={`选择 ${title}`} onPointerDown={(event) => event.stopPropagation()}>
      <input type="checkbox" aria-label={`选择 ${title}`} checked={selected} onChange={onSelect} />
    </label> : null}
    {!hideCaption ? <div className="lcos-assembly-item-caption"><strong title={title}>{title}</strong>
      <span>{identity}{subtitle ? <>{identity ? ' · ' : ''}{subtitle}</> : null}</span></div> : null}
    {referenced ? <span className="lcos-assembly-draft-mark">已在草稿</span> : null}
    <LcosButton variant="ghost" data-lcos-assembly-more aria-label={`取用 ${title}`} aria-expanded={expanded}
      aria-controls={id} className="lcos-assembly-more" onClick={() => setExpanded((current) => !current)}>
      <img src={moreIcon} alt="" width={18} height={18} /><span>取用</span>
    </LcosButton>
    <div id={id} data-lcos-assembly-actions className="lcos-assembly-item-actions">{actions}</div>
  </div>;
}
