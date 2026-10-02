import { useLayoutEffect, useRef } from 'react';
import { readerTabScrollLeft } from './readerTabScroll';
import { LcosButton } from '../primitives/LcosButton';

import type { ReactNode } from 'react';

import './reader-content-tabs.css';

export interface ReaderContentTab {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  /** The existing reader/group owner may provide a panel id. */
  readonly panelId?: string;
}

export interface ReaderContentTabsViewProps {
  readonly label: string;
  readonly items: readonly ReaderContentTab[];
  readonly onActivate: (id: string) => void;
  /** Owner-supplied state such as an empty message; never fabricate a file. */
  readonly emptyContent?: ReactNode;
}

/** Figma 5388:27477/80, Button instances with 104×30, 12/18 regular overrides.
 * Buttons remain native and controlled. No local tab selection, group, or history state.
 * Keep native Tab/Enter/Space rather than inventing a second roving-focus controller.
 */
export function ReaderContentTabsView({ label, items, onActivate,
  emptyContent = null }: ReaderContentTabsViewProps): React.JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const selectedId = items.find((item) => item.selected)?.id;
  useLayoutEffect(() => {
    const element = track.current;
    if (element === null || selectedId === undefined) return;
    const reveal = (): void => {
      const tab = [...element.querySelectorAll<HTMLElement>('[data-lcos-reader-content-tab]')].find((node) => node.dataset.lcosReaderContentTab === selectedId);
      if (!tab || element.clientWidth === 0) return;
      const parent = element.getBoundingClientRect(), child = tab.getBoundingClientRect();
      element.scrollLeft = readerTabScrollLeft({ scrollLeft: element.scrollLeft, viewportWidth: element.clientWidth,
        scrollWidth: element.scrollWidth, tabLeft: child.left - parent.left + element.scrollLeft, tabWidth: child.width });
    };
    reveal();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(reveal) : undefined;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [selectedId]);
  return (
    <nav className="lcos-reader-content-tabs" aria-label={label} data-lcos-reader-content-tabs>
      <div ref={track} className="lcos-reader-content-tabs-track" data-lcos-reader-content-tabs-track>
        {items.length === 0 ? emptyContent : items.map((item) => (
          <LcosButton key={item.id} type="button" appearance="oreo"
            variant={item.selected ? 'primary' : 'secondary'}
            data-lcos-reader-content-tab={item.id} data-lcos-window-tab-value={item.id} data-selected={item.selected ? 'true' : undefined}
            disabled={item.disabled} aria-current={item.selected ? 'page' : undefined}
            aria-controls={item.panelId} title={item.disabledReason ?? item.label}
            onClick={() => onActivate(item.id)}>
            {item.label}
          </LcosButton>
        ))}
      </div>
    </nav>
  );
}
