/**
 * ExecutionItemV1 — 统一执行读模型（S1，审计 §11）。
 *
 * 命题：Execution Stack / Floating Companion 不再拼 Bridge/Run/provider 三套状态，
 * 只消费 Core 的单一 ExecutionItemV1 投影；availableActions 由 capability × state 纯推导，
 * 不支持的操作诚实不出现在数组里（错误码表封闭红线的读模型版）。
 *
 * 状态宇宙 = runs 表 CHECK 约束七态（S0 census 机器提取，20260830）。
 * resume 行为空：当前 run 状态机无 paused 态，pause/resume 属 S7 任务；
 * 矩阵保留 resume 行是给 S7 落地后的推导路径，不是假装现在可用。
 */

/** run 状态机七态（与 metadata-repository runs CHECK 一致；S0 census 事实源）。 */
export type ExecutionItemState =
  | 'created'
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 任务控制操作宇宙（审计 §4.3；支持与否由 capability × state 推导）。 */
export type ExecutionItemAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'answer_input'

/** ExecutionItemV1 目标引用（v0.15 只有 artifact 目标；S4 companion 扩展 kind）。 */
export interface ExecutionItemTargetRef {
  readonly kind: 'artifact' | 'agentlet'
  readonly artifactId: string
}

export interface ExecutionItemV1 {
  readonly schemaVersion: 1
  readonly kind: 'run' | 'agentlet'
  readonly id: string
  readonly runId: string
  readonly targetRef: ExecutionItemTargetRef | null
  readonly label: string
  readonly state: ExecutionItemState
  /** 0-1；无进度来源时为 null（诚实空值，S6 事件流接入后填充）。 */
  readonly progress: number | null
  readonly needsAttention: boolean
  readonly availableActions: readonly ExecutionItemAction[]
  /** 产出物指针（首个 Artifact Return 的目标 artifactId）；无产出为 null。 */
  readonly resultRef: string | null
  /** 关联提案指针；v0.15 无 run→proposal 链接（S3 RunRecipe seam 落地后填充）。 */
  readonly proposalRef: string | null
  readonly provider: 'workbuddy' | 'codex'
  readonly createdAt: string
  readonly updatedAt: string
}

/** 当前部署声明的控制能力（与 S0 census controlOperations 矩阵一致；gate 强制校验）。 */
export interface ExecutionItemCapabilities {
  readonly pause: boolean
  readonly resume: boolean
  readonly cancel: boolean
  readonly retry: boolean
  readonly answerInput: boolean
}

/** action × 合法源状态矩阵（推导单一事实源；resume 为空行 = S7 前诚实不可用）。 */
export const EXECUTION_ITEM_ACTION_STATES: Readonly<Record<ExecutionItemAction, readonly ExecutionItemState[]>> = {
  pause: ['running'],
  resume: [],
  cancel: ['created', 'queued', 'running', 'waiting_input'],
  retry: ['failed', 'cancelled'],
  answer_input: ['waiting_input'],
}

/** needsAttention 纯推导：等待输入或失败需要用户注意。 */
export function executionItemNeedsAttention(state: ExecutionItemState): boolean {
  return state === 'waiting_input' || state === 'failed'
}

/** availableActions 纯推导：capability 关 + 状态合法才出现；不支持就诚实不在数组里。 */
export function deriveAvailableActions(
  state: ExecutionItemState,
  capabilities: ExecutionItemCapabilities,
): readonly ExecutionItemAction[] {
  const actions: ExecutionItemAction[] = []
  if (capabilities.pause && EXECUTION_ITEM_ACTION_STATES.pause.includes(state)) actions.push('pause')
  if (capabilities.resume && EXECUTION_ITEM_ACTION_STATES.resume.includes(state)) actions.push('resume')
  if (capabilities.cancel && EXECUTION_ITEM_ACTION_STATES.cancel.includes(state)) actions.push('cancel')
  if (capabilities.retry && EXECUTION_ITEM_ACTION_STATES.retry.includes(state)) actions.push('retry')
  if (capabilities.answerInput && EXECUTION_ITEM_ACTION_STATES.answer_input.includes(state)) actions.push('answer_input')
  return actions
}