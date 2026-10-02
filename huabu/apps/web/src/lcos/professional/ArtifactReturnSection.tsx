// ArtifactReturnSection — Run 结果的 Review 段（Draft → Accept / Reject / Retry）。
// B2（Batch B）：读取走 Collaboration product read（readReviews），决定走 command seam
// （approve/retry，receipt-or-error）。UI 不再访问 runs raw client。
// Accept 必须带 expectedBaseRevisionId（CAS 防覆盖）；retry 语义 = 同一 Draft 再跑（真实 product command）。

import { CheckCheck, RotateCcw, ShieldQuestion, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import { lcosTokens } from '../ui/lcosTokens';

import type { CollaborationReviewV1 } from '@local-creative-os/contracts';
import type { CoreCollaborationClient } from '@local-creative-os/web-gen2';

type Action = 'accept' | 'reject' | 'retry';

export interface ArtifactReturnSectionProps {
  readonly refreshKey?: string;
  readonly collaboration: CoreCollaborationClient;
  readonly projectId: string;
  readonly conversationId: string;
}

export function ArtifactReturnSection({ collaboration, projectId, conversationId, refreshKey }: ArtifactReturnSectionProps): React.JSX.Element | null {
  const [reviews, setReviews] = useState<readonly CollaborationReviewV1[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const pendingRead = useRef<AbortController | null>(null);
  const pendingWrite = useRef(false);
  const scope = useRef('');
  scope.current = JSON.stringify([projectId, conversationId]);

  const load = useCallback((): void => {
    pendingRead.current?.abort();
    const controller = new AbortController(); pendingRead.current = controller;
    setState('loading');
    setErrorDetail(undefined);
    void collaboration
      .readReviews(projectId, conversationId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setReviews(value);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState('error');
        setErrorDetail(error instanceof Error ? error.message : String(error));
      });
  }, [collaboration, projectId, conversationId]);

  useEffect(() => {
    scope.current = JSON.stringify([projectId, conversationId]);
    load();
    return () => { pendingRead.current?.abort(); scope.current = ''; };
  }, [load, projectId, conversationId]);

  const previousRefresh = useRef(refreshKey);
  useEffect(() => {
    if (previousRefresh.current === refreshKey) return;
    previousRefresh.current = refreshKey;
    if (!pendingWrite.current) load();
  }, [refreshKey, load]);

  const pending = reviews.filter((review) => review.status === 'pending_review');
  // loading/error 时 reviews 仍可能是空数组，但这不代表“没有待复核产出”。
  // 只有一次读取成功后，才能把空 pending 列表解释为真正的空态。
  if (state === 'ready' && pending.length === 0) return null;

  const decide = (review: CollaborationReviewV1, action: Action): void => {
    if (pendingWrite.current || state !== 'ready' || !review.capabilities[action].enabled) return;
    const submittedScope = scope.current;
    pendingWrite.current = true;
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
        if (scope.current !== submittedScope) return;
        if (result.ok && (result.receipt.returnId !== review.returnId || result.receipt.command !== (action === 'retry' ? 'retry' : 'approve'))) throw new Error('复核回执未确认，请刷新后核对');
        if (!result.ok) throw new Error(result.error.userMessage);
        setReceipt(
          action === 'accept'
            ? '已采纳'
            : action === 'reject'
              ? '已拒绝该候选结果，当前版本未改变'
              : '重试请求已提交',
        );
        load();
        // 同 WaitingInputSection：复核回执后必须让共享投影失效重取，
        // 否则 Work View 的 userState / capabilities 会停在复核前的状态。
        void useCollaborationSessionStore.getState().refresh(projectId, conversationId);
      })
      .catch((error: unknown) => {
        if (scope.current !== submittedScope) return;
        setErrorDetail(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { pendingWrite.current = false; if (scope.current === submittedScope) setBusy(null); });
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
          待复核产出
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
                  保留原版本，采纳后更新
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