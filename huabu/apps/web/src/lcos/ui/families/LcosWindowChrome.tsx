import { useEffect, useRef } from 'react';

import { LcosButton } from '../primitives/LcosButton';
import { mountWindowMaterialInteraction } from '../materials/windowMaterialInteraction';
import '../materials/window-surfaces.css';
// LcosWindowChrome — 共享组件族 ProfessionalWindowChrome（Figma 5387:331，布局 浮动/停靠/分组）。
// 几何取自 structures/window-chrome：h48 · pad 8/24 · gap 8 · 标题 12px / 18px（22px 内容框） · 图标键 32×32 r999。
// body 不拥有窗口位置：拓扑（浮动/停靠/分组）由 ProfessionalWindowStage 决定，本组件只呈现顶栏。

import type { ReactNode } from 'react';

/** Figma `布局` 轴。 */
export type LcosWindowLayout = '浮动' | '停靠' | '分组';

export interface LcosWindowTab {
  /** 稳定标识（body/现场语义）：渲染为 `data-lcos-window-tab`。 */
  readonly key: string;
  /** 选择载荷（同一 key 可能有多个实例，例如两个 Reader）；缺省等于 key。 */
  readonly value?: string;
  readonly label: string;
  readonly selected?: boolean;
}

export interface LcosWindowChromeProps {
  readonly layout: LcosWindowLayout;
  /** Figma `窗口标题` TEXT 属性。 */
  readonly title: string;
  readonly tabs?: readonly LcosWindowTab[];
  readonly onSelectTab?: (value: string) => void;
  /** 右侧图标键（关闭 / 更多：停靠、分组）。 */
  readonly actions?: ReactNode;
  /** 可选稳定插槽；不提供时完整保留旧 actions，绝不根据 children 顺序猜关闭按钮。 */
  readonly primaryActions?: ReactNode;
  readonly overflowTrigger?: ReactNode;
  /** body 读取不禁用 Chrome；此属性仅呈现忙碌反馈。 */
  readonly busy?: boolean;
}

export function LcosWindowChrome({
  layout,
  title,
  tabs = [],
  onSelectTab,
  actions,
  primaryActions,
  overflowTrigger,
  busy = false,
}: LcosWindowChromeProps): React.JSX.Element {
  const materialRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = materialRef.current;
    return host ? mountWindowMaterialInteraction(host) : undefined;
  }, []);
  const selectedTab = tabs.find((tab) => tab.selected)?.value ?? tabs.find((tab) => tab.selected)?.key;
  useEffect(() => {
    const strip = tabsRef.current;
    if (!strip) return;
    const revealSelection = () => {
      const selected = strip.querySelector<HTMLElement>('[aria-current="true"]');
      if (!selected) return;
      const bounds = strip.getBoundingClientRect();
      const tabBounds = selected.getBoundingClientRect();
      if (tabBounds.left < bounds.left) strip.scrollLeft -= bounds.left - tabBounds.left;
      else if (tabBounds.right > bounds.right) strip.scrollLeft += tabBounds.right - bounds.right;
    };
    revealSelection();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(revealSelection);
    observer?.observe(strip);
    return () => observer?.disconnect();
  }, [selectedTab, tabs.length]);
  const managedOverflow = primaryActions !== undefined && primaryActions !== null
    && overflowTrigger !== undefined && overflowTrigger !== null;
  return (
    <div
      ref={materialRef}
      data-lcos-window-material="frost"
      data-lcos-window-managed-overflow={managedOverflow ? 'true' : undefined}
      data-lcos-family="window-chrome"
      data-lcos-variant={layout}
      data-lcos-window-busy={busy ? 'true' : undefined}
      aria-busy={busy || undefined}
    >
      <span data-lcos-window-material-light aria-hidden="true" />
      {tabs.length > 0 ? (
        <div ref={tabsRef} data-lcos-window-tabs aria-label={title}>{tabs.map((tab) => (
          <LcosButton
            key={tab.value ?? tab.key}
            type="button"
            data-lcos-window-tab={tab.key}
            data-lcos-window-tab-value={tab.value ?? tab.key}
            data-lcos-variant={tab.selected ? 'selected' : 'resting'}
            aria-current={tab.selected ? 'true' : undefined}
            onClick={() => onSelectTab?.(tab.value ?? tab.key)}
          >
            <span data-lcos-window-tab-label title={tab.label}>{tab.label}</span>
          </LcosButton>
        ))}</div>
      ) : (
        <span data-lcos-window-title title={title}>
          {title}
        </span>
      )}
      <div data-lcos-window-actions role="group" aria-label="窗口操作">
        {actions}
        {overflowTrigger}
        {primaryActions}
      </div>
    </div>
  );
}
