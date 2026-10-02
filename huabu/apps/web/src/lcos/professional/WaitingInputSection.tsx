// WaitingInputSection — 会话等待回答（Figma P0-07b WaitingInputBody 语义）。
// B2（Batch B）：读取走 Collaboration product read（readPendingInput），回答走 command seam
// （answerInput，receipt-or-error）。UI 不再访问 runs raw client。

import { CircleHelp } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import { isComposerSendShortcut } from '../composer/conversationSendAttempt';
import { lcosTokens } from '../ui/lcosTokens';

import type { CoreCollaborationClient } from '@local-creative-os/web-gen2';

export interface WaitingInputSectionProps {
  readonly collaboration: CoreCollaborationClient;
  readonly projectId: string;
  readonly conversationId: string;
  readonly enabled?: boolean;
  readonly disabledReason?: string;
}

export function WaitingInputSection({ collaboration, projectId, conversationId, enabled = true, disabledReason }: WaitingInputSectionProps): React.JSX.Element | null {
  const [request, setRequest] = useState<{ readonly pendingInputId: string; readonly runId: string; readonly question: string; readonly options: readonly string[]; readonly allowFreeText: boolean } | undefined>(undefined);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [answerText, setAnswerText] = useState('');
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | undefined>(undefined);
  const pendingWrite = useRef(false);
  const currentRequestId = useRef<string | undefined>(undefined);
  const pendingRead = useRef<AbortController | null>(null);
  const scope = useRef(`${projectId}:${conversationId}`);
  scope.current = `${projectId}:${conversationId}`;

  const load = useCallback((): void => {
    pendingRead.current?.abort();
    const controller = new AbortController();
    pendingRead.current = controller;
    setState('loading');
    setRequest(undefined);
    setErrorDetail(undefined);
    void collaboration
      .readPendingInput(projectId, conversationId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value?.pendingInputId !== currentRequestId.current) { setAnswerText(''); setSelected([]); }
        currentRequestId.current = value?.pendingInputId;
        setRequest(value);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState('error');
        setErrorDetail(error instanceof Error ? error.message : String(error));
      });
  }, [collaboration, projectId, conversationId]);

  useEffect(() => {
    scope.current = `${projectId}:${conversationId}`;
    setRequest(undefined);
    setAnswerText('');
    setSelected([]);
    setSubmitting(false);
    setReceipt(null);
    load();
    return () => { pendingRead.current?.abort(); scope.current = ''; };
  }, [load, projectId, conversationId]);

  if (request === undefined && state === 'ready') return null;
  if (request === undefined && state === 'loading') {
    return (
      <section data-lcos-waiting-input className="flex flex-col gap-2 rounded-xl p-3" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}>
        <span className="text-xs" style={{ color: lcosTokens.color.muted }}>读取待回答问题…</span>
      </section>
    );
  }
  if (request === undefined) {
    return (
      <section data-lcos-waiting-input className="flex flex-col gap-2 rounded-xl p-3" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}>
        <span className="text-xs" style={{ color: lcosTokens.color.danger }}>
          读取失败{errorDetail ? `（${errorDetail}）` : ''}
        </span>
        <button type="button" onClick={load}>重试读取问题</button>
      </section>
    );
  }

  const submit = (): void => {
    if (!enabled || submitting || pendingWrite.current || request.pendingInputId !== currentRequestId.current) return;
    const submittedScope = scope.current;
    const text = request.allowFreeText ? answerText.trim() : '';
    if (text === '' && selected.length === 0) return;
    pendingWrite.current = true;
    setSubmitting(true);
    setErrorDetail(undefined);
    setReceipt(null);
    void collaboration
      .answerInput(projectId, request.runId, {
        pendingInputId: request.pendingInputId,
        answer: text,
        ...(selected.length === 0 ? {} : { selectedOptions: selected }),
      })
      .then((result) => {
        if (scope.current !== submittedScope) return;
        if (result.ok && result.receipt.command === 'answerInput' && result.receipt.runId === request.runId) {
          setReceipt('回答已提交');
          setAnswerText('');
          setSelected([]);
          load();
          // 动作回执后必须让共享投影失效重取（store.refresh 的既定契约）：
          // 否则本区虽然消失，Work View 的 userState 仍停在答完前的 needs_user
          // （表现为「已回答却一直显示等你回应」）。
          void useCollaborationSessionStore.getState().refresh(projectId, conversationId);
        } else {
          setErrorDetail(result.ok ? '回答回执未确认，请重新读取问题' : result.error.userMessage);
        }
      })
      .catch((error: unknown) => {
        if (scope.current !== submittedScope) return;
        setErrorDetail(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { pendingWrite.current = false; if (scope.current === submittedScope) setSubmitting(false); });
  };

  return (
    <section data-lcos-waiting-input className="flex flex-col gap-2 rounded-xl p-3" style={{ background: lcosTokens.color.surface, border: `1px solid ${lcosTokens.color.borderSubtle}` }}>
      <div className="flex items-center gap-1.5">
        <CircleHelp className="h-3.5 w-3.5" style={{ color: lcosTokens.color.pinAmber }} aria-hidden />
        <span className="text-xs font-semibold" style={{ color: lcosTokens.color.text }}>
          等你回答
        </span>
      </div>

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
                disabled={submitting || !enabled}
                data-lcos-waiting-option
                aria-pressed={on}
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
          disabled={submitting || !enabled}
          onKeyDown={(event) => { if (isComposerSendShortcut({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, repeat: event.repeat, isComposing: event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) { event.preventDefault(); submit(); } }}
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
          disabled={submitting || !enabled || ((!request.allowFreeText || answerText.trim() === '') && selected.length === 0)}
          onClick={submit}
          className="rounded-full px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          style={{ background: lcosTokens.color.inverse, color: lcosTokens.color.textOnInverse, minHeight: 32 }}
        >
          {submitting ? '提交中…' : '提交回答'}
        </button>
        {receipt && <span className="text-xs" style={{ color: lcosTokens.color.accent }}>{receipt}</span>}
      </div>
      {!enabled && <span role="status" className="text-xs">{disabledReason ?? '当前暂不能回答，请先核对会话状态'}</span>}
      {errorDetail && submitting === false && receipt === null && (
        <span className="text-xs" style={{ color: lcosTokens.color.danger }}>回答失败 · {errorDetail}（输入已保留）</span>
      )}
    </section>
  );
}