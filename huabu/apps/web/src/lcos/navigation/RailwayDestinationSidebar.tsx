/**
 * Adapted from rare-ui/components/ui/hook-sidebar.tsx::HookSidebar
 * (swamimalode07/rare-ui@b4de46efe4eb2613e22bb8134b482ed4e0c7736a).
 * Copyright (c) 2026 Swami Malode. MIT + Commons Clause License Condition v1.0 + Attribution.
 * Keeps the controlled active/hover rail and reduced-motion behavior; trims Next routing
 * and adds destination identity, disabled state, busy state, and the existing Drop target ref.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import type { RailwayReceivePresentation } from './railwayReceivePresentation';
import type { DragEvent } from 'react';

export interface RailwayDestinationSidebarItem {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly disabled?: boolean;
  readonly receivePresentation?: RailwayReceivePresentation;
  readonly onElement?: (element: HTMLButtonElement | null) => void;
  /** Container-owned same-project destination reorder; Semantic Drop remains separate. */
  readonly draggable?: boolean;
  readonly onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly reorderDropTarget?: boolean;
  readonly reorderDropPosition?: 'before' | 'after';
}

export interface RailwayDestinationSidebarProps {
  readonly items: readonly RailwayDestinationSidebarItem[];
  readonly activeKey?: string;
  readonly busy: boolean;
  readonly onSelect: (key: string) => void;
}

const CORNER = 6;
const DASH = 'repeating-linear-gradient(to top, transparent 0 2px, currentColor 2px 4px)';

function Rail({
  from = 0,
  y,
  visible,
  color,
  dashed,
}: {
  readonly from?: number;
  readonly y: number | null;
  readonly visible: boolean;
  readonly color?: string;
  readonly dashed: boolean;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const travel = reduced
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.7 };

  return (
    <motion.span
      aria-hidden
      initial={false}
      style={{ color }}
      animate={{ opacity: visible && y !== null ? 1 : 0 }}
      transition={reduced ? { duration: 0 } : { duration: 0.2 }}
      className="lcos-railway-sidebar-rail"
    >
      <motion.span
        initial={false}
        animate={{ top: from, height: Math.max(0, (y ?? 0) - CORNER - from) }}
        transition={travel}
        style={dashed ? { backgroundImage: DASH } : { backgroundColor: 'currentColor' }}
        className="lcos-railway-sidebar-rail-line"
      />
      <motion.svg
        initial={false}
        animate={{ top: (y ?? 0) - CORNER }}
        transition={travel}
        width="12"
        height="7"
        viewBox="0 0 12 7"
        fill="none"
        className="lcos-railway-sidebar-rail-corner"
      >
        <path
          d="M0.5 0a6 6 0 0 0 6 6H12"
          stroke="currentColor"
          strokeDasharray={dashed ? '2 2' : undefined}
        />
      </motion.svg>
    </motion.span>
  );
}

/** A controlled overflow destination list; Core keys remain the selection identity. */
export function RailwayDestinationSidebar({
  items,
  activeKey,
  busy,
  onSelect,
}: RailwayDestinationSidebarProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const itemRefCallbacks = useRef(new Map<string, (element: HTMLButtonElement | null) => void>());
  const externalRefCallbacks = useRef(new Map<string, RailwayDestinationSidebarItem['onElement']>());
  const descriptionIdPrefix = useId();
  const [centers, setCenters] = useState<number[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const activeIndex = items.findIndex((item) => item.key === activeKey);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => setCenters(items.map((item) => {
      const element = itemRefs.current.get(item.key);
      return element ? element.offsetTop + element.offsetHeight / 2 : 0;
    }));

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [items.length]);

  const activeY = activeIndex < 0 ? null : (centers[activeIndex] ?? null);
  const hoverY = hoverIndex === null ? null : (centers[hoverIndex] ?? null);
  const hoverFrom = activeY !== null && hoverY !== null && hoverY <= activeY
    ? Math.max(0, hoverY - CORNER)
    : (activeY ?? 0);
  const itemRef = (item: RailwayDestinationSidebarItem) => {
    externalRefCallbacks.current.set(item.key, item.onElement);
    let callback = itemRefCallbacks.current.get(item.key);
    if (!callback) {
      callback = (element) => {
        if (element) itemRefs.current.set(item.key, element);
        else itemRefs.current.delete(item.key);
        externalRefCallbacks.current.get(item.key)?.(element);
      };
      itemRefCallbacks.current.set(item.key, callback);
    }
    return callback;
  };

  return (
    <nav
      data-lcos-railway-destination-sidebar
      data-slot="hook-sidebar"
      aria-label="其余现场目的地"
      aria-busy={busy || undefined}
      className="lcos-railway-destination-sidebar"
    >
      <div
        ref={listRef}
        onMouseLeave={() => setPointerInside(false)}
        className="lcos-railway-destination-sidebar-list"
      >
        <Rail
          from={hoverFrom}
          y={hoverY}
          visible={(pointerInside || focusInside) && hoverIndex !== activeIndex}
          dashed
        />
        <Rail
          y={activeY}
          visible={activeY !== null}
          color="var(--gen2-accent)"
          dashed
        />
        {items.map((item, index) => {
          const selected = item.key === activeKey;
          const disabled = busy || item.disabled === true;
          const descriptionId = `${descriptionIdPrefix}-${index}`;
          return (
            <button
              key={item.key}
              ref={itemRef(item)}
              type="button"
              data-slot="hook-sidebar-item"
              data-active={selected ? 'true' : undefined}
              data-lcos-railway-overflow-open
              data-lcos-railway-destination-key={item.key}
              data-lcos-railway-reorder-target={item.reorderDropTarget ? 'true' : undefined}
              data-lcos-railway-reorder-position={item.reorderDropTarget ? item.reorderDropPosition : undefined}
              data-lcos-receive-state={item.receivePresentation}
              aria-current={selected ? 'page' : undefined}
              aria-label={item.label}
              aria-describedby={item.description ? descriptionId : undefined}
              aria-busy={busy || undefined}
              title={item.label}
              disabled={disabled}
              draggable={item.draggable === true && !disabled}
              onMouseEnter={() => {
                setHoverIndex(index);
                setPointerInside(true);
              }}
              onFocus={() => {
                setHoverIndex(index);
                setFocusInside(true);
              }}
              onBlur={() => setFocusInside(false)}
              onClick={() => {
                if (!disabled) onSelect(item.key);
              }}
              onDragStart={item.onDragStart}
              onDragOver={item.onDragOver}
              onDrop={item.onDrop}
              onDragEnd={item.onDragEnd}
              className="lcos-railway-destination-sidebar-item"
            >
              <strong>{item.label}</strong>
              <small id={descriptionId} data-lcos-railway-overflow-state={item.receivePresentation}>{item.description}</small>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
