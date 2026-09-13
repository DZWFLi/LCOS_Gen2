// LcosTaskCard — 共享组件族 TaskCard（Figma 5335:110 工作流 / 取用卡，7 状态）。
// 体块 224×324（3:4，Figma 变体框尺寸）；状态轴取值与 Figma 完全一致。
// 状态只表达「已有事实」：草稿中=引用已在 Composer 草稿、不可用=缺少可引用身份；
// 悬停 / 键盘焦点由 CSS 伪类表达；预览 / 已选目标 的生产触发属于 R5（Workflow/Hand/Cards），
// 本 Wave 不在 gallery 之外伪造。

import type { ReactNode } from 'react';

/** Figma `状态` 轴（5335:110）。 */
export type LcosTaskCardState = '静息' | '悬停' | '预览' | '已选目标' | '草稿中' | '不可用' | '键盘焦点';

export interface LcosTaskCardProps {
  readonly state: LcosTaskCardState;
  readonly title: string;
  /** 第二行事实（kind / 时间）；由 producer 提供。 */
  readonly meta?: string;
  /** 卡体内容（缩略/封面位）。 */
  readonly children?: ReactNode;
  /** 卡底动作（取用等），由调用方接线。 */
  readonly footer?: ReactNode;
  /** 主激活动作（打开/续接）；未接线时不渲染按钮，避免死交互。 */
  readonly onActivate?: () => void;
  /**
   * 兼容选择器（旧 Wave 脚本用 `[data-lcos-workflow-card]` 计数；R0 已知这些脚本未迁移新
   * harness，R2 新 e2e 上线后连同此属性一起删除）。取值是条目 kind，由调用方给真实值。
   */
  readonly legacyWorkflowKind?: string;
}

export function LcosTaskCard({
  state,
  title,
  meta,
  children,
  footer,
  onActivate,
  legacyWorkflowKind,
}: LcosTaskCardProps): React.JSX.Element {
  return (
    <div
      data-lcos-family="task-card"
      data-lcos-variant={state}
      {...(legacyWorkflowKind ? { 'data-lcos-workflow-card': legacyWorkflowKind } : {})}
      // 卡片本身不可聚焦（卡底还有独立动作）：键盘焦点用 :focus-within 表达，
      // 视觉落到整张卡上，语义仍是「卡内某个可聚焦元素获得了焦点」。
      className="lcos-focus-ring"
    >
      <div data-lcos-task-card-body>
        {children}
        {onActivate ? (
          <button type="button" data-lcos-task-card-activate onClick={onActivate} className="truncate text-left text-xs font-semibold">
            {title}
          </button>
        ) : (
          <span className="truncate text-xs font-semibold">{title}</span>
        )}
        {meta && <span className="mt-auto text-[10px] opacity-70">{meta}</span>}
      </div>
      {footer && <div data-lcos-task-card-footer>{footer}</div>}
    </div>
  );
}
