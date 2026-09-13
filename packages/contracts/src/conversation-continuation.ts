/**
 * Sprint 1A（T6）：Continuation Operation Journal + Read Projection —— canonical producer。
 *
 * 命题：Provider session 与本地 Core 不是同一个事务。Provider 已成功创建外部 session，
 * 但 Core 在绑定前崩溃/超时/重启时，UI 只知道"结果未知"。直接重试 create 会产生重复
 * 外部会话；直接标失败会丢掉已存在的 session。必须持久保存同一 operationId 的步骤
 * 事实与外部回执，再由恢复流程查询和补绑。
 *
 * 本文件只定义共享 canonical 类型与纯状态投影；durable journal 持久层在
 * metadata-repository（migration v53），服务与路由在 local-core。
 *
 * 状态宇宙隔离：continuation operation 不是 Run 七态，不是 permission，不是 waiting
 * input，不是 capture，不是 projection。六套事实各保留自己的状态宇宙（T6 §4），
 * 不允许把 continuation 塞进 ExecutionItem 或 Run 枚举。
 */

import type { ConnectedConversationV1 } from './receiver.js'
import type { OrderedRunReferenceV2 } from './run-assembly.js'

/** 四种续工模式（README「续工」统一语义：continue existing / native full-history fork / selected-context new session / blank new session）。 */
export type ContinuationModeV1 =
  | 'continue_existing'
  | 'native_full_fork'
  | 'selected_context'
  | 'blank_new'

/** context inheritance 与 checkout/worktree 是两条独立选择轴。 */
export type ContinuationContextInheritanceV1 = 'inherit' | 'none'
export type ContinuationCheckoutV1 = 'shared' | 'isolated'

/** 四步操作步骤。not_applicable：该模式/该链跳过此步。 */
export type ContinuationStepKindV1 = 'external_create' | 'core_bind' | 'attach' | 'projection'

/** 每步可靠状态：not_started / pending / confirmed / failed / outcome_unknown / not_applicable。 */
export type ContinuationStepStateV1 =
  | 'not_started'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'outcome_unknown'
  | 'not_applicable'

/** cancel 三态必须分开：requested=本地意图已记账；outcome_unknown=外部终态未知；confirmed=已确认取消。 */
export type ContinuationCancelStateV1 = 'none' | 'requested' | 'confirmed' | 'outcome_unknown'

/** provider 外部 session 证据（T7 写入；Provider 的 externalSessionId 不做全表唯一——同一外部 session 可承接多个操作）。 */
export interface ContinuationExternalEvidenceV1 {
  readonly schemaVersion: 1
  readonly provider: string
  readonly externalSessionId: string
  /** 外部回执 correlation（provider create 的原生 id / threading key；失败恢复时凭它还原外部状态）。 */
  readonly correlationId: string
  readonly createdAt: string
  readonly raw?: { readonly kind: 'provider_receipt' | 'provider_error'; readonly ref: string }
}

/** 持久化 journal 行（operationId 稳定主键；步骤事实 + revision + external evidence）。 */
export interface ContinuationOperationJournalRowV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly projectId: string
  /** 目标承接对话（bind 目标；submit 时可能尚未选定/创建。后续按 ConnectedConversation.id 对齐）。 */
  readonly connectedConversationId: string | null
  readonly mode: ContinuationModeV1
  readonly contextInheritance: ContinuationContextInheritanceV1
  readonly checkout: ContinuationCheckoutV1
  readonly provider: string
  readonly steps: Readonly<Record<ContinuationStepKindV1, ContinuationStepStateV1>>
  readonly cancel: ContinuationCancelStateV1
  readonly externalEvidence?: ContinuationExternalEvidenceV1
  readonly errorEvidence?: string
  /** 提交时用户显式选择的引用（与 Run 同型的 OrderedRunReferenceV2；恢复 bundle 从它构建真实上下文）。 */
  readonly orderedReferences?: readonly OrderedRunReferenceV2[]
  /** journal 自身的乐观并发版本：每次步骤推进递增；side-effect action 执行前必须 fresh read。 */
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** 用户/T3 提交续工的输入（operationId 由调用方持有做幂等键）。 */
export interface ContinuationSubmitRequestV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly projectId: string
  readonly connectedConversationId?: string
  readonly mode: ContinuationModeV1
  readonly contextInheritance: ContinuationContextInheritanceV1
  readonly checkout: ContinuationCheckoutV1
  readonly provider: string
  /** 用户显式选择的有序引用（恢复发送时进入真实 context/manifest，不重建空上下文）。 */
  readonly orderedReferences?: readonly OrderedRunReferenceV2[]
}

/** 步骤推进输入（T7 adapter / recovery 流程写入）。 */
export interface ContinuationStepAdvanceRequestV1 {
  readonly step: ContinuationStepKindV1
  readonly outcome: 'pending' | 'confirmed' | 'failed' | 'outcome_unknown' | 'not_applicable'
  readonly externalEvidence?: ContinuationExternalEvidenceV1
  readonly errorEvidence?: string
  /** stale guard：若提供，必须等于当前 journal revision，否则拒绝（409）。 */
  readonly expectedRevision?: number
}

/** reconcile 输入：把 outcome_unknown 收敛（凭外部证据）。 */
export interface ContinuationReconcileRequestV1 {
  /** 收敛目标：confirmed=外部 session 确实存在 / 该步确认；failed=确认失败。不提供则保留 unknown。 */
  readonly externalConfirmed?: boolean
  readonly externalEvidence?: ContinuationExternalEvidenceV1
  readonly errorEvidence?: string
  /** stale guard：若提供，必须等于当前 journal revision，否则拒绝（409）。 */
  readonly expectedRevision?: number
}

/** target-specific allowedActions（T6 §2 统一 action envelope；不是全局万能枚举）。 */
export type ContinuationActionV1 =
  | 'recover_external'
  | 'recover_bind'
  | 'retry_attach'
  | 'retry_projection'
  | 'reconcile'
  | 'cancel_request'

/** 聚合 operation 状态（由四步原料推导，不持久化为独立列，避免双写）。 */
export type ContinuationOperationStatusV1 =
  | 'established'
  | 'external_creating'
  | 'binding'
  | 'attaching'
  | 'projecting'
  | 'projected'
  | 'recovering'
  | 'outcome_unknown'
  | 'cancelled'
  | 'resolved'

/** 面向 T3/T5 的只读投影：消费方只读这里，不按按钮文案/颜色/时间推断状态。 */
export interface ContinuationRecoveryProjectionV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly projectId: string
  readonly connectedConversationId: string | null
  readonly mode: ContinuationModeV1
  readonly contextInheritance: ContinuationContextInheritanceV1
  readonly checkout: ContinuationCheckoutV1
  readonly provider: string
  readonly status: ContinuationOperationStatusV1
  readonly steps: Readonly<Record<ContinuationStepKindV1, ContinuationStepStateV1>>
  readonly cancel: ContinuationCancelStateV1
  readonly externalEvidence?: ContinuationExternalEvidenceV1
  readonly errorEvidence?: string
  readonly revision: number
  readonly allowedActions: Readonly<{ action: ContinuationActionV1; requiresFreshRead: boolean; reason?: string }[]>
  readonly createdAt: string
  readonly updatedAt: string
}

/** 由 submit 输入构建首建 journal 行（external_create 由 T7 adapter 推进；submit 本身只记账 intent）。 */
export function createContinuationJournalRowV1(input: { operationId: string; projectId: string; connectedConversationId?: string; mode: ContinuationModeV1; contextInheritance: ContinuationContextInheritanceV1; checkout: ContinuationCheckoutV1; provider: string; orderedReferences?: readonly OrderedRunReferenceV2[] }, now: string): ContinuationOperationJournalRowV1 {
  return {
    schemaVersion: 1,
    operationId: input.operationId,
    projectId: input.projectId,
    connectedConversationId: input.connectedConversationId ?? null,
    mode: input.mode,
    contextInheritance: input.contextInheritance,
    checkout: input.checkout,
    provider: input.provider,
    steps: initialContinuationStepsV1(),
    cancel: 'none',
    ...(input.orderedReferences === undefined ? {} : { orderedReferences: input.orderedReferences }),
    revision: 0,
    createdAt: now,
    updatedAt: now,
  }
}
export function initialContinuationStepsV1(): Readonly<Record<ContinuationStepKindV1, ContinuationStepStateV1>> {
  return { external_create: 'not_started', core_bind: 'not_started', attach: 'not_started', projection: 'not_started' }
}

/** 聚合状态纯投影：从四步原料 + cancel 推导，无副作用。 */
export function projectContinuationOperationStatusV1(
  steps: Readonly<Record<ContinuationStepKindV1, ContinuationStepStateV1>>,
  cancel: ContinuationCancelStateV1,
): ContinuationOperationStatusV1 {
  if (cancel === 'confirmed') return 'cancelled'
  const values = Object.values(steps)
  if (values.every((value) => value === 'confirmed')) return 'projected'
  if (values.some((value) => value === 'outcome_unknown') || cancel === 'outcome_unknown') return 'outcome_unknown'
  if (values.some((value) => value === 'failed')) return 'recovering'
  if (cancel === 'requested') return 'recovering'
  // 线性步进前推：跳过已可靠结束（confirmed/not_applicable）的步骤，
  // 定位第一个未结束步骤：not_started = 尚未发起（established 只对应 external 未发起），pending = 进行中。
  if (!isStepReliable(steps.external_create)) return steps.external_create === 'not_started' ? 'established' : 'external_creating'
  if (!isStepReliable(steps.core_bind)) return 'binding'
  if (!isStepReliable(steps.attach)) return 'attaching'
  return 'projecting'
}

const STEP_ORDER: readonly ContinuationStepKindV1[] = ['external_create', 'core_bind', 'attach', 'projection']

function isStepReliable(state: ContinuationStepStateV1): boolean {
  return state === 'confirmed' || state === 'not_applicable'
}

/** 检查一个副作用 step 是否可恢复/可推进：该步前的门必须已可靠通过，该步自身未可靠完成。 */
function canRecoverStep(
  steps: Readonly<Record<ContinuationStepKindV1, ContinuationStepStateV1>>,
  step: ContinuationStepKindV1,
  requirePreviousConfirmed: 'confirmed' | boolean,
): boolean {
  const index = STEP_ORDER.indexOf(step)
  for (let i = 0; i < index; i += 1) {
    const prior = steps[STEP_ORDER[i]!]
    if (requirePreviousConfirmed === true && !isStepReliable(prior)) return false
    if (requirePreviousConfirmed === 'confirmed' && prior !== 'confirmed') return false
  }
  return !isStepReliable(steps[step])
}

/** allowedActions 纯推导：provider 能力（externalCreate）作为 capability 开关（T6 状态宇宙隔离）。 */
export function deriveContinuationAllowedActionsV1(
  row: { steps: Readonly<Record<ContinuationStepKindV1, ContinuationStepStateV1>>; cancel: ContinuationCancelStateV1; status: ContinuationOperationStatusV1 },
  capabilities: { readonly externalCreate: boolean },
): ContinuationRecoveryProjectionV1['allowedActions'] {
  const cancel = row.cancel
  const status = row.status
  const steps = row.steps
  const actions: NonNullable<ContinuationRecoveryProjectionV1['allowedActions'][number]>[] = []
  const finished = status === 'projected' || status === 'cancelled' || status === 'resolved'

  const push = (action: ContinuationActionV1, requiresFreshRead: boolean, reason?: string): void => {
    actions.push({ action, requiresFreshRead, ...(reason === undefined ? {} : { reason }) })
  }

  if (finished) return actions

  // cancel 意图已记账或外部终态未知：只允许 reconcile（不再推进步骤，不重复 create 之外的副作用动作）。
  if (cancel === 'requested' || cancel === 'outcome_unknown') {
    actions.push({ action: 'reconcile', requiresFreshRead: true })
    return actions
  }

  // 外部 create 尚未发起（首次 create）或明确失败（无未决外部副作用）才允许 recover_external。
  // pending=进行中、outcome_unknown=结果未知时禁止（未确认结果不得自动重试 create，只能 reconcile）。
  if ((steps.external_create === 'not_started' || steps.external_create === 'failed') && capabilities.externalCreate) {
    push('recover_external', true)
  }
  // external confirmed → bind 可恢复。
  const externalReady = steps.external_create === 'confirmed' || steps.external_create === 'not_applicable'
  if (externalReady && canRecoverStep(steps, 'core_bind', 'confirmed')) push('recover_bind', true, steps.core_bind === 'failed' ? 'bind 失败，重试绑定同一外部 session' : undefined)
  // bind confirmed → attach 可恢复。
  if (steps.core_bind === 'confirmed' && canRecoverStep(steps, 'attach', true)) push('retry_attach', true)
  // attach confirmed → projection 可恢复。
  if (steps.attach === 'confirmed' && canRecoverStep(steps, 'projection', true)) push('retry_projection', true)

  // 任何步骤 outcome_unknown → 只允许 reconcile（不直接 retry 副作用动作）。
  // （cancel === 'outcome_unknown' 已在上方早返回。）
  if (Object.values(steps).includes('outcome_unknown')) {
    push('reconcile', true)
  }
  // cancel 尚未记账且未收敛 → 允许发起 cancel intent。
  if (cancel === 'none' && status !== 'established') {
    push('cancel_request', true)
  }
  return actions
}

/** 由 journal 行生成只读投影。 */
export function projectContinuationRecoveryV1(
  row: ContinuationOperationJournalRowV1,
  capabilities: { readonly externalCreate: boolean },
): ContinuationRecoveryProjectionV1 {
  const status = projectContinuationOperationStatusV1(row.steps, row.cancel)
  const allowedActions = deriveContinuationAllowedActionsV1({ steps: row.steps, cancel: row.cancel, status }, capabilities)
  return {
    schemaVersion: 1,
    operationId: row.operationId,
    projectId: row.projectId,
    connectedConversationId: row.connectedConversationId,
    mode: row.mode,
    contextInheritance: row.contextInheritance,
    checkout: row.checkout,
    provider: row.provider,
    status,
    steps: row.steps,
    cancel: row.cancel,
    ...(row.externalEvidence === undefined ? {} : { externalEvidence: row.externalEvidence }),
    ...(row.errorEvidence === undefined ? {} : { errorEvidence: row.errorEvidence }),
    revision: row.revision,
    allowedActions,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export type { ConnectedConversationV1 }