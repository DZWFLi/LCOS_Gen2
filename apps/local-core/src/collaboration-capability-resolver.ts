/**
 * Collaboration Capability Resolver（收敛方案 V1 Gate 1/§11.3）。
 *
 * 把原料事实折算成 Collaboration Contract V1 的产品 capability：
 * - ProviderContinuationCapabilitySnapshotV1（T7 field-level 探测，unknown≠false≠true）
 * - Run / waiting_input / Artifact Return / Continuation journal 的当前状态
 * - Handoff owner（ReceiverRuntimeService.prepareHandoff）是否存在
 *
 * 纪律：
 * - unknown / 未探测 → 产品层 false + 人话原因（fail-closed），绝不按 provider 品牌猜。
 * - canDelegate 恒 true：canonical POST /projects/:pid/runs 是既有 truth（V0 已验证）。
 * - send 没有真实 transport 前永远 false；禁止 UI fallback 到 createRun。
 */

import type {
  CollaborationCapabilitiesV1,
  CollaborationCapabilityReasonsV1,
  CollaborationUserStateV1,
  ContinuationRecoveryProjectionV1,
  ProviderContinuationCapabilitySnapshotV1,
  RunReview,
} from '@local-creative-os/contracts'
import type { ArtifactReturn, RunStatus } from '@local-creative-os/domain'

export interface CollaborationCapabilityFacts {
  /** 该会话最近一次 Run 的复核视图（含 inputRequest / returns / accept 能力）。 */
  readonly activeRunReview?: RunReview
  /** 该会话全部 pending_review 回传（跨最近 Runs 聚合）。 */
  readonly pendingReturns: readonly ArtifactReturn[]
  /** 该会话的 continuation journal 投影。 */
  readonly continuationOps: readonly ContinuationRecoveryProjectionV1[]
  /** Huabu Host 探测快照；未接线/未探测 = undefined。 */
  readonly capabilitySnapshot?: ProviderContinuationCapabilitySnapshotV1
  /** ReceiverRuntimeService.prepareHandoff 可用（真实 owner 存在）。 */
  readonly handoffOwnerAvailable: boolean
}

export interface ResolvedCollaborationCapabilitiesV1 {
  readonly capabilities: CollaborationCapabilitiesV1
  readonly capabilityReasons: CollaborationCapabilityReasonsV1
}

function probeReason(
  snapshot: ProviderContinuationCapabilitySnapshotV1 | undefined,
  field: 'send' | 'continueExisting' | 'nativeFullHistoryFork',
  label: string,
): string {
  if (snapshot === undefined) return `${label}未完成能力探测，暂时不可用`
  const claim = snapshot.session[field]
  if (claim.value === 'unknown') return claim.limitation ?? `${label}能力未确认（探测结果未知）`
  return claim.limitation ?? `${label}不被当前协作方式支持`
}

export function resolveCollaborationCapabilitiesV1(
  facts: CollaborationCapabilityFacts,
): ResolvedCollaborationCapabilitiesV1 {
  const snapshot = facts.capabilitySnapshot
  const activeRun = facts.activeRunReview?.run
  const activeStatus: RunStatus | undefined = activeRun?.status
  const hasPendingInput =
    facts.activeRunReview?.inputRequest !== undefined &&
    facts.activeRunReview.inputRequest.status === 'pending'
  const hasPendingReview = facts.pendingReturns.length > 0
  const canRecover = facts.continuationOps.some((op) => op.allowedActions.length > 0)

  const canSend = snapshot?.session.send.value === true
  const canResume = snapshot?.session.continueExisting.value === true
  const canFork = snapshot?.session.nativeFullHistoryFork.value === true
  const canAnswerInput = hasPendingInput
  const canApprove = hasPendingReview
  const canCancel =
    activeStatus === 'created' ||
    activeStatus === 'queued' ||
    activeStatus === 'running' ||
    activeStatus === 'waiting_input'

  const capabilities: CollaborationCapabilitiesV1 = {
    canSend,
    canDelegate: true,
    canResume,
    canFork,
    canHandoff: facts.handoffOwnerAvailable,
    canAnswerInput,
    canApprove,
    canCancel,
    canRecover,
    canOpenDiagnostics: true,
  }

  const capabilityReasons: CollaborationCapabilityReasonsV1 = {}
  if (!canSend) capabilityReasons.canSend = probeReason(snapshot, 'send', '「发送」')
  if (!canResume) capabilityReasons.canResume = probeReason(snapshot, 'continueExisting', '「继续原会话」')
  if (!canFork) capabilityReasons.canFork = probeReason(snapshot, 'nativeFullHistoryFork', '「分叉」')
  if (!facts.handoffOwnerAvailable) capabilityReasons.canHandoff = '交接 owner 未配置'
  if (!canAnswerInput) capabilityReasons.canAnswerInput = '当前没有等待回答的问题'
  if (!canApprove) capabilityReasons.canApprove = '当前没有待复核的产出'
  if (!canCancel) capabilityReasons.canCancel = '当前没有进行中的任务'
  if (!canRecover) capabilityReasons.canRecover = '当前没有可恢复的续工操作'

  return { capabilities, capabilityReasons }
}

// ---------------------------------------------------------------------------
// 用户态推导（方案 §7 + R5 规范 §5.1 映射表）：后台状态只负责算出用户态。
// ---------------------------------------------------------------------------

export interface CollaborationUserStateFacts {
  readonly activeRunStatus?: RunStatus
  readonly hasPendingInput: boolean
  readonly hasPendingReview: boolean
  readonly recovery: 'none' | 'recoverable' | 'recovering' | 'blocked'
}

export function deriveCollaborationUserStateV1(
  facts: CollaborationUserStateFacts,
): CollaborationUserStateV1 {
  // 用户可行动优先：有待答/待复核永远先亮 needs_user。
  if (facts.hasPendingInput || facts.hasPendingReview) return 'needs_user'
  if (facts.recovery === 'blocked') return 'unavailable'
  if (facts.activeRunStatus === 'created' || facts.activeRunStatus === 'queued') return 'thinking'
  if (facts.activeRunStatus === 'running') return 'working'
  if (facts.activeRunStatus === 'waiting_input') return 'needs_user'
  if (facts.recovery === 'recovering') return 'working'
  if (facts.activeRunStatus === 'completed') return 'done'
  // failed / cancelled / 无 Run：会话本身可继续；失败细节由 timeline/recovery 承载。
  return 'ready'
}

/** 从 continuation journal 推导产品级 recovery 状态。 */
export function deriveCollaborationRecoveryV1(
  ops: readonly ContinuationRecoveryProjectionV1[],
): { readonly state: 'none' | 'recoverable' | 'recovering' | 'blocked'; readonly userMessage?: string } {
  if (ops.some((op) => op.status === 'recovering')) {
    return { state: 'recovering', userMessage: '正在恢复上次的协作' }
  }
  const unknown = ops.filter((op) => op.status === 'outcome_unknown')
  if (unknown.length > 0) {
    return unknown.some((op) => op.allowedActions.length > 0)
      ? { state: 'recoverable', userMessage: '上次操作结果未知，可以重试或恢复' }
      : { state: 'blocked', userMessage: '上次操作结果未知且暂时无法自动恢复' }
  }
  return { state: 'none' }
}