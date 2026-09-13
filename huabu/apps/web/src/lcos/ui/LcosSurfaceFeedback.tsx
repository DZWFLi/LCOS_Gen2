// LCOS 轻量反馈原语（Figma 统一 / SurfaceFeedback 5391:357；7 呈现）。
// 只作宿主附近的短态反馈；normal 由真实回执消费，不用定时器假装成功。
// reduced-motion 保留文案与轮廓；loading 用静态符号代替旋转。

import {
  AlertTriangle,
  CheckCircle2,
  Focus,
  Inbox,
  LoaderCircle,
  Lock,
  RefreshCw,
} from 'lucide-react';
import {
  useState,
  type CSSProperties,
  type JSX,
  type ReactNode,
} from 'react';

import { lcosTokens } from './lcosTokens';

export type LcosFeedbackPresentation =
  | 'loading'
  | 'empty'
  | 'normal'
  | 'focus'
  | 'disabled'
  | 'error'
  | 'recovery';

const PRESENTATION_ICON: Readonly<Record<LcosFeedbackPresentation, ReactNode>> = {
  loading: <LoaderCircle className="h-4 w-4" />,
  empty: <Inbox className="h-4 w-4" />,
  normal: <CheckCircle2 className="h-4 w-4" />,
  focus: <Focus className="h-4 w-4" />,
  disabled: <Lock className="h-4 w-4" />,
  error: <AlertTriangle className="h-4 w-4" />,
  recovery: <RefreshCw className="h-4 w-4" />,
};

export interface LcosSurfaceFeedbackProps {
  readonly presentation: LcosFeedbackPresentation;
  /** 显式文案；未提供时按呈现给默认文案。 */
  readonly message?: string;
  readonly onAction?: () => void;
  readonly actionLabel?: string;
  readonly style?: CSSProperties;
}

const DEFAULT_MESSAGE: Readonly<Record<LcosFeedbackPresentation, string>> = {
  loading: '正在读取…',
  empty: '还没有内容 · 从装配拿来使用',
  normal: '已就绪',
  focus: '当前目标',
  disabled: '当前不可用 · 查看原因',
  error: '读取失败 · 重试',
  recovery: '尚未确认 · 核对原操作',
};

export function LcosSurfaceFeedback({
  presentation,
  message,
  onAction,
  actionLabel,
  style,
}: LcosSurfaceFeedbackProps): JSX.Element {
  const [actionPending, setActionPending] = useState(false);
  const text = message ?? DEFAULT_MESSAGE[presentation];

  return (
    <div
      role="status"
      data-lcos-surface-feedback={presentation}
      className="inline-flex max-w-full items-center gap-2 rounded-full px-3 py-1.5"
      style={{
        background: lcosTokens.color.raised.light,
        border: `1px solid ${lcosTokens.color.borderSubtle.light}`,
        color: presentation === 'error' ? lcosTokens.color.danger : lcosTokens.color.muted.light,
        fontSize: lcosTokens.fontSize.sm,
        minHeight: 38,
        ...style,
      }}
    >
      <span aria-hidden className={presentation === 'loading' ? 'lcos-static-pulse' : undefined}>
        {PRESENTATION_ICON[presentation]}
      </span>
      <span className="truncate">{text}</span>
      {onAction && (
        <button
          type="button"
          disabled={actionPending || presentation === 'loading'}
          onClick={() => {
            setActionPending(true);
            try {
              onAction();
            } finally {
              window.setTimeout(() => setActionPending(false), 600);
            }
          }}
          className="shrink-0 rounded-full font-medium"
          style={{
            color: lcosTokens.color.text.light,
            padding: '2px 8px',
            minHeight: 28,
            fontSize: lcosTokens.fontSize.xs,
          }}
        >
          {actionLabel ?? '重试'}
        </button>
      )}
    </div>
  );
}