// Figma 5386:256。selected/busy/disabled 均由现有 container 提供。
// 本组件不拥有 Surface identity、导航、相机或 safeRect。
import { FigmaShellGlyph } from '../FigmaShellGlyph';
import { lcosTokens } from '../lcosTokens';
import { GooeyNav } from '../vendor/rareui/gooey-nav';

import type { FigmaShellGlyphName } from '../FigmaShellGlyph';
import type { CSSProperties, ReactNode } from 'react';

export interface LcosSurfaceDockViewItem<Key extends string> {
  readonly key: Key;
  readonly label: string;
  readonly title?: string;
  readonly glyph: FigmaShellGlyphName;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly disabled: boolean;
}
export interface LcosSurfaceDockViewProps<Key extends string> {
  readonly items: readonly LcosSurfaceDockViewItem<Key>[];
  readonly onSelect: (key: Key) => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly feedback?: ReactNode;
  readonly compact?: boolean;
}
export function LcosSurfaceDockView<Key extends string>({ items, onSelect,
  className, style, feedback, compact = false }: LcosSurfaceDockViewProps<Key>): React.JSX.Element {
  return <div data-lcos-surface-dock data-lcos-family="surface-dock"
    data-lcos-dock-compact={compact ? 'true' : undefined} className={className} style={style}>
    <GooeyNav aria-label="工作现场" data-lcos-dock-items size="sm"
      value={items.findIndex((item) => item.selected)}
      activeColor={lcosTokens.color.pinViolet} activeLabelColor={lcosTokens.color.textOnInverse}
      separation={compact ? 16 : 8} radius={12} iconOnly={compact}
      items={items.map((item) => ({ label: item.label, surfaceKey: item.key,
        icon: <FigmaShellGlyph name={item.busy ? 'loading' : item.glyph} size={21} />,
        disabled: item.disabled, busy: item.busy, title: item.title ?? item.label }))}
      onChange={(index) => { const item = items[index]; if (item && !item.disabled) onSelect(item.key); }} />
    {feedback}
  </div>;
}
