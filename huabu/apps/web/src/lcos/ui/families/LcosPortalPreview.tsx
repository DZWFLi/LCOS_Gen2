// LcosPortalPreview — 共享组件族 Portal 目标预览（Figma 5348:1151 产品 Portal，6 状态）。
// 体块 440×360（Figma 变体框尺寸）；状态轴取值与 Figma 完全一致。
// 缺口（诚实登记，见 FIGMA_SOURCE_LEDGER）：5348:1151 属 page 13，未随 structures/ 导出，
// 内层几何不在本次证据内；本组件只表达「轴 + 体块 + 文案位」，不虚构缩略图。
// 生产可达状态只有由真实事实推导的两种（可预览 / 目标缺失）；其余状态在 gallery 展示，
// 其生产触发属于 R4（Context/Portal/Atlas/Temporal）。

import type { ReactNode } from 'react';

/** Figma `状态` 轴（5348:1151）。 */
export type LcosPortalPreviewState =
  | '可预览'
  | '加载中'
  | '旧缓存'
  | '部分预览'
  | '预览失败'
  | '目标缺失';

export interface LcosPortalPreviewProps {
  readonly state: LcosPortalPreviewState;
  readonly title: string;
  /** 目标身份/说明（真实 entityId 或 canvasId，不编造）。 */
  readonly detail?: string;
  readonly onRetry?: () => void;
  readonly children?: ReactNode;
}

export function LcosPortalPreview({
  state,
  title,
  detail,
  onRetry,
  children,
}: LcosPortalPreviewProps): React.JSX.Element {
  return (
    <div data-lcos-family="portal-preview" data-lcos-variant={state}>
      <span className="truncate text-sm font-semibold">{title}</span>
      {detail && <span className="truncate text-[11px] opacity-70">{detail}</span>}
      <div data-lcos-portal-stage>
        {state === '加载中' ? (
          <span className="lcos-static-pulse text-xs opacity-70">正在读取目标…</span>
        ) : state === '目标缺失' ? (
          <span className="px-4 text-center text-xs opacity-70">该入口没有可解析的目标（未绑定实体/现场）</span>
        ) : (
          children ?? <span className="text-xs opacity-70">{state}</span>
        )}
      </div>
      {(state === '预览失败' || state === '部分预览') && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-full px-3 text-xs font-medium"
          style={{ minHeight: 32, border: '1px solid var(--lcos-color-border-subtle)' }}
        >
          重试
        </button>
      )}
    </div>
  );
}
