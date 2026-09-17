// ArtifactReturnSection — Run 结果的 Review 段（Draft → Accept / Reject / Retry）。
// B2（Batch B）：读取走 Collaboration product read（readReviews），决定走 command seam
// （approve/retry，receipt-or-error）。UI 不再访问 runs raw client。
// Accept 必须带 expectedBaseRevisionId（CAS 防覆盖）；retry 语义 = 同一 Draft 再跑（真实 product command）。

import { CheckCheck, RotateCcw, ShieldQuestion, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { lcosTokens } from '../ui/lcosTokens';

import type { CollaborationReviewV1 } from '@local-creative-os/contracts';
import type { CoreCollaborationClient } from '@local-creative-os/web-gen2';

type Action = 'accept' | 'reject' | 'retry';

export interface ArtifactReturnSectionProps {
  readonly collaboration: CoreCollaborationClient;
  readonly projectId: string;
  readonly conversationId: string;
}

export function ArtifactReturnSection({ collaboration, projectId, conversationId }: ArtifactReturnSectionProps): React.JSX.Element | null {
  const [reviews, setReviews] = useState<readonly CollaborationReviewV1[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const load = useCallback((): void => {
    setState('loading');
    void collaboration
      .readReviews(projectId, conversationId)
      .then((value) => {
        setReviews(value);
        setState('ready');
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(error instanceof Error ? error.message : String(error));
      });
  }, [collaboration, projectId, conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = reviews.filter((review) => review.status === 'pending_review');
  // loading/error 时 reviews 仍可能是空数组，但这不代表“没有待复核产出”。
  // 只有一次读取成功后，才能把空 pending 列表解释为真正的空态。
  if (state === 'ready' && pending.length === 0) return null;

  const decide = (review: CollaborationReviewV1, action: Action): void => {
    const busyKey = `${action}:${review.returnId}`;
    setBusy(busyKey);
    setReceipt(null);
    setErrorDetail(undefined);
    const call =
      action === 'retry'
        ? collaboration.retry(projectId, { returnId: review.returnId })
        : collaboration.approve(projectId, {
            returnId: review.returnId,
            decision: action,
            ...(action === 'accept' ? { expectedBaseRevisionId: review.baseRevisionId } : {}),
          });
    void call
      .then((result) => {
        if (!result.ok) throw new Error(result.error.userMessage);
        setReceipt(
          action === 'accept'
            ? '已采纳'
            : action === 'reject'
              ? '已拒绝该 Draft（Current 未改变）'
              : '已按同一 Draft 重试（未新建 Run）',
        );
        load();
      })
      .catch((error: unknown) => {
        setErrorDetail(error instanceof Error ? error.message : String(error));
      })
      .finally(() => setBusy(null));
  };

  return (
    <section
      data-lcos-artifact-return
      className="flex flex-col gap-2 rounded-xl p-3"
      style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}
    >
      <div className="flex items-center gap-1.5">
        <ShieldQuestion className="h-3.5 w-3.5" style={{ color: lcosTokens.color.pinViolet }} aria-hidden />
        <span className="text-xs font-semibold" style={{ color: lcosTokens.color.text }}>
          Review · 待复核产出
        </span>
      </div>

      {state === 'loading' && <span className="text-xs" style={{ color: lcosTokens.color.muted }}>读取复核状态…</span>}
      {state === 'error' && (
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: lcosTokens.color.danger }}>
            复核状态读取失败{errorDetail ? `（${errorDetail}）` : ''}
          </span>
          <button type="button" onClick={load} className="rounded-full px-2 py-1 text-[11px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.text }}>
            重试
          </button>
        </div>
      )}

      {state === 'ready' &&
        pending.map((review) => {
          const caps = review.capabilities;
          return (
            <div key={review.returnId} className="flex flex-col gap-1.5" data-lcos-review-return={review.returnId}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs" style={{ color: lcosTokens.color.text }}>
                  {review.title}
                </span>
                <span className="shrink-0 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                  base {review.baseRevisionId.slice(0, 8)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-lcos-return-accept
                  disabled={!caps.accept.enabled || busy !== null}
                  title={caps.accept.enabled ? '采纳为 Current' : `不可用：${caps.accept.reason ?? '未说明'}`}
                  onClick={() => decide(review, 'accept')}
                  className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium disabled:opacity-40"
                  style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse, minHeight: 30 }}
                >
                  <CheckCheck className="h-3 w-3" aria-hidden /> 采纳
                </button>
                <button
                  type="button"
                  data-lcos-return-reject
                  disabled={!caps.reject.enabled || busy !== null}
                  title={caps.reject.enabled ? '拒绝该 Draft' : `不可用：${caps.reject.reason ?? '未说明'}`}
                  onClick={() => decide(review, 'reject')}
                  className="rounded-full px-2.5 py-1 text-[11px] disabled:opacity-40"
                  style={{ color: lcosTokens.color.text, minHeight: 30 }}
                >
                  <XCircle className="h-3 w-3" aria-hidden /> 拒绝
                </button>
                <button
                  type="button"
                  data-lcos-return-retry
                  disabled={!caps.retry.enabled || busy !== null}
                  title={caps.retry.enabled ? '基于同一 Draft 重试' : `不可用：${caps.retry.reason ?? '未说明'}`}
                  onClick={() => decide(review, 'retry')}
                  className="rounded-full px-2.5 py-1 text-[11px] disabled:opacity-40"
                  style={{ color: lcosTokens.color.text, minHeight: 30 }}
                >
                  <RotateCcw className="h-3 w-3" aria-hidden /> 重试
                </button>
                {busy !== null && (
                  <span className="text-[10px]" style={{ color: lcosTokens.color.muted }}>处理中…</span>
                )}
              </div>
            </div>
          );
        })}

      {receipt && <span className="text-xs" style={{ color: lcosTokens.color.accent }}>{receipt}</span>}
      {errorDetail && state === 'ready' && (
        <span data-lcos-return-error className="text-xs" style={{ color: lcosTokens.color.danger }}>
          复核决定失败 · {errorDetail}
        </span>
      )}
    </section>
  );
}