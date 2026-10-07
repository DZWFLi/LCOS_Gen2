import { describe, expect, it } from 'vitest';
import { resolveGlythThought } from './glythThought';
import type { CollaborationSessionProjectionV1, CollaborationTimelineItemV1 } from '@local-creative-os/contracts';
const base: CollaborationSessionProjectionV1 = {
  schemaVersion: 1, projectId: 'p', conversationId: 'c', identity: { title: 'Glyth' }, userState: 'working',
  relation: { targetRefs: [] }, activity: { activeRunId: 'r2', activeSummary: '核对视觉参考' }, recentReturns: [],
  capabilities: { canSend: true, canDelegate: true, canResume: true, canFork: false, canSelectedContext: true,
    canBlankNew: true, canHandoff: true, canAnswerInput: true, canApprove: true, canCancel: true, canRecover: true, canOpenDiagnostics: true },
};
function row(itemId: string, kind: CollaborationTimelineItemV1['kind'], title: string, runId = 'r2', occurredAt = '2026-10-07T03:00:00Z'): CollaborationTimelineItemV1 {
  return { schemaVersion: 1, itemId, kind, title, occurredAt, refs: { runId } };
}
describe('Glyth progress whisper', () => {
  it('does not create a thought from an unavailable projection or a ready session', () => {
    expect(resolveGlythThought(undefined, [])).toBeUndefined();
    expect(resolveGlythThought({ ...base, userState: 'ready' }, [])).toBeUndefined();
  });
  it('reads only the current run progress', () => {
    const value = resolveGlythThought(base, [row('old', 'progress', '旧进展', 'r1'), row('new', 'progress', '核对两段录屏的辉光。')]);
    expect(value).toMatchObject({ text: '核对两段录屏的辉光。', source: 'progress', sourceItemId: 'new' });
  });
  it('does not borrow an old run when the current run has no summary', () => {
    expect(resolveGlythThought(base, [row('old', 'progress', '旧进展', 'r1')])).toMatchObject({ source: 'task', text: '当前任务：核对视觉参考' });
  });
  it('does not surface stale timeline cache after a read error', () => {
    expect(resolveGlythThought(base, [row('new', 'progress', '核对辉光')], 'error')?.source).toBe('task');
  });
  it('uses timestamps instead of assuming the timeline is sorted', () => {
    expect(resolveGlythThought(base, [row('new', 'progress', '新的进展', 'r2', '2026-10-07T03:01:00Z'), row('old', 'progress', '旧的进展')])?.sourceItemId).toBe('new');
  });
  it('ignores heartbeat time when generating the visible sentence key', () => {
    const timeline = [row('a', 'progress', '同一句进展')];
    expect(resolveGlythThought(base, timeline)?.key).toBe(resolveGlythThought({ ...base, activity: { ...base.activity, lastActivityAt: '2026-10-07T04:00:00Z' } }, timeline)?.key);
  });
  it('does not turn raw assistant content or system notes into process narration', () => {
    expect(resolveGlythThought(base, [row('a', 'agent_message', '完整回复'), row('b', 'system_note', '结果未知')])?.source).toBe('task');
  });
  it('requires an exact pending question identity', () => {
    const p: CollaborationSessionProjectionV1 = { ...base, userState: 'needs_user', activity: { ...base.activity, pendingInputId: 'q2' } };
    expect(resolveGlythThought(p, [row('run:r2:input:q1', 'input_required', '旧问题')])?.text).toBe('有一个问题需要你回答。');
    expect(resolveGlythThought(p, [row('run:r2:input:q2', 'input_required', '保留柔光吗？')])).toMatchObject({ text: '保留柔光吗？', sticky: true });
  });
  it('does not claim an old result belongs to the current completed run', () => {
    expect(resolveGlythThought({ ...base, userState: 'done' }, [row('r', 'result_returned', '旧结果', 'r1')])).toBeUndefined();
  });
  it('retains full copy for an expanded long summary', () => {
    const value = resolveGlythThought(base, [row('a', 'progress', '字'.repeat(120))]);
    expect(value?.text).toHaveLength(96); expect(value?.detail).toHaveLength(120);
  });
});
