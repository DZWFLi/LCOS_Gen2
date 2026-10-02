import type { AnswerRunInputRequestV1, RunReview } from '@local-creative-os/contracts';
import type { CoreRunClient } from '@local-creative-os/web-gen2';

export type RunWorkAction =
  | { kind: 'dispatch' | 'sync' | 'recover' | 'cancel' }
  | { kind: 'answer'; input: AnswerRunInputRequestV1 }
  | { kind: 'accept' | 'reject' | 'retry'; returnId: string; baseRevisionId: string };

export type RunWorkClient = Pick<CoreRunClient, 'readRunReview' | 'actOnRun' | 'cancelRun' | 'answerInput'
  | 'acceptArtifactReturn' | 'rejectArtifactReturn' | 'retryArtifactReturn'>;

export function assertRunReview(value: RunReview, projectId: string, runId: string): RunReview {
  if (!value?.run || String(value.run.id) !== runId || String(value.run.projectId) !== projectId
    || !value.dispatch || String(value.dispatch.runId) !== runId || !Array.isArray(value.returns)) {
    throw new Error('任务身份未确认，请重新读取。');
  }
  if (value.returns.some((item) => String(item.runId) !== runId)) throw new Error('返回材料不属于当前任务。');
  return value;
}

/** Mutations use a freshly read owner and the exact item the user acted on.
 * No optimistic completion, replacement Run, or mutation on window open. */
export async function performRunWorkAction(client: RunWorkClient, projectId: string, runId: string,
  action: RunWorkAction, signal?: AbortSignal): Promise<{ nextRunId?: string }> {
  const fresh = assertRunReview(await client.readRunReview(runId, signal), projectId, runId);
  if (signal?.aborted) throw new Error('任务窗口已关闭；操作未发送。');
  let response: unknown;
  if ('returnId' in action) {
    const item = fresh.returns.find((candidate) => String(candidate.id) === action.returnId);
    if (!item || item.status !== 'pending_review' || String(item.baseRevisionId) !== action.baseRevisionId
      || fresh.capabilities[action.kind]?.enabled !== true) throw new Error('这份结果已变化，请先核对当前结果。');
    response = action.kind === 'accept'
      ? await client.acceptArtifactReturn(action.returnId, { expectedBaseRevisionId: item.baseRevisionId }, signal)
      : action.kind === 'reject' ? await client.rejectArtifactReturn(action.returnId, signal)
      : await client.retryArtifactReturn(action.returnId, undefined, signal);
    const value = response as { run?: RunReview['run']; artifactReturn?: RunReview['returns'][number]; previousRun?: RunReview['run']; previousReturn?: RunReview['returns'][number] };
    if (action.kind === 'retry') {
      if (String(value.previousRun?.id) !== runId || String(value.previousReturn?.id) !== action.returnId
        || value.run?.projectId !== projectId || !value.run.id || value.run.id === runId) throw new Error('重试回执尚未确认，请核对原任务。');
      return { nextRunId: String(value.run.id) };
    }
    if (String(value.run?.id) !== runId || String(value.run?.projectId) !== projectId
      || String(value.artifactReturn?.id) !== action.returnId
      || value.artifactReturn?.status !== (action.kind === 'accept' ? 'adopted' : 'rejected')) {
      throw new Error('复核回执尚未确认，请核对原任务，勿重复提交。');
    }
    return {};
  }
  if (action.kind === 'answer') {
    const request = fresh.inputRequest;
    const selected = [...new Set(action.input.selectedOptions ?? [])];
    const text = action.input.text?.trim();
    if (!request || request.status !== 'pending' || request.requestId !== action.input.requestId
      || request.runId !== runId) throw new Error('原问题已变化，请先查看当前问题。');
    if (selected.some((option) => !request.options.includes(option)) || (text && !request.allowFreeText)
      || (!text && selected.length === 0)) throw new Error('回答不符合当前问题的选项或输入要求。');
    response = await client.answerInput(runId, { requestId: request.requestId, ...(text ? { text } : {}), selectedOptions: selected }, signal);
  } else if (action.kind === 'cancel') {
    if (['completed', 'cancelled', 'failed'].includes(fresh.run.status)) throw new Error('任务已结束，不再发送停止请求。');
    response = await client.cancelRun(runId, signal);
  } else {
    if (action.kind === 'dispatch' && (fresh.run.status !== 'created' || fresh.dispatch.status !== 'planned')) {
      throw new Error('任务不再等待首次派发，请核对原任务状态。');
    }
    response = await client.actOnRun(runId, action.kind, signal);
  }
  const value = response as { review?: RunReview; providerError?: { message?: string } };
  assertRunReview(value?.review as RunReview, projectId, runId);
  if (value.providerError !== undefined) throw new Error(value.providerError.message || '执行端未确认，请核对原任务。');
  return {};
}
