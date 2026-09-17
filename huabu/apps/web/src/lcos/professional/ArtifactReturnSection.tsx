// ArtifactReturnSection — Run 结果的 Review 段（Draft → Accept / Reject / Retry）。
// 采纳/拒绝走 Collaboration command seam（facade.approve，receipt-or-error）；
// 读取（listRunReviews）与 retry 暂借 collaboration.runs（Gate 5 legacy 过渡，登记待迁移）。
// capability.enabled=false 时按钮禁用并显示真实 reason，不假装可用。
// Accept 必须带 expectedBaseRevisionId：用 return.baseRevisionId（防覆盖他人已推进的 Current）。

import { CheckCheck, RotateCcw, ShieldQuestion, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';


import { lcosTokens } from '../ui/lcosTokens';

import type { RunReview } from '@local-creative-os/contracts';
import type { CoreCollaborationClient } from '@local-creative-os/web-gen2';

type Action = 'accept' | 'reject' | 'retry';
type ArtifactReturnLike = RunReview['returns'][number];

export interface ArtifactReturnSectionProps {
  readonly collaboration: CoreCollaborationClient;
  readonly projectId: string;
  readonly runIds: readonly string[];
}

export function ArtifactReturnSection({ collaboration, projectId, runIds }: ArtifactReturnSectionProps): React.JSX.Element | null {
  const [reviews, setReviews] = useState<readonly RunReview[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const key = runIds.join(',');

  const load = useCallback((): void => {
    setState('loading');
    void collaboration.runs
      .listRunReviews(projectId)
      .then((all) => {
        const wanted = new Set(runIds);
        setReviews(all.filter((review) => wanted.has(String(review.run.id))));
        setState('ready');
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(error instanceof Error ? error.message : String(error));
      });
    // runIds 参与过滤；用 key 表达依赖避免每次渲染重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collaboration, projectId, key]);

  useEffect(() => {
    if (runIds.length === 0) return;
    load();
  }, [load, runIds.length]);

  if (runIds.length === 0) return null;

  const decide = (ret: ArtifactReturnLike, action: Action): void => {
    const busyKey = `${action}:${String(ret.id)}`;
    setBusy(busyKey);
    setReceipt(null);
    setErrorDetail(undefined);
    const returnId = String(ret.id);
    const call =
      action === 'retry'
        ? // retry 尚无独立产品命令（收敛方案 V1）；暂借 runs client，Gate 5 登记迁移。
          collaboration.runs.retryArtifactReturn(returnId).then(() => ({ ok: true as const }))
        : collaboration
            .approve(projectId, {
              returnId,
              decision: action,
              ...(action === 'accept' ? { expectedBaseRevisionId: String(ret.baseRevisionId) } : {}),
            })
            .then((result) =>
              result.ok
                ? ({ ok: true as const, currentRevisionId: undefined as string | undefined })
                : Promise.reject(new Error(result.error.userMessage)),
            );
    void call
      .then(() => {
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
        // 冲突（如 base revision 已被推进）如实显示，不改写用户决策
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
          Review · Artifact Return
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

      {state === 'ready' && reviews.length === 0 && (
        <span className="text-xs" style={{ color: lcosTokens.color.muted }}>
          本会话关联 Run 暂无复核投影
        </span>
      )}

      {state === 'ready' &&
        reviews.map((review) => {
          const caps = review.capabilities;
          return (
            <div key={String(review.run.id)} className="flex flex-col gap-1.5" data-lcos-review-run={String(review.run.id)}>
              <div className="flex items-center gap-2">
                <span className="truncate text-xs" style={{ color: lcosTokens.color.text }}>
                  Run {String(review.run.id).slice(0, 10)}
                </span>
                <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>
                  {review.presentationPhase}
                </span>
              </div>

              {review.returns.length === 0 ? (
                <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: lcosTokens.color.muted }}>
                  <span>暂无待复核结果</span>
                  <span data-lcos-review-capability="accept">采纳 {caps.accept.enabled ? '可用' : `不可用（${caps.accept.reason ?? '未说明'}）`}</span>
                  <span data-lcos-review-capability="reject">拒绝 {caps.reject.enabled ? '可用' : `不可用（${caps.reject.reason ?? '未说明'}）`}</span>
                  <span data-lcos-review-capability="retry">重试 {caps.retry.enabled ? '可用' : `不可用（${caps.retry.reason ?? '未说明'}）`}</span>
                </div>
              ) : (
                review.returns.map((ret) => (
                  <div
                    key={String(ret.id)}
                    data-lcos-return={String(ret.id)}
                    className="flex flex-col gap-1 rounded-lg px-2.5 py-2"
                    style={{ background: lcosTokens.color.raised }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: lcosTokens.color.text }}>
                        {String(ret.targetArtifactId)} · {ret.action} · {ret.status}
                      </span>
                      <span className="shrink-0 text-[10px]" style={{ color: lcosTokens.color.muted }}>
                        base {String(ret.baseRevisionId).slice(0, 8)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-lcos-return-accept
                        disabled={!caps.accept.enabled || busy !== null}
                        title={caps.accept.enabled ? '采纳为 Current' : `不可用：${caps.accept.reason ?? '未说明'}`}
                        onClick={() => decide(ret, 'accept')}
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
                        onClick={() => decide(ret, 'reject')}
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
                        onClick={() => decide(ret, 'retry')}
                        className="rounded-full px-2.5 py-1 text-[11px] disabled:opacity-40"
                        style={{ color: lcosTokens.color.text, minHeight: 30 }}
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden /> 重试
                      </button>
                      {busy !== null && (
                        <span className="text-[10px]" style={{ color: lcosTokens.color.muted }}>
                          处理中…
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
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