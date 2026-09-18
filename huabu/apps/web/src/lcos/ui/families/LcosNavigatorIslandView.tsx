// LcosNavigatorIslandView — 共享组件族 NavigatorIsland 的纯视图（Figma 5384:367，11 状态）。
// 几何与轴取值取自 Figma structures/navigator：h48 · pad 6/8 · gap 8 · r999；
// 静息=搜索键(36) hug 52；彩色标=+N 个 Pin(36)；搜索=+输入(210) hug 402。
// 真实搜索、到达、切现场由 container（LcosNavigatorIsland）负责，本组件只做呈现。

import { LoaderCircle, Pin, Plus, Search, SearchX } from 'lucide-react';

import { lcosTokens } from '../lcosTokens';

import type { RefObject } from 'react';

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
}

export function LcosNavigatorIslandView({
  state,
  pins = [],
  query = '',
  onQueryChange,
  onToggleSearch,
  onActivatePin,
  onCreatePin,
  createPinDisabled = false,
  message,
  inputRef,
}: LcosNavigatorIslandViewProps): React.JSX.Element {
  const expanded = state === '搜索';
  const disabled = state === 'disabled';
  return (
    <div data-lcos-family="navigator-island" data-lcos-variant={state}>
      <button
        type="button"
        data-lcos-nav-part="search"
        aria-label={expanded ? '收起搜索（Esc）' : '搜索项目中的内容（Ctrl/Cmd+F）'}
        aria-expanded={expanded}
        disabled={disabled}
        onClick={onToggleSearch}
      >
        <Search size={19} aria-hidden />
      </button>

      {expanded && (
        <input
          ref={inputRef}
          data-lcos-nav-part="input"
          value={query}
          onChange={(event) => onQueryChange?.(event.target.value)}
          placeholder="搜索项目中的内容"
          aria-label="项目搜索"
          style={{ color: lcosTokens.color.text }}
        />
      )}

      {pins.map((pin) => (
        <button
          key={pin.id}
          type="button"
          data-lcos-nav-part="pin"
          data-lcos-pin-tone={pin.tone}
          data-lcos-pin-color={pin.color ?? ''}
          data-lcos-pin-count={pin.count ?? 0}
          aria-label={pin.label}
          title={pin.label}
          disabled={disabled}
          onClick={() => onActivatePin?.(pin)}
        >
          <span
            data-lcos-pin-mark
            style={pin.color === undefined ? undefined : { color: pin.color }}
          >
            <Pin size={14} aria-hidden />
            {pin.count !== undefined && pin.count > 0 && (
              <span data-lcos-pin-count-mark className="text-[9px] leading-none">{pin.count}</span>
            )}
          </span>
        </button>
      ))}

      {onCreatePin !== undefined && (
        <button
          type="button"
          data-lcos-nav-part="pin-add"
          aria-label="新建颜色组"
          title="把当前现场标为颜色组"
          disabled={disabled || createPinDisabled}
          onClick={onCreatePin}
        >
          <Plus size={16} aria-hidden />
        </button>
      )}

      {state === 'loading' && (
        <span aria-hidden className="lcos-static-pulse" style={{ color: lcosTokens.color.muted, display: 'inline-flex' }}>
          <LoaderCircle size={16} />
        </span>
      )}
      {(state === 'error' || state === 'degraded') && (
        <span
          data-lcos-nav-message
          className="truncate text-xs"
          style={{ color: state === 'error' ? lcosTokens.color.danger : lcosTokens.color.muted, maxWidth: 180 }}
        >
          <SearchX size={12} aria-hidden style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
          {message ?? (state === 'error' ? '搜索失败 · 请重试' : '降级读取')}
        </span>
      )}
    </div>
  );
}
