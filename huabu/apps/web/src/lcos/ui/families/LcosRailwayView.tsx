// LcosRailwayView — 共享组件族 Railway 的纯视图（Figma 5385:283，目的地 1/4）。
// 几何取自 structures/railway：pad 8 · gap 6 · item 36×36 r10 → 1 目的地 hug 52，
// 4 目的地 hug 178（8+36×4+6×3+8），与 Figma 两个变体尺寸都能对上，故不写死高度。
// 目的地数量是唯一变体轴；hover 预览 / Enter 进入 / 拖动重排由 container 负责。

import type { ComponentType, DragEvent } from 'react';

export interface LcosRailwayViewItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** Container-owned ref used to publish live receive geometry. */
  readonly onElement?: (element: HTMLButtonElement | null) => void;
  /** Container-owned direct manipulation; this is reorder, never Receive. */
  readonly draggable?: boolean;
  readonly onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDragOver?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDrop?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDragEnd?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly reorderDropTarget?: boolean;
}

export interface LcosRailwayViewProps {
  readonly items: readonly LcosRailwayViewItem[];
  readonly onSelect?: (key: string) => void;
  /** 额外脚注（例如 rail order 读取结果）；不参与变体。 */
  readonly footer?: string;
}

export function LcosRailwayView({ items, onSelect, footer }: LcosRailwayViewProps): React.JSX.Element {
  const railwayHeight =
    items.length === 0 ? 0 : 16 + items.length * 36 + (items.length - 1) * 6;
  return (
    // 脚注与岛同级（不是岛的子节点）：Figma 的 52×52 / 52×178 只描述目的地数量，
    // 把脚注塞进容器会撑高外框、破坏变体尺寸。
    <>
      <div
        data-lcos-family="railway"
        data-lcos-variant-count={items.length}
        role="navigation"
        aria-label="现场目的地"
        style={{
          height: railwayHeight,
          maxHeight: 'min(70vh, 556px)',
          overflowY: 'auto',
        }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const variant = item.disabled ? 'disabled' : item.selected ? 'selected' : 'hover';
          return (
            <button
              key={item.key}
              ref={item.onElement}
              type="button"
              draggable={item.draggable}
              data-lcos-railway-item={item.key}
              data-lcos-railway-reorder-target={item.reorderDropTarget ? 'true' : undefined}
              data-lcos-variant={variant}
              aria-current={item.selected ? 'page' : undefined}
              disabled={item.disabled}
              title={item.label}
              aria-label={item.label}
              onClick={() => onSelect?.(item.key)}
              onDragStart={item.onDragStart}
              onDragOver={item.onDragOver}
              onDrop={item.onDrop}
              onDragEnd={item.onDragEnd}
            >
              <Icon className="h-[21px] w-[21px]" />
            </button>
          );
        })}
      </div>
      {footer && <span data-lcos-railway-footer>{footer}</span>}
    </>
  );
}
