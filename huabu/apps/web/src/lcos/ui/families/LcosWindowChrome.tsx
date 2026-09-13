// LcosWindowChrome — 共享组件族 ProfessionalWindowChrome（Figma 5387:331，布局 浮动/停靠/分组）。
// 几何取自 structures/window-chrome：h48 · pad 8/24 · gap 8 · 标题 22px 行高 · 图标键 32×32 r999。
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
}

export function LcosWindowChrome({
  layout,
  title,
  tabs = [],
  onSelectTab,
  actions,
}: LcosWindowChromeProps): React.JSX.Element {
  return (
    <div data-lcos-family="window-chrome" data-lcos-variant={layout}>
      {tabs.length > 0 ? (
        tabs.map((tab) => (
          <button
            key={tab.value ?? tab.key}
            type="button"
            data-lcos-window-tab={tab.key}
            data-lcos-window-tab-value={tab.value ?? tab.key}
            data-lcos-variant={tab.selected ? 'selected' : 'resting'}
            aria-current={tab.selected ? 'true' : undefined}
            onClick={() => onSelectTab?.(tab.value ?? tab.key)}
          >
            {tab.label}
          </button>
        ))
      ) : (
        <span data-lcos-window-title title={title}>
          {title}
        </span>
      )}
      <span className="flex-1" />
      {actions}
    </div>
  );
}
