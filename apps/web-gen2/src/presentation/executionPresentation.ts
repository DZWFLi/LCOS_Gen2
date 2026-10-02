import type { RunCanvasProjection, ResultSlotV0, ProjectExecutionProjection } from '@local-creative-os/contracts';
import type { ProjectedEntityFacts } from './projectedNodeDescriptor.js';

export function executionStatusLabel(status?: string): string {
  return ({ created: '等待派发', queued: '排队中', running: '正在执行', waiting_input: '等你回答',
    review: '需要复核', completed: '已完成', failed: '执行失败', cancelled: '已停止',
    empty: '等待结果', materialized: '已采纳 · 查看记录' } as Record<string, string>)[status ?? ''] ?? '状态暂不可用';
}

/** Core timestamps/ids are never inferred from titles or node geometry. */
export function runPresentation(run: RunCanvasProjection): ProjectedEntityFacts {
  const status = run.status === 'waiting_input' ? 'waiting_input' : run.pendingReturnCount > 0 ? 'review' : run.status;
  return { entityType: 'run', entityId: run.id, title: run.title,
    execution: { runId: run.id, status, pendingReturnCount: run.pendingReturnCount,
      ...(run.resultSlotId ? { resultSlotId: run.resultSlotId } : {}) } };
}

export function resultSlotPresentation(slot: ResultSlotV0, snapshot: ProjectExecutionProjection): ProjectedEntityFacts {
  const run = snapshot.runs.find((candidate) => candidate.id === slot.runId);
  const status = slot.status === 'materialized' || slot.status === 'empty' ? slot.status
    : run ? runPresentation(run).execution!.status : 'unavailable';
  return { entityType: 'result-slot', entityId: slot.id, title: run?.title ?? '结果位',
    execution: { status, pendingReturnCount: run?.pendingReturnCount ?? 0, resultSlotId: slot.id,
      ...(slot.runId ? { runId: slot.runId } : {}),
      ...(slot.artifactId ? { artifactId: slot.artifactId } : {}),
      ...(slot.artifactViewId ? { artifactViewId: slot.artifactViewId } : {}) } };
}
