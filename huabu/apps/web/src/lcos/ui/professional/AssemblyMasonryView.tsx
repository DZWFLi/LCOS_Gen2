import { Children, isValidElement, useLayoutEffect, useRef } from 'react';
import { assemblyRowSpan, clampAssemblyItemWidth, ASSEMBLY_ITEM_WIDTH } from './assemblyBrowseGeometry';
import type { ReactNode, CSSProperties } from 'react';
import './professional-assembly.css';

/** Variable-height CSS grid in DOM order. Unlike CSS columns, appending a page
 * never redistributes earlier cards into different columns. Keys retain bodies. */
export function AssemblyMasonryView({ children, label, itemWidth = ASSEMBLY_ITEM_WIDTH.default }: {
  readonly children: ReactNode; readonly label?: string; readonly itemWidth?: number;
}): React.JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = root.current;
    if (!host) return;
    const measure = (): void => {
      if (!host.clientWidth) return; // A hidden preview preserves its last valid layout.
      // Read all heights before writing spans: interleaving them forces a full
      // layout for every card when a large page or image finishes loading.
      const spans = [...host.querySelectorAll<HTMLElement>('[data-assembly-cell-content]')].map((body) => ({
        cell: body.parentElement, span: `span ${assemblyRowSpan(body.getBoundingClientRect().height)}`,
      }));
      for (const { cell, span } of spans) {
        if (cell && cell.style.gridRowEnd !== span) cell.style.gridRowEnd = span;
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    observer?.observe(host);
    host.querySelectorAll<HTMLElement>('[data-assembly-cell-content]').forEach((body) => observer?.observe(body));
    return () => observer?.disconnect();
  }, [children, itemWidth]);
  return <div ref={root} data-lcos-assembly-waterfall className="lcos-assembly-masonry" aria-label={label}
    style={{ '--assembly-item-width': `${clampAssemblyItemWidth(itemWidth)}px` } as CSSProperties}>
    {Children.toArray(children).map((child, index) => {
      const key = isValidElement(child) && child.key !== null ? String(child.key) : String(index);
      return <div key={key} data-assembly-cell={key} className="lcos-assembly-cell">
        <div data-assembly-cell-content>{child}</div>
      </div>;
    })}
  </div>;
}
