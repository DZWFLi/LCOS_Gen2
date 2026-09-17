/**
 * Collaboration Contract V1 —— Gen2 所有 AI 协作 UX 的唯一 UI-facing 契约（Gate 1 冻结件）。
 *
 * 来源：《Collaboration Runtime × Glyth UX 收敛总施工方案 V1_20260917》§5–§10 / §21 / §22，
 * 在 V0 facade（apps/web-gen2/src/backend/collaboration.ts，commit 25f97a2）验证 PASS 后正式落线。
 *
 * 冻结纪律：
 * - 本文件只做产品投影与产品动作语义；Core / Run / Continuation / Provider 仍是各自 truth owner。
 * - 不新增第二 Session SoT；projection 只读聚合，可重建、可废弃。
 * - capability 诚实：false = 按钮不出现或 disabled + 原因；禁止 UI 猜测，禁止 fake fallback
 *   （canSend=false 时不得暗中 createRun）。
 * - provider / externalSessionId / RuntimeDispatch 不进入本产品投影；工程细节只去 Diagnostics。
 * - 产品错误回答「用户现在能做什么」；工程错误回答「为什么底层失败」，两者不混在一个 badge。
 *
 * 既有地基（复用，不复制）：
 * - provider-capability.ts：ProviderContinuationCapabilitySnapshotV1（field-level 原始探测，
 *   unknown≠false≠true；Capability Resolver 在 Core 侧把它折算为本文件的产品 capability）。
 * - conversation-identity.ts：ConversationIdentityChainV1 / ActiveReceiverIdentityV1
 *   （conversation 身份解析链；本契约的 conversationId 即 ConnectedConversation 身份）。
 */

// ---------------------------------------------------------------------------
// 用户态：所有 provider / run / session 内部状态只投影到这 6 个（方案 §7）。
// 后台状态（queued/running/waiting_input/review/...）负责算出用户态，不负责画信息架构。
// ---------------------------------------------------------------------------

export type CollaborationUserStateV1 =
  | 'ready'        // 可以继续
  | 'thinking'     // 正在理解 / 整理
  | 'working'      // 正在做事
  | 'needs_user'   // 等你回答 / 审批
  | 'done'         // 本轮做完
  | 'unavailable'  // 原协作暂时接不上

// ---------------------------------------------------------------------------
// 产品 capability（方案 §6）：UI 唯一按钮依据。
// 原始探测证据留在 ProviderContinuationCapabilitySnapshotV1（diagnostics 层）；
// 未探测 / unknown 在折算进本结构时必须按不可用处理（fail-closed，见 §11.4）。
// ---------------------------------------------------------------------------

export interface CollaborationCapabilitiesV1 {
  readonly canSend: boolean
  readonly canDelegate: boolean
  readonly canResume: boolean
  readonly canFork: boolean
  readonly canHandoff: boolean
  readonly canAnswerInput: boolean
  readonly canApprove: boolean
  readonly canCancel: boolean
  readonly canRecover: boolean
  readonly canOpenDiagnostics: boolean
}

/** capability=false 时给用户的可读原因；缺原因 = 冻结违规。 */
export type CollaborationCapabilityReasonsV1 = Partial<
  Record<keyof CollaborationCapabilitiesV1, string>
>

/** fail-closed 默认值：首探成功前，一切动作不可用。 */
export function unavailableCollaborationCapabilitiesV1(
  reason: string,
): { readonly capabilities: CollaborationCapabilitiesV1; readonly capabilityReasons: CollaborationCapabilityReasonsV1 } {
  return {
    capabilities: {
      canSend: false,
      canDelegate: false,
      canResume: false,
      canFork: false,
      canHandoff: false,
      canAnswerInput: false,
      canApprove: false,
      canCancel: false,
      canRecover: false,
      canOpenDiagnostics: true, // 诊断永远允许打开——它是理解「为什么不可用」的入口
    },
    capabilityReasons: {
      canSend: reason,
      canDelegate: reason,
      canResume: reason,
      canFork: reason,
      canHandoff: reason,
      canAnswerInput: reason,
      canApprove: reason,
      canCancel: reason,
      canRecover: reason,
    },
  }
}

// ---------------------------------------------------------------------------
// Artifact Return 摘要（recentReturns）：产品层只需要「回来了什么、待不待处理」。
// ---------------------------------------------------------------------------

export interface CollaborationReturnSummaryV1 {
  readonly returnId: string
  readonly artifactId?: string
  readonly title: string
  readonly status: 'pending_review' | 'accepted' | 'rejected'
  readonly returnedAt: string
}

// ---------------------------------------------------------------------------
// Session 产品投影（方案 §5.1）：Glyth / Work View / Composer 状态的唯一来源。
// ---------------------------------------------------------------------------

export interface CollaborationSessionProjectionV1 {
  readonly schemaVersion: 1

  readonly projectId: string
  /** 绑定的画布 Glyth；未绑定 = undefined（诚实缺席，不伪造）。 */
  readonly glythId?: string
  readonly conversationId: string

  readonly identity: {
    readonly title: string
    readonly subtitle?: string
    /** 面向用户的协作者称呼；不得是 provider 枚举名。 */
    readonly agentLabel?: string
  }

  readonly userState: CollaborationUserStateV1

  readonly relation: {
    readonly workspaceId?: string
    /** 当前会话持有的对象引用（R1 canonical target / selected-context 的消费口）。 */
    readonly targetRefs: readonly string[]
    readonly summary?: string
  }

  readonly activity: {
    readonly lastActivityAt?: string
    readonly activeRunId?: string
    readonly activeSummary?: string
    readonly pendingInputId?: string
  }

  readonly capabilities: CollaborationCapabilitiesV1
  readonly capabilityReasons?: CollaborationCapabilityReasonsV1

  readonly recentReturns: readonly CollaborationReturnSummaryV1[]

  readonly recovery?: {
    readonly state: 'none' | 'recoverable' | 'recovering' | 'blocked'
    /** 给用户看的一句话；工程细节（STALE_REVISION 等）不进这里。 */
    readonly userMessage?: string
  }
}

// ---------------------------------------------------------------------------
// Timeline Item（方案 §8）：只做 projection，不新建 persisted Turn 表。
// 由 Conversation message + Run + waiting_input + Artifact Return + Continuation
// + provider event 组合投影；未来多 provider 确需稳定 Turn identity 时再晋升 canonical。
// ---------------------------------------------------------------------------

export type CollaborationTimelineItemKindV1 =
  | 'user_message'
  | 'agent_message'
  | 'work_started'
  | 'progress'
  | 'input_required'
  | 'approval_required'
  | 'result_returned'
  | 'result_adopted'
  | 'error'
  | 'recovered'
  | 'system_note'

export interface CollaborationTimelineItemV1 {
  readonly schemaVersion: 1
  /** projection 内稳定 id（可由来源 id 派生，如 run:<id> / return:<id>）。 */
  readonly itemId: string
  readonly kind: CollaborationTimelineItemKindV1
  readonly occurredAt: string
  readonly title: string
  readonly body?: string
  /** 回链 truth 的引用；UI 不得凭 item 再造状态。 */
  readonly refs?: {
    readonly runId?: string
    readonly returnId?: string
    readonly continuationOperationId?: string
    readonly messageId?: string
  }
}

// ---------------------------------------------------------------------------
// 产品错误模型（方案 §21）：UI 只接这 8 种；transport 细节留在 diagnostics。
// ---------------------------------------------------------------------------

export type CollaborationProductErrorCodeV1 =
  | 'unavailable'          // 能力不存在 / 协作对象接不上
  | 'needs_recovery'       // 需要先恢复
  | 'permission_required'  // 需要用户审批
  | 'input_required'       // 需要用户回答
  | 'provider_offline'     // provider 离线
  | 'operation_unknown'    // 已发出但结果未知（timeout 诚实态，禁止自动重试）
  | 'operation_failed'     // 明确失败
  | 'cancelled'            // 已取消

export interface CollaborationProductErrorV1 {
  readonly schemaVersion: 1
  readonly code: CollaborationProductErrorCodeV1
  /** 回答「用户现在能做什么」。 */
  readonly userMessage: string
  /** 工程原因的可追溯引用（diagnostics 条目 / receipt id）；不是给用户看的文案。 */
  readonly diagnosticsRef?: string
  readonly retryable: boolean
}

export function collaborationProductErrorV1(
  code: CollaborationProductErrorCodeV1,
  userMessage: string,
  options: { readonly diagnosticsRef?: string; readonly retryable?: boolean } = {},
): CollaborationProductErrorV1 {
  return {
    schemaVersion: 1,
    code,
    userMessage,
    retryable: options.retryable ?? false,
    ...(options.diagnosticsRef === undefined ? {} : { diagnosticsRef: options.diagnosticsRef }),
  }
}

// ---------------------------------------------------------------------------
// Commands V1（方案 §9/§10）：UI 只面对这组产品动作。
// send 与 delegate 永远不能混：
//   send     = 对当前 Conversation 再说一句；canSend=false 时返回 unavailable，禁止 fallback 到 Run。
//   delegate = 创建 canonical Run（V0 已验证可安全包装 createRun）。
// ---------------------------------------------------------------------------

export type CollaborationCommandKindV1 =
  | 'send'
  | 'delegate'
  | 'resume'
  | 'fork'
  | 'handoff'
  | 'answerInput'
  | 'approve'
  | 'cancel'
  | 'recover'

export interface CollaborationSendInputV1 {
  readonly conversationId: string
  readonly text: string
  readonly targetRefs?: readonly string[]
}

export interface CollaborationDelegateInputV1 {
  readonly projectId: string
  readonly instruction: string
  readonly targetRefs?: readonly string[]
  /** 承接会话绑定（对应 CreateRunInputV1.receiverRef.connectedConversationId）。 */
  readonly receiverConversationId?: string
}

export interface CollaborationResumeInputV1 {
  readonly conversationId: string
}

export interface CollaborationForkInputV1 {
  readonly conversationId: string
}

export interface CollaborationHandoffInputV1 {
  readonly conversationId: string
  readonly note?: string
}

export interface CollaborationAnswerInputV1 {
  readonly pendingInputId: string
  readonly answer: string
}

export interface CollaborationApproveInputV1 {
  readonly returnId: string
  readonly decision: 'accept' | 'reject'
  readonly note?: string
}

export interface CollaborationCancelInputV1 {
  readonly runId: string
}

export interface CollaborationRecoverInputV1 {
  readonly continuationOperationId: string
}

/** 按 kind 分发输入类型。 */
export type CollaborationCommandInputV1 =
  | { readonly kind: 'send'; readonly input: CollaborationSendInputV1 }
  | { readonly kind: 'delegate'; readonly input: CollaborationDelegateInputV1 }
  | { readonly kind: 'resume'; readonly input: CollaborationResumeInputV1 }
  | { readonly kind: 'fork'; readonly input: CollaborationForkInputV1 }
  | { readonly kind: 'handoff'; readonly input: CollaborationHandoffInputV1 }
  | { readonly kind: 'answerInput'; readonly input: CollaborationAnswerInputV1 }
  | { readonly kind: 'approve'; readonly input: CollaborationApproveInputV1 }
  | { readonly kind: 'cancel'; readonly input: CollaborationCancelInputV1 }
  | { readonly kind: 'recover'; readonly input: CollaborationRecoverInputV1 }

/** 真实回执：每个 action 必须有；无 receipt 不得报成功。 */
export interface CollaborationReceiptV1 {
  readonly schemaVersion: 1
  readonly command: CollaborationCommandKindV1
  readonly acceptedAt: string
  readonly runId?: string
  readonly returnId?: string
  readonly continuationOperationId?: string
  readonly conversationId?: string
}

export type CollaborationCommandResultV1 =
  | { readonly ok: true; readonly receipt: CollaborationReceiptV1 }
  | { readonly ok: false; readonly error: CollaborationProductErrorV1 }

// ---------------------------------------------------------------------------
// Adapter capability model（Gate 1 冻结件之一）：
// adapter 只上报「探测快照 + 身份」；折算成产品 capability 是 Core Capability Resolver 的活。
// ---------------------------------------------------------------------------

import type {
  ContinuationProviderIdV1,
  ProviderContinuationCapabilitySnapshotV1,
} from './provider-capability.js'

export interface CollaborationAdapterDescriptorV1 {
  readonly schemaVersion: 1
  readonly provider: ContinuationProviderIdV1
  readonly adapterId: string
  /** 未探测 = undefined；UI 侧此时全部 fail-closed。 */
  readonly capabilitySnapshot?: ProviderContinuationCapabilitySnapshotV1
}

// ---------------------------------------------------------------------------
// 订阅事件（方案 §22）：UI 只见这三类；内部 continuity.changed / run.updated /
// artifact_return.created / provider.status 由 projection 吸收，不为 Collaboration
// 再建第二个 Event Bus。
// ---------------------------------------------------------------------------

export type CollaborationSessionEventKindV1 =
  | 'session.changed'
  | 'timeline.appended'
  | 'capability.changed'

export interface CollaborationSessionEventV1 {
  readonly schemaVersion: 1
  readonly kind: CollaborationSessionEventKindV1
  readonly projectId: string
  readonly conversationId: string
  readonly occurredAt: string
}