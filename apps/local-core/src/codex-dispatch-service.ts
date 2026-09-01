import type { RunReview } from '@local-creative-os/contracts'

export interface CodexDispatchSessionInput {
  readonly sessionId: string
  readonly guiActive?: boolean
  /** 会话正在思考/回复中（由看门狗按会话文件最近写入判断）。 */
  readonly busy?: boolean
}

export interface CodexTaskState {
  readonly status?: string
  readonly leaseExpiresAt?: string
}

export type CodexDispatchDecision = 'dispatch_existing' | 'spawn_new' | 'wait'

export interface CodexDispatchPlanItem {
  readonly runId: string
  readonly taskId?: string
  readonly outputIntent: string
  readonly instruction: string
  readonly decision: CodexDispatchDecision
  readonly sessionId?: string
  readonly projectRoot?: string
  readonly reason: string
}

/**
 * Core 判断 Codex 任务的派单方式：
 * - 有会话且空闲（未在思考）→ 送进现有会话，哪怕窗口开着；
 * - 会话正在思考 → 等待（不打断）；
 * - 完全没有注册会话 → 拉起新会话。
 */
export function planCodexDispatch(
  runs: readonly RunReview[],
  projectRoot: string,
  sessions: readonly CodexDispatchSessionInput[],
  taskStates: ReadonlyMap<string, CodexTaskState>,
): readonly CodexDispatchPlanItem[] {
  const now = Date.now()
  const isClaimable = (state: CodexTaskState | undefined): boolean => {
    if (state === undefined) return false
    const status = String(state.status ?? '')
    if (['assigned', 'queued'].includes(status)) return true
    if (['claimed', 'running'].includes(status)) {
      return state.leaseExpiresAt !== undefined
        && new Date(state.leaseExpiresAt).getTime() < now
    }
    return false
  }
  const pending = runs.filter((review) =>
    review.run.provider === 'codex'
    && ['created', 'queued', 'running'].includes(review.run.status)
    && review.dispatch.status === 'bound'
    && isClaimable(taskStates.get(String(review.run.id))))
  const available = sessions.find((session) => session.sessionId && !session.busy)
  const thinking = sessions.length > 0 && available === undefined

  // 同一 Project + Provider 默认串行，只派发队首 Run，避免同一 Codex Session 并发污染上下文。
  return pending.slice(0, 1).map((review) => {
    const runId = String(review.run.id)
    if (available !== undefined) {
      return {
        runId,
        ...(review.binding?.externalTaskId === undefined ? {} : { taskId: String(review.binding.externalTaskId) }),
        outputIntent: review.run.outputIntent,
        instruction: review.run.instruction.slice(0, 200),
        decision: 'dispatch_existing' as const,
        sessionId: available.sessionId,
        projectRoot,
        reason: '已注册可用的 CLI 会话，直接派单。',
      }
    }
    if (thinking) {
      return {
        runId,
        ...(review.binding?.externalTaskId === undefined ? {} : { taskId: String(review.binding.externalTaskId) }),
        outputIntent: review.run.outputIntent,
        instruction: review.run.instruction.slice(0, 200),
        decision: 'wait' as const,
        reason: '项目会话正在思考/回复中，等它空闲再接活。',
      }
    }
    return {
      runId,
      ...(review.binding?.externalTaskId === undefined ? {} : { taskId: String(review.binding.externalTaskId) }),
      outputIntent: review.run.outputIntent,
      instruction: review.run.instruction.slice(0, 200),
      decision: 'spawn_new' as const,
      projectRoot,
      reason: '该项目没有注册 CLI 会话，需要拉起新会话执行。',
    }
  })
}
