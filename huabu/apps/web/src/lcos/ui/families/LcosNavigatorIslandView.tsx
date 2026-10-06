// LcosNavigatorIslandView — 共享组件族 NavigatorIsland 的纯视图（Figma 5384:367，11 状态）。
// 几何与轴取值取自 Figma structures/navigator：h48 · pad 6/8 · gap 8 · r999；
// 静息=搜索键(36) hug 52；彩色标=+N 个 Pin(36)；搜索=+输入(210) hug 402。
// 真实搜索、到达、切现场由 container（LcosNavigatorIsland）负责，本组件只做呈现。

import { useEffect, useRef, useState, type KeyboardEventHandler, type ReactNode, type RefObject } from 'react';

import { FigmaPinMark, FigmaShellGlyph } from '../FigmaShellGlyph';
import { LcosSurfaceFeedbackView } from '../LcosSurfaceFeedbackView';
import { lcosTokens } from '../lcosTokens';
import { LcosIconButton } from '../primitives/LcosIconButton';
import { useLayerReturnFocus } from '../spatial/useLayerReturnFocus';

function SearchInputReturnFocus({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const ref = useLayerReturnFocus(true);
  return <div ref={ref} data-lcos-search-input-focus-layer style={{ display: 'contents' }}>{children}</div>;
}

/** Figma `状态` 轴的 11 个取值，命名与 Figma 完全一致。 */
export type LcosNavigatorIslandState =
  | '静息'
  | '彩色标'
  | '搜索'
  | 'hover'
  | 'pressed'
  | 'focus'
  | 'disabled'
  | 'loading'
  | 'error'
  | 'degraded'
  | 'selected';

export type LcosPinTone = 'violet' | 'teal' | 'amber';

/** Pin = 颜色分组偏好及成员关系（00 页 5409:2 语义纠正；不是业务关系或节点类型）。 */
export interface LcosNavigatorPin {
  readonly id: string;
  readonly tone: LcosPinTone;
  readonly label: string;
  /** canonical #RRGGBB（color-pin 契约 V0）。有则按真值渲染，tone 只是 CSS 家族轴。 */
  readonly color?: string;
  /** 该颜色组的成员数（canonical memberships 计数，不是本地估算）。 */
  readonly count?: number;
}

export interface LcosNavigatorIslandViewProps {
  readonly state: LcosNavigatorIslandState;
  /** 只控制输入槽是否可见；由现有搜索 container 提供，不从异步状态猜测。 */
  readonly expanded?: boolean;
  readonly pins?: readonly LcosNavigatorPin[];
  readonly query?: string;
  readonly onQueryChange?: (next: string) => void;
  /** 搜索键：静息时展开，展开时收起（功能等价于 Figma 搜索态的 Esc 恢复）。 */
  readonly onToggleSearch?: () => void;
  readonly onActivatePin?: (pin: LcosNavigatorPin) => void;
  /** 创建颜色组入口（容器负责弹调色板，本视图只发命令）。 */
  readonly onCreatePin?: () => void;
  readonly createPinDisabled?: boolean;
  /** loading / error / degraded 的短态文案（Figma 这些状态与静息共用壳）。 */
  readonly message?: string;
  readonly inputRef?: RefObject<HTMLInputElement | null>;
  readonly searchButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly availableWidth?: number;
  readonly inputAriaControls?: string;
  readonly activeDescendant?: string;
  readonly onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

export function LcosNavigatorIslandView({
  state, expanded: expandedProp, pins = [], query = '', onQueryChange,
  onToggleSearch, onActivatePin, onCreatePin, createPinDisabled = false,
  message, inputRef, searchButtonRef, availableWidth = 900, inputAriaControls, activeDescendant, onInputKeyDown,
}: LcosNavigatorIslandViewProps): React.JSX.Element {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowButton = useRef<HTMLButtonElement>(null);
  useEffect(() => setOverflowOpen(false), [expandedProp]);
  const expanded = expandedProp ?? state === '搜索';
  // Reserve the input before allocating Pin slots. Overflow is an explicit control.
  const pinSlots = Math.max(0, Math.min(3, Math.floor((availableWidth - (expanded ? 174 : 52)) / 44)));
  const overflowNeeded = pins.length > pinSlots;
  const moreVisible = overflowNeeded || onCreatePin !== undefined;
  const visible = pins.slice(0, moreVisible ? Math.max(0, pinSlots - 1) : pinSlots);
  const hiddenPins = pins.slice(visible.length);
  const width = Math.min(availableWidth, 52 + (expanded ? 218 : 0) + (visible.length + (moreVisible ? 1 : 0)) * 44);
  const disabled = state === 'disabled';
  const feedback = state === 'loading' ? 'loading' : state === 'error' ? 'error'
    : state === 'degraded' ? 'recovery' : undefined;
  const tones: Readonly<Record<LcosPinTone, string>> = {
    violet: lcosTokens.color.pinViolet, teal: lcosTokens.color.pinTeal, amber: lcosTokens.color.pinAmber,
  };
  const closeOverflowOnEscape: KeyboardEventHandler<HTMLElement> = (event) => {
    if (event.key !== 'Escape' || !overflowOpen) return;
    event.preventDefault(); event.stopPropagation(); setOverflowOpen(false); overflowButton.current?.focus();
  };
  return (
    <div data-lcos-nav-view>
      <div data-lcos-family="navigator-island" data-lcos-variant={state}
        style={{ width }} data-lcos-expanded={expanded ? 'true' : 'false'} aria-busy={state === 'loading'}>
        <LcosIconButton ref={searchButtonRef} type="button" data-lcos-nav-part="search"
          aria-label={expanded ? '收起搜索（Esc）' : '搜索项目中的内容（Ctrl/Cmd+F）'}
          aria-expanded={expanded} disabled={disabled} onClick={onToggleSearch} onKeyDown={closeOverflowOnEscape}>
          <FigmaShellGlyph name="search" size={19} />
        </LcosIconButton>
        {expanded && <SearchInputReturnFocus>
          <input ref={inputRef} data-lcos-nav-part="input" value={query}
            disabled={disabled} onChange={(event) => onQueryChange?.(event.target.value)}
            placeholder="搜索项目中的内容" aria-label="项目搜索" role="combobox"
            aria-controls={inputAriaControls} aria-expanded={expanded} aria-activedescendant={activeDescendant}
            onKeyDown={(event) => { closeOverflowOnEscape(event); onInputKeyDown?.(event); }} />
        </SearchInputReturnFocus>}
        {visible.map((pin) => (
          <LcosIconButton key={pin.id} type="button" data-lcos-nav-part="pin"
            data-lcos-pin-tone={pin.tone} data-lcos-pin-color={pin.color ?? ''}
            data-lcos-pin-count={pin.count ?? 0} aria-label={pin.label}
            title={pin.count === undefined ? pin.label : `${pin.label} · ${pin.count} 项`}
            disabled={disabled} onClick={() => onActivatePin?.(pin)} onKeyDown={closeOverflowOnEscape}>
            <FigmaPinMark color={pin.color ?? tones[pin.tone]} />
            {pin.count !== undefined && pin.count > 0 &&
              <span data-lcos-pin-count-mark>{pin.count}</span>}
          </LcosIconButton>
        ))}
        {moreVisible && <LcosIconButton ref={overflowButton} type="button" data-lcos-nav-part="overflow"
          aria-label={hiddenPins.length > 0 ? `其余 ${hiddenPins.length} 个颜色组` : '颜色组操作'}
          aria-expanded={overflowOpen}
          onClick={() => setOverflowOpen((value) => !value)} onKeyDown={closeOverflowOnEscape}>
          {hiddenPins.length > 0 ? `+${hiddenPins.length}` : '更多'}
        </LcosIconButton>}
      </div>
      {overflowOpen && <div data-lcos-pin-overflow role="group" aria-label="其余颜色组">
        {hiddenPins.map((pin) => <button key={pin.id} type="button" onClick={() => { setOverflowOpen(false); onActivatePin?.(pin); }} onKeyDown={closeOverflowOnEscape}>
          <FigmaPinMark color={pin.color ?? tones[pin.tone]} /><span>{pin.label}</span><small>{pin.count ?? 0}</small>
        </button>)}
        {onCreatePin && <button type="button" disabled={createPinDisabled} onClick={() => { setOverflowOpen(false); onCreatePin(); }} onKeyDown={closeOverflowOnEscape}>
          <FigmaShellGlyph name="plus" size={18} /><span>新建颜色组</span></button>}
      </div>}
      {feedback !== undefined && message !== undefined && <div data-lcos-nav-feedback>
        <LcosSurfaceFeedbackView presentation={feedback}
          message={message ?? (state === 'loading' ? '正在读取…' : state === 'error' ? '搜索失败 · 请重试' : '降级读取')} />
      </div>}
    </div>
  );
}
