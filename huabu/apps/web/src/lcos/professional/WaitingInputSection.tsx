// WaitingInputSection — 原 Run 的待回答问题（Figma P0-07b WaitingInputBody 语义）。
// 挂在 Conversation Work View 的 run/attention section：用真实 runId +
// GET /runs/:id/input-request 读取；答案 POST 回同一 run（不新建 Run）。
// 无 waiting 请求时如实显示「没有待回答」（不伪造）。

import { HttpError } from '@local-creative-os/web-gen2';
import { CircleHelp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';


import { lcosTokens } from '../ui/lcosTokens';

import type { RunInputRequestV1 } from '@local-creative-os/contracts';
import type { CoreRunClient} from '@local-creative-os/web-gen2';


export interface WaitingInputSectionProps {
  readonly runs: CoreRunClient;
  readonly runId: string;
  readonly runStatus: string;
}

export function WaitingInputSection({ runs, runId, runStatus }: WaitingInputSectionProps): React.JSX.Element {
  const [request, setRequest] = useState<RunInputRequestV1 | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [answerText, setAnswerText] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);

  const load = useCallback((): void => {
    setState('loading');
    void runs
      .getPendingInputRequest(runId)
      .then((value) => {
        setRequest(value);
        setState('ready');
      })
      .catch((error: unknown) => {
        setState('error');
        setErrorDetail(error instanceof HttpError ? error.message : String(error));
      });
  }, [runs, runId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = (): void => {
    if (!request) return;
    const text = answerText.trim();
    if (text === '' && selected.length === 0) return;
    setSubmitting(true);
    setErrorDetail(undefined);
    setReceipt(null);
    void runs
      .answerInput(runId, {
        requestId: request.requestId,
        ...(text === '' ? {} : { text }),
        ...(selected.length === 0 ? {} : { selectedOptions: selected }),
      })
      .then(() => {
        setReceipt('回答已提交（同一 Run，不新建）');
        setAnswerText('');
        setSelected([]);
        load();
      })
      .catch((error: unknown) => {
        // 失败保留输入，供编辑后重试
        setErrorDetail(error instanceof HttpError ? `${error.message} (${error.status})` : String(error));
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <section data-lcos-waiting-input className="flex flex-col gap-2 rounded-xl p-3" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}>
      <div className="flex items-center gap-1.5">
        <CircleHelp className="h-3.5 w-3.5" style={{ color: lcosTokens.color.pinAmber }} aria-hidden />
        <span className="text-xs font-semibold" style={{ color: lcosTokens.color.text }}>
          等待输入 · Run {runId.slice(0, 8)}
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: lcosTokens.color.raised, color: lcosTokens.color.muted }}>
          {runStatus}
        </span>
      </div>

      {state === 'loading' && (
        <span className="text-xs" style={{ color: lcosTokens.color.muted }}>读取待回答问题…</span>
      )}
      {state === 'error' && (
        <span className="text-xs" style={{ color: lcosTokens.color.danger }}>
          读取失败{errorDetail ? `（${errorDetail}）` : ''}
        </span>
      )}
      {state === 'ready' && !request && (
        <span className="text-xs" style={{ color: lcosTokens.color.muted }}>
          该 Run 当前没有待回答问题
        </span>
      )}

      {state === 'ready' && request && (
        <>
          <p className="text-sm leading-relaxed" style={{ color: lcosTokens.color.text }}>
            {request.question}
          </p>

          {request.options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {request.options.map((option) => {
                const on = selected.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    data-lcos-waiting-option
                    onClick={() =>
                      setSelected((prev) => (prev.includes(option) ? prev.filter((o) => o !== option) : [...prev, option]))
                    }
                    className="rounded-full px-2.5 py-1 text-xs font-medium transition-colors"
                    style={{
                      background: on ? lcosTokens.color.inverse : lcosTokens.color.raised,
                      color: on ? lcosTokens.color.textOnInverse : lcosTokens.color.text,
                      minHeight: 30,
                    }}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}

          {request.allowFreeText && (
            <textarea
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              rows={2}
              aria-label="回答待输入问题"
              placeholder="输入回答（失败会保留内容）"
              className="w-full resize-none rounded-lg px-2.5 py-2 text-sm outline-none"
              style={{ background: lcosTokens.color.raised, color: lcosTokens.color.text }}
            />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={submitting || (answerText.trim() === '' && selected.length === 0)}
              onClick={submit}
              className="rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-40"
              style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse, minHeight: 32 }}
            >
              {submitting ? '提交中…' : '提交回答'}
            </button>
            {receipt && <span className="text-xs" style={{ color: lcosTokens.color.accent }}>{receipt}</span>}
          </div>
          {errorDetail && submitting === false && receipt === null && (
            <span className="text-xs" style={{ color: lcosTokens.color.danger }}>回答失败 · {errorDetail}（输入已保留）</span>
          )}
        </>
      )}
    </section>
  );
}