import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { executionStatusLabel } from '@local-creative-os/web-gen2';
import type { RunRecipeV0, RunReview } from '@local-creative-os/contracts';

import { createLcosCoreSession } from '../app/lcosCoreClient';
import { useCollaborationSessionStore } from '../collaboration/collaborationSessionStore';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { assertRunReview, performRunWorkAction, type RunWorkAction } from './runWorkActions';
import { LcosButton } from '../ui/primitives/LcosButton';
import '../ui/nearfield/nearfield.css';
import './run-work-view.css';

/** The existing Professional Window hosts a single requested Run. All facts
 * come from Core review/recipe; neither opening nor refreshing dispatches it. */
export function RunWorkViewBody({ projectId, runId }: { projectId: string; runId?: string }): React.JSX.Element {
  const client = useMemo(() => createLcosCoreSession().runs, []);
  const [review, setReview] = useState<RunReview>();
  const [recipe, setRecipe] = useState<RunRecipeV0>();
  const [readError, setReadError] = useState('');
  const [recipeError, setRecipeError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mustVerify, setMustVerify] = useState(false);
  const [stopConfirm, setStopConfirm] = useState(false);
  const [answer, setAnswer] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [nextRunId, setNextRunId] = useState<string>();
  const generation = useRef(0);
  const reading = useRef<AbortController | undefined>(undefined);
  const lifetime = useRef(new AbortController());
  const inFlight = useRef(false);
  const confirmedQuestion = useRef<string | undefined>(undefined);

  const refresh = useCallback(async (explicit = false): Promise<void> => {
    if (!runId) return;
    const id = ++generation.current;
    reading.current?.abort();
    const controller = new AbortController(); reading.current = controller;
    try {
      const [value, recipeRead] = await Promise.all([
        client.readRunReview(runId, controller.signal),
        client.readRecipe(runId, controller.signal).then((data) => ({ data, error: '' }),
          () => ({ data: undefined, error: '本次输入暂时无法读取' })),
      ]);
      if (controller.signal.aborted || id !== generation.current) return;
      const checked = assertRunReview(value, projectId, runId);
      setReview(checked); setReadError('');
      const exactRecipe = recipeRead.data?.runId === runId && recipeRead.data.projectId === projectId ? recipeRead.data : undefined;
      setRecipe(exactRecipe); setRecipeError(exactRecipe ? '' : recipeRead.error || '本次输入身份未确认');
      const requestId = checked.inputRequest?.requestId;
      if (confirmedQuestion.current !== requestId) {
        confirmedQuestion.current = requestId;
        setAnswer(checked.inputRequest?.answerText ?? ''); setOptions([...(checked.inputRequest?.selectedOptions ?? [])]);
      }
      if (explicit) { setMustVerify(false); setMessage('已重新读取原任务状态'); }
    } catch (error) {
      if (!controller.signal.aborted && id === generation.current) setReadError(error instanceof Error ? error.message : '任务读取失败');
    }
  }, [client, projectId, runId]);

  useEffect(() => {
    lifetime.current = new AbortController();
    void refresh();
    const unwatch = useCollaborationSessionStore.getState().watchProjectChanges(projectId, () => { void refresh(); });
    return () => { ++generation.current; reading.current?.abort(); lifetime.current.abort(); unwatch(); };
  }, [projectId, refresh]);

  const act = async (action: RunWorkAction): Promise<void> => {
    if (!runId || inFlight.current || readError || mustVerify) return;
    inFlight.current = true; setBusy(true); setMessage('正在核对并提交…'); setStopConfirm(false);
    const signal = lifetime.current.signal;
    try {
      const result = await performRunWorkAction(client, projectId, runId, action, signal);
      if (signal.aborted) return;
      setNextRunId(result.nextRunId);
      setMessage(action.kind === 'accept' ? '结果已采纳，画布正在同步'
        : action.kind === 'reject' ? '已退回这份结果' : action.kind === 'retry' ? '已创建重试任务，尚未自动派发'
        : action.kind === 'answer' ? '回答已提交' : action.kind === 'cancel' ? '停止请求已处理，以任务状态为准' : '操作已确认，正在更新状态');
      await refresh();
    } catch (error) {
      if (!signal.aborted) {
        setMessage(error instanceof Error ? error.message : '操作结果未确认');
        setMustVerify(true); // Read before any repeat; never repeat an unknown mutation automatically.
        await refresh();
      }
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };

  if (!runId) return <div className="lcos-run-work" role="status">没有指定任务。</div>;
  const openReader = (artifactId: string, revisionId?: string): void => {
    useLcosShellStore.getState().openReader('结果材料', artifactId,
      revisionId ? { revisionId } : undefined);
  };
  const state = review?.inputRequest?.status === 'pending' ? 'waiting_input' : review?.presentationPhase ?? 'unavailable';
  const disabled = busy || !!readError || mustVerify;
  return <article className="lcos-run-work" data-lcos-run-work={runId} aria-busy={busy}>
    <header className="lcos-run-work-header">
      <div><span className="lcos-run-work-state" data-state={state}>{review ? executionStatusLabel(state) : readError ? '暂时无法读取' : '正在读取任务'}</span>
        <h2>{review?.run.instruction?.split(/\r?\n/, 1)[0] || '任务'}</h2></div>
      <LcosButton appearance="oreo" variant="secondary" type="button" disabled={busy} onClick={() => { void refresh(true); }}>核对状态</LcosButton>
    </header>
    {readError && <p role="alert">{readError}；已读内容保留，操作暂不可用。</p>}
    {message && <p role={mustVerify ? 'alert' : 'status'} className="lcos-run-work-feedback">{message}{mustVerify ? ' · 先核对状态，再决定下一步。' : ''}</p>}
    {review && <>
      <div className="lcos-run-work-actions">
        {review.run.status === 'created' && review.dispatch.status === 'planned'
          && <LcosButton appearance="oreo" variant="primary" type="button" disabled={disabled} onClick={() => { void act({ kind: 'dispatch' }); }}>开始执行</LcosButton>}
        <LcosButton appearance="oreo" variant="secondary" type="button" disabled={disabled} onClick={() => { void act({ kind: 'sync' }); }}>同步执行状态</LcosButton>
        {review.run.status === 'failed' && <LcosButton appearance="oreo" variant="secondary" type="button" disabled={disabled} onClick={() => { void act({ kind: 'recover' }); }}>恢复原任务</LcosButton>}
        {!['completed', 'cancelled', 'failed'].includes(review.run.status)
          && <LcosButton appearance="oreo" variant="secondary" type="button" disabled={disabled} onClick={() => setStopConfirm(true)}>停止任务</LcosButton>}
      </div>
      {stopConfirm && <div role="group" aria-label="确认停止任务" className="lcos-run-confirm" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); setStopConfirm(false); } }}>
        <p>停止当前任务？已有材料保留，执行端状态以返回结果为准。</p>
        <LcosButton appearance="oreo" variant="destructive" type="button" disabled={disabled} onClick={() => { void act({ kind: 'cancel' }); }}>确认停止</LcosButton>
        <LcosButton appearance="oreo" variant="secondary" type="button" onClick={() => setStopConfirm(false)}>继续保留</LcosButton>
      </div>}
      {review.inputRequest?.status === 'pending' && <section className="lcos-run-attention" aria-label="等待回答">
        <h3>等你回答</h3><p>{review.inputRequest.question}</p>
        <div className="lcos-run-input-options">{review.inputRequest.options.map((option) => <label key={option}>
          <input type="checkbox" checked={options.includes(option)} disabled={disabled} onChange={(event) => setOptions((previous) => event.target.checked ? [...previous, option] : previous.filter((value) => value !== option))} />{option}
        </label>)}</div>
        {review.inputRequest.allowFreeText && <div className="lcos-composer-editor lcos-run-answer"><textarea aria-label="回答当前问题" value={answer} disabled={disabled} onChange={(event) => setAnswer(event.target.value)} rows={3} /></div>}
        <LcosButton appearance="oreo" variant="secondary" type="button" disabled={disabled || (!answer.trim() && options.length === 0)} onClick={() => { void act({ kind: 'answer', input: { requestId: review.inputRequest!.requestId, text: answer, selectedOptions: options } }); }}>提交回答</LcosButton>
      </section>}
      <section className="lcos-run-instruction"><h3>本次指令</h3><p>{review.run.instruction}</p></section>
      {(review.run.resultSummary || review.run.shortSummary) && <section><h3>执行结果</h3><p>{review.run.resultSummary || review.run.shortSummary}</p></section>}
      {review.returns.length > 0 && <section aria-label="返回材料"><h3>返回材料</h3>{review.returns.map((item, index) => {
        return <div className="lcos-run-return" key={String(item.id)} data-lcos-run-return={String(item.id)}>
          <strong>结果 {index + 1}</strong><span>{item.status === 'pending_review' ? '等待复核' : item.status === 'adopted' ? '已采纳' : item.status === 'rejected' ? '已退回' : '已记录'}</span>
          <div className="lcos-run-work-actions">
            <LcosButton appearance="oreo" variant="secondary" type="button" onClick={() => openReader(String(item.targetArtifactId), item.draftRevisionId === undefined ? undefined : String(item.draftRevisionId))}>查看材料</LcosButton>
            {item.status === 'pending_review' && (['accept', 'reject', 'retry'] as const).map((kind) => <LcosButton appearance="oreo" variant="secondary" key={kind} type="button" disabled={disabled || !review.capabilities[kind].enabled}
              onClick={() => { void act({ kind, returnId: String(item.id), baseRevisionId: String(item.baseRevisionId) }); }}>
              {kind === 'accept' ? '采纳' : kind === 'reject' ? '退回' : '重新尝试'}</LcosButton>)}
          </div></div>;
      })}</section>}
      {nextRunId && <LcosButton appearance="oreo" variant="secondary" type="button" onClick={() => useLcosShellStore.getState().openWindow('run-review', '重试任务', nextRunId)}>打开重试任务</LcosButton>}
      <details className="lcos-run-details"><summary>本次输入与来源</summary>
        {recipeError && <p role="status">{recipeError}</p>}
        {recipe && <><p>{recipe.orderedReferences.length} 项明确引用{recipe.resultSlotId ? ' · 已关联结果位' : ''}</p>
          {recipe.orderedReferences.length > 0 && <ol>{recipe.orderedReferences.map((item, index) => <li key={index}>{referenceLabel(item.ref)}</li>)}</ol>}
          <p>按任务创建时的输入记录显示；当前画布选中内容不会自动替换它。</p></>}
      </details>
      <details className="lcos-run-details"><summary>诊断信息</summary><p>任务：{runId}</p><p>派发：{review.dispatch.status}</p>
        {review.run.errorMessage && <p>{review.run.errorMessage}</p>}{review.dispatch.lastErrorMessage && <p>{review.dispatch.lastErrorMessage}</p>}
      </details>
    </>}
  </article>;
}

function referenceLabel(ref: RunRecipeV0['orderedReferences'][number]['ref']): string {
  const names: Record<string, string> = { artifact: '材料', view: '材料版本', workspace: '工作现场', scope: '使用范围', conversation: '会话', component: '组件' };
  const id = Object.entries(ref).find(([key]) => key !== 'type')?.[1];
  return `${names[ref.type] ?? '引用'} · ${String(id ?? '')}`;
}
