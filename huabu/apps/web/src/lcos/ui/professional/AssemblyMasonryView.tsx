import { Children, isValidElement, useLayoutEffect, useRef, useState } from 'react';

import { clampAssemblyItemWidth, ASSEMBLY_ITEM_WIDTH } from './assemblyBrowseGeometry';
import { useProfessionalViewport } from '../../professional/professionalStageVisibility';
import { useLcosShellStore } from '../../shell/lcosShellStore';
import { useContainerPosition, useMasonry, usePositioner, useResizeObserver } from '../vendor/masonic/masonic';

import type { RenderComponentProps } from '../vendor/masonic/masonic';
import type { ReactNode } from 'react';

import './professional-assembly.css';

interface AssemblyMaterialItem {
  readonly key: string;
  readonly content: ReactNode;
}

interface AssemblyScrollState {
  readonly scrollTop: number;
  readonly height: number;
  readonly isScrolling: boolean;
}

function readAssemblyScrollMetrics(container: HTMLElement, scrollParent: HTMLElement): Pick<AssemblyScrollState, 'scrollTop' | 'height'> {
  const containerRect = container.getBoundingClientRect();
  const scrollParentRect = scrollParent.getBoundingClientRect();
  return {
    scrollTop: Math.max(0, scrollParentRect.top + scrollParent.clientTop - containerRect.top),
    height: scrollParent.clientHeight,
  };
}

function AssemblyMasonryCell({ data }: RenderComponentProps<AssemblyMaterialItem>): React.JSX.Element {
  return <div data-assembly-cell={data.key} data-assembly-cell-content className="lcos-assembly-cell-content">
    {data.content}
  </div>;
}

export function AssemblyMasonryView({ children, label, itemWidth = ASSEMBLY_ITEM_WIDTH.default, isVisible = true }: {
  readonly children: ReactNode;
  readonly label?: string;
  readonly itemWidth?: number;
  readonly isVisible?: boolean;
}): React.JSX.Element {
  const containerRef = useRef<HTMLElement | null>(null);
  const [scrollState, setScrollState] = useState<AssemblyScrollState>({ scrollTop: 0, height: 0, isScrolling: false });
  const [nativeDragActive, setNativeDragActive] = useState(false);
  const scrollingTimer = useRef<number | undefined>(undefined);
  const windowEnvironment = useLcosShellStore((state) => state.windowEnvironment);
  const viewport = useProfessionalViewport();
  const container = useContainerPosition(containerRef, [windowEnvironment, viewport.width, viewport.height, isVisible]);
  const items = Children.toArray(children).map((content, index): AssemblyMaterialItem => ({
    key: isValidElement(content) && content.key !== null ? String(content.key) : String(index),
    content,
  }));
  const itemKeySequence = JSON.stringify(items.map((item) => item.key));
  const columnGutter = container.width <= 480 ? 16 : 24;
  const positioner = usePositioner({
    width: Math.max(1, container.width),
    columnWidth: clampAssemblyItemWidth(itemWidth),
    columnGutter,
    rowGutter: 24,
  }, [itemKeySequence]);
  const resizeObserver = useResizeObserver(positioner);

  useLayoutEffect(() => {
    const scrollParent = containerRef.current?.closest<HTMLElement>('.lcos-assembly-scroll');
    if (scrollParent === undefined || scrollParent === null) return;

    const syncViewport = (isScrolling = false): void => {
      const metrics = readAssemblyScrollMetrics(containerRef.current ?? scrollParent, scrollParent);
      setScrollState((current) => {
        const next = { ...metrics, isScrolling };
        return current.scrollTop === next.scrollTop && current.height === next.height && current.isScrolling === next.isScrolling
          ? current : next;
      });
    };
    let animationFrame: number | undefined;
    const onScroll = (): void => {
      if (animationFrame !== undefined) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = undefined;
        syncViewport(true);
        if (scrollingTimer.current !== undefined) window.clearTimeout(scrollingTimer.current);
        scrollingTimer.current = window.setTimeout(() => {
          scrollingTimer.current = undefined;
          setScrollState((current) => current.isScrolling ? { ...current, isScrolling: false } : current);
        }, 120);
      });
    };
    syncViewport();
    scrollParent.addEventListener('scroll', onScroll, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => syncViewport()) : undefined;
    observer?.observe(scrollParent);

    return () => {
      scrollParent.removeEventListener('scroll', onScroll);
      observer?.disconnect();
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      if (scrollingTimer.current !== undefined) window.clearTimeout(scrollingTimer.current);
      scrollingTimer.current = undefined;
    };
  }, [container.width, viewport.height, isVisible]);

  useLayoutEffect(() => {
    const containerElement = containerRef.current;
    const scrollParent = containerElement?.closest<HTMLElement>('.lcos-assembly-scroll');
    if (containerElement === null || containerElement === undefined || scrollParent === null || scrollParent === undefined) return;
    const metrics = readAssemblyScrollMetrics(containerElement, scrollParent);
    setScrollState((current) => current.scrollTop === metrics.scrollTop && current.height === metrics.height
      ? current : { ...current, ...metrics });
  }, [children]);

  const masonry = useMasonry({
    as: 'div',
    className: 'lcos-assembly-masonry',
    containerRef,
    height: Math.max(1, scrollState.height),
    isScrolling: scrollState.isScrolling && !nativeDragActive,
    itemAs: 'div',
    itemHeightEstimate: 300,
    itemKey: (item) => item.key,
    itemStyle: { minInlineSize: 0 },
    items,
    // Keep native drag sources mounted while the scroll parent autoscrolls.
    overscanBy: nativeDragActive ? Math.max(2, items.length * 4) : 2,
    positioner,
    render: AssemblyMasonryCell,
    resizeObserver,
    role: 'list',
    scrollTop: scrollState.scrollTop,
    tabIndex: -1,
  });

  return <div data-lcos-assembly-waterfall className="lcos-assembly-masonry-viewport" role="region" aria-label={label}
    onDragStartCapture={() => setNativeDragActive(true)} onDragEndCapture={() => setNativeDragActive(false)}>
    {masonry}
  </div>;
}
