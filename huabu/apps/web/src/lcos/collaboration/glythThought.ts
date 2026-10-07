import type { CollaborationSessionProjectionV1, CollaborationTimelineItemV1 } from '@local-creative-os/contracts';

export type GlythThoughtTone = 'thinking' | 'working' | 'attention' | 'done' | 'error';
export interface GlythThought {
  readonly key: string;
  readonly scope: string;
  readonly text: string;
  readonly tone: GlythThoughtTone;
  readonly sticky: boolean;
  readonly occurredAt?: string;
  readonly sourceItemId?: string;
  readonly detail?: string;
  readonly source: 'progress' | 'task' | 'attention' | 'result' | 'recovery';
}
const clean = (text: string): string => text.replace(/\s+/gu, ' ').trim();
function compact(text: string, length = 96): string {
  const chars = Array.from(clean(text));
  return chars.length > length ? chars.slice(0, length - 1).join('') + '…' : chars.join('');
}
function newest(items: readonly CollaborationTimelineItemV1[], kinds: readonly CollaborationTimelineItemV1['kind'][]): CollaborationTimelineItemV1 | undefined {
  return items.filter(item => kinds.includes(item.kind) && clean(item.title) && Number.isFinite(Date.parse(item.occurredAt)))
    .reduce<CollaborationTimelineItemV1 | undefined>((last, item) => !last || Date.parse(item.occurredAt) > Date.parse(last.occurredAt) ? item : last, undefined);
}
/** Only existing, user-facing Collaboration facts are consumed. No raw reasoning, new event bus or database. */
export function resolveGlythThought(
  projection: CollaborationSessionProjectionV1 | undefined,
  timeline: readonly CollaborationTimelineItemV1[] | undefined,
  timelineStatus?: 'ready' | 'error',
): GlythThought | undefined {
  if (!projection) return undefined;
  const runId = projection.activity.activeRunId;
  const scope = JSON.stringify([projection.projectId, projection.conversationId, runId ?? null]);
  // A previous run's progress is never a fallback for this run. Failed timeline reads are not live facts.
  const items = runId && timelineStatus !== 'error' ? (timeline ?? []).filter(item => item.refs?.runId === runId) : [];
  const make = (tone: GlythThoughtTone, text: string, source: GlythThought['source'], item?: CollaborationTimelineItemV1, sourceId?: string): GlythThought => ({
    scope, tone, source, text: compact(text), sticky: tone === 'attention' || tone === 'error',
    key: JSON.stringify([scope, tone, sourceId ?? item?.itemId ?? source, clean(text)]),
    ...(item ? { occurredAt: item.occurredAt, sourceItemId: item.itemId } : {}),
    ...(clean(text).length > 96 ? { detail: clean(text) } : {}),
  });
  if (projection.userState === 'unavailable') return make('error', projection.recovery?.userMessage ?? '暂时接不上这段协作。打开会话查看恢复方式。', 'recovery');
  if (projection.recovery?.state === 'recoverable' || projection.recovery?.state === 'blocked')
    return make('attention', projection.recovery.userMessage ?? '上次协作需要先恢复。', 'recovery');
  if (projection.userState === 'needs_user') {
    if (projection.activity.pendingInputId) {
      // Canonical projected request ids end in :input:<requestId>. Do not resurrect a resolved question.
      const requestId = projection.activity.pendingInputId;
      const exact = items.filter(item => item.itemId === requestId || item.itemId.endsWith(`:input:${requestId}`));
      const input = newest(exact, ['input_required']);
      return make('attention', input?.title ?? '有一个问题需要你回答。', 'attention', input, requestId);
    }
    const pending = [...projection.recentReturns].filter(item => item.status === 'pending_review')
      .sort((a, b) => b.returnedAt.localeCompare(a.returnedAt))[0];
    if (pending) return make('attention', `有一份结果待确认：${pending.title}`, 'attention', undefined, pending.returnId);
    return make('attention', projection.recovery?.userMessage ?? '这一步需要你确认。', 'attention');
  }
  if (projection.userState === 'thinking' || projection.userState === 'working') {
    if (projection.recovery?.state === 'recovering') return make('working', projection.recovery.userMessage ?? '正在恢复上次协作，结果还未确认。', 'recovery');
    const progress = newest(items, ['progress']);
    if (progress) return make(projection.userState, progress.title, 'progress', progress);
    const started = newest(items, ['work_started']);
    const task = projection.activity.activeSummary?.trim() || started?.title;
    // The task title is labelled as such; absence of real progress does not become invented narration.
    return task ? make(projection.userState, `当前任务：${task}`, 'task', started) : undefined;
  }
  if (projection.userState === 'done') {
    const result = newest(items, ['result_returned', 'result_adopted']);
    if (result) {
      const returned = projection.recentReturns.find(row => row.returnId === result.refs?.returnId);
      return make('done', returned ? `结果回来了：${returned.title}` : result.title, 'result', result);
    }
    return undefined;
  }
  return undefined;
}
