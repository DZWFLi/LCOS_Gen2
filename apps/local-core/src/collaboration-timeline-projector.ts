/**
 * Collaboration Timeline Projector（收敛方案 V1 §8 + §11.2）。
 *
 * 只读投影：Run / Artifact Return / waiting_input / Continuation journal → TimelineItem。
 * 不新建 persisted Turn 表；item id 由来源 truth id 派生（可重建、可重放）。
 *
 * 诚实边界：
 * - live 会话的 user_message / agent_message 内容由 provider/Huabu 持有，Core 不复制；
 *   V1 只用 run.instruction 表达「用户发起的工作」（work_started）。
 * - recovered 无可靠信号（journal 只存当前态），V1 不发射；恢复中 → progress。
 */

import type {
  ContinuationRecoveryProjectionV1,
  RunReview,
} from '@local-creative-os/contracts'
import type { CollaborationTimelineItemV1 } from '@local-creative-os/contracts'
import type { ArtifactReturn, Run } from '@local-creative-os/domain'

export interface CollaborationTimelineFacts {
  /** 该会话的 Run（任意顺序，内部自行排序）。 */
  readonly runs: readonly Run[]
  /** 对应 Run 的复核视图（returns / inputRequest）。 */
  readonly reviews: readonly RunReview[]
  /** 该会话的 continuation journal 投影。 */
  readonly operations: readonly ContinuationRecoveryProjectionV1[]
}

function firstLine(text: string): string {
  const line = text.split('\n').map((part) => part.trim()).find((part) => part.length > 0)
  return line === undefined ? '未命名任务' : line.length > 60 ? `${line.slice(0, 60)}…` : line
}

function byOccurredAt(a: CollaborationTimelineItemV1, b: CollaborationTimelineItemV1): number {
  return a.occurredAt.localeCompare(b.occurredAt)
}

function returnTitle(returnRow: ArtifactReturn): string {
  return `产出回传（${returnRow.status === 'pending_review' ? '待复核' : returnRow.status === 'adopted' ? '已采纳' : '已拒绝'}）`
}

export function projectCollaborationTimelineV1(
  facts: CollaborationTimelineFacts,
  options: { readonly limit?: number } = {},
): CollaborationTimelineItemV1[] {
  const items: CollaborationTimelineItemV1[] = []
  const reviewByRunId = new Map(facts.reviews.map((review) => [String(review.run.id), review]))

  const runs = [...facts.runs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const run of runs) {
    const runId = String(run.id)
    items.push({
      schemaVersion: 1,
      itemId: `run:${runId}:started`,
      kind: 'work_started',
      occurredAt: run.createdAt,
      title: firstLine(run.instruction),
      refs: { runId },
    })
    const review = reviewByRunId.get(runId)
    const inputRequest = review?.inputRequest
    if (inputRequest !== undefined && inputRequest.status === 'pending') {
      items.push({
        schemaVersion: 1,
        itemId: `run:${runId}:input:${inputRequest.requestId}`,
        kind: 'input_required',
        occurredAt: run.updatedAt,
        title: inputRequest.question,
        refs: { runId },
      })
    } else if (run.status === 'waiting_input') {
      // 状态诚实降级：Run 处于 waiting_input 但请求行缺失时仍表达「等待回答」。
      items.push({
        schemaVersion: 1,
        itemId: `run:${runId}:input`,
        kind: 'input_required',
        occurredAt: run.updatedAt,
        title: '等待你的回答',
        refs: { runId },
      })
    }
    if (run.status === 'failed') {
      items.push({
        schemaVersion: 1,
        itemId: `run:${runId}:failed`,
        kind: 'error',
        occurredAt: run.updatedAt,
        title: '执行失败',
        ...(run.errorMessage === undefined ? {} : { body: run.errorMessage }),
        refs: { runId },
      })
    }
    for (const returnRow of review?.returns ?? []) {
      const returnId = String(returnRow.id)
      if (returnRow.status === 'pending_review') {
        items.push({
          schemaVersion: 1,
          itemId: `return:${returnId}:returned`,
          kind: 'result_returned',
          occurredAt: returnRow.createdAt,
          title: returnTitle(returnRow),
          refs: { runId, returnId },
        })
      } else if (returnRow.status === 'adopted') {
        items.push({
          schemaVersion: 1,
          itemId: `return:${returnId}:adopted`,
          kind: 'result_adopted',
          occurredAt: returnRow.updatedAt,
          title: returnTitle(returnRow),
          refs: { runId, returnId },
        })
      }
    }
  }

  for (const op of facts.operations) {
    if (op.status === 'recovering') {
      items.push({
        schemaVersion: 1,
        itemId: `op:${op.operationId}:recovering`,
        kind: 'progress',
        occurredAt: op.updatedAt,
        title: '正在恢复上次的协作',
        refs: { continuationOperationId: op.operationId },
      })
    } else if (op.status === 'outcome_unknown') {
      items.push({
        schemaVersion: 1,
        itemId: `op:${op.operationId}:outcome-unknown`,
        kind: 'system_note',
        occurredAt: op.updatedAt,
        title: '上次操作结果未知，正在核对状态',
        refs: { continuationOperationId: op.operationId },
      })
    }
  }

  const sorted = items.sort(byOccurredAt)
  const limit = options.limit ?? 50
  return sorted.length <= limit ? sorted : sorted.slice(sorted.length - limit)
}