// LcosRailwayView — 共享组件族 Railway 的纯视图（Figma 5385:283，目的地 1/4）。
// 几何取自 structures/railway：pad 8 · gap 6 · item 36×36 r10 → 1 目的地 hug 52，
// 4 目的地 hug 178（8+36×4+6×3+8），与 Figma 两个变体尺寸都能对上，故不写死高度。
// 目的地数量是唯一变体轴；hover 预览 / Enter 进入 / 拖动重排由 container 负责。

import { FigmaShellGlyph } from '../FigmaShellGlyph';
import { LcosIconButton } from '../primitives/LcosIconButton';

import type { RailwayReceivePresentation } from '../../navigation/railwayReceivePresentation';
import type { FigmaShellGlyphName } from '../FigmaShellGlyph';
import type { ComponentType, DragEvent, ReactNode } from 'react';

export interface LcosRailwayViewItem {
  readonly key: string;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  /** 仅视觉替换。未映射时保留 container 已提供的真实图标。 */
  readonly glyph?: FigmaShellGlyphName;
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
  readonly reorderDropPosition?: 'before' | 'after';
  /** Shared Semantic Drop projection for this exact live target. */
  readonly receivePresentation?: RailwayReceivePresentation;
  /** Opens the canonical destination peek while the pointer/focus is on this item. */
  readonly onPeekEnter?: () => void;
  readonly onPeekLeave?: () => void;
  readonly onManage?: () => void;
  readonly peekOpen?: boolean;
  /** Peek content is supplied by the Railway container from its Core projection. */
  readonly peek?: ReactNode;
  readonly moreOpen?: boolean;
  /** More content is supplied by the Railway container; it never owns truth. */
  readonly more?: ReactNode;
}

export interface LcosRailwayViewProps {
  readonly items: readonly LcosRailwayViewItem[];
  readonly onSelect?: (key: string) => void;
  /** Complete Core order count, including compatibility rows hidden from the island. */
  readonly canonicalTotal?: number;
  /** Count represented by the real overflow view, never a decorative approximation. */
  readonly overflowCount?: number;
  readonly overflowOpen?: boolean;
  readonly onOverflowToggle?: () => void;
  readonly onOverflowEnter?: () => void;
  readonly onOverflowLeave?: () => void;
  readonly overflow?: ReactNode;
  /** Canonical active Receiver identity, kept outside the ordered destination island. */
  readonly receiver?: ReactNode;
  /** 额外脚注（例如 rail order 读取结果）；不参与变体。 */
  readonly footer?: ReactNode;
}

export function LcosRailwayView({
  items,
  onSelect,
  canonicalTotal = items.length,
  overflowCount = 0,
  overflowOpen = false,
  onOverflowToggle,
  onOverflowEnter,
  onOverflowLeave,
  overflow,
  receiver,
  footer,
}: LcosRailwayViewProps): React.JSX.Element {
  const railwayHeight =
    items.length === 0 ? 0 : 16 + items.length * 36 + (items.length - 1) * 6;
  return (
    // 脚注与岛同级（不是岛的子节点）：Figma 的 52×52 / 52×178 只描述目的地数量，
    // 把脚注塞进容器会撑高外框、破坏变体尺寸。
    <>
      <div
        data-lcos-family="railway"
        data-lcos-variant-count={items.length}
        data-lcos-railway-canonical-total={canonicalTotal}
        role="navigation"
        aria-label="现场目的地"
        style={{
          height: railwayHeight,
          maxHeight: 'min(70vh, 556px)',
          overflow: 'visible',
        }}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const variant = item.disabled ? 'disabled' : item.selected ? 'selected' : 'resting';
          return (
            <div
              key={item.key}
              data-lcos-railway-entry={item.key}
              data-lcos-receive-state={item.receivePresentation}
              data-lcos-railway-reorder-position={item.reorderDropTarget ? item.reorderDropPosition : undefined}
              onMouseEnter={item.onPeekEnter}
              onMouseLeave={item.onPeekLeave}
              onBlur={(event) => {
                const next = event.relatedTarget;
                if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
                  item.onPeekLeave?.();
                }
              }}
            >
              <LcosIconButton
                ref={item.onElement}
                type="button"
                draggable={item.draggable}
                data-lcos-railway-item={item.key}
                data-lcos-railway-reorder-target={item.reorderDropTarget ? 'true' : undefined}
                data-lcos-receive-state={item.receivePresentation}
                data-lcos-variant={variant}
                aria-current={item.selected ? 'page' : undefined}
                aria-disabled={item.disabled || undefined}
                title={item.label}
                aria-label={item.label}
                onFocus={item.onPeekEnter}
                onContextMenu={(event) => { if (item.onManage) { event.preventDefault(); event.stopPropagation(); item.onManage(); } }}
                onClick={() => { if (!item.disabled) onSelect?.(item.key); }}
                onDragStart={item.onDragStart}
                onDragOver={item.onDragOver}
                onDrop={item.onDrop}
                onDragEnd={item.onDragEnd}
              >
                {item.glyph === undefined ? <Icon className="h-[21px] w-[21px]" />
                  : <FigmaShellGlyph name={item.glyph} size={21} />}
              </LcosIconButton>
              {item.peekOpen && item.peek}
              {item.moreOpen && item.more}
            </div>
          );
        })}
      </div>
      {overflowCount > 0 && (
        <div data-lcos-railway-overflow-shell onMouseEnter={onOverflowEnter} onMouseLeave={onOverflowLeave}>
          <button
            type="button"
            data-lcos-railway-overflow-trigger
            aria-label={`显示其余 ${overflowCount} 个目的地`}
            aria-expanded={overflowOpen}
            onFocus={onOverflowEnter}
            onBlur={(event) => { const next=event.relatedTarget; if (!(next instanceof Node) || !event.currentTarget.parentElement?.contains(next)) onOverflowLeave?.(); }}
            onClick={onOverflowToggle}
          >
            +{overflowCount}
          </button>
          {overflowOpen && overflow}
        </div>
      )}
      {receiver}
      {footer && <span data-lcos-railway-footer>{footer}</span>}
    </>
  );
}
