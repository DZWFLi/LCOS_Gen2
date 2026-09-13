/**
 * Sprint 1B（T7）：Continuation Provider Adapter port + 统一 provider receipt。
 *
 * 唯一规则（T7 V2 §5.1）：T7 只被 T6 `ConversationContinuationService` 调用；
 * RuntimeAdapterService、Canvas、Command UI、Bridge generic /v1/tasks、
 * Agenetes fork() 都不能绕过这个 seam 直接调 T7。
 *
 * T7 返回 receipt，T6 决定如何写 journal / Core bind / read model。
 * receipt 的 outcome_unknown / unresolved 属于 continuation operation evidence，
 * 不新增第二套 RunStatus（T7 V2 §10.1）。
 */

import type { ContinuityAttachBundleV1 } from './continuity.js'
import type {
  ContinuationProviderIdV1,
  ProviderContinuationCapabilitySnapshotV1,
} from './provider-capability.js'

/** provider capability probe 输入。 */
export interface CapabilityProbeInputV1 {
  readonly provider: ContinuationProviderIdV1
  readonly adapterId: string
  readonly probeId: string
  readonly providerRevisionOrProfileFingerprint?: string
  /** true = 跳过缓存强制重探测；false/缺省 = 允许命中可再生的缓存快照。 */
  readonly force?: boolean
  readonly observedAt?: string
}

/** create：one_shot / long-lived / selected_context / blank 的 create variant。 */
export type ContinuationCreateVariantV1 = 'one_shot' | 'long_lived' | 'selected_context' | 'blank'

export interface CreateSessionInputV1 {
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly agentletId?: string
  readonly createVariant: ContinuationCreateVariantV1
  readonly bundle: ContinuityAttachBundleV1
}

export interface ContinueExistingInputV1 {
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly agentletId?: string
  readonly externalSessionId: string
  readonly bundle: ContinuityAttachBundleV1
}

/** native full-history fork：只有 provider 明示 native fork API 并回执 native identity 后才允许调用。 */
export interface NativeForkInputV1 {
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly agentletId?: string
  readonly sourceExternalSessionId: string
  readonly bundle: ContinuityAttachBundleV1
}

export interface AttachContextInputV1 {
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly agentletId?: string
  readonly externalSessionId: string
  readonly bundle: ContinuityAttachBundleV1
}

/** send payload：prompt 或 resource；contextAttachRequested 仅当 request 明示允许 first-send degrade 时使用。 */
export interface ProviderSendPayloadV1 {
  readonly kind: 'prompt' | 'resource'
  readonly text?: string
  readonly resourceRef?: string
  readonly contextAttachRequested?: boolean
}

export interface SendInputV1 {
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly agentletId?: string
  readonly externalSessionId: string
  readonly payload: ProviderSendPayloadV1
}

export interface StatusInputV1 {
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly agentletId?: string
  readonly externalSessionId?: string
}

export interface CancelInputV1 {
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly agentletId?: string
  readonly externalSessionId?: string
}

/** recoverExisting：凭 identity hints 定位同一外部 session，lookup miss 固定 unresolved，绝不隐式 create。 */
export interface RecoverExistingInputV1 {
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly agentletId?: string
  readonly externalSessionId?: string
  readonly identityHints: readonly string[]
  readonly bundle?: ContinuityAttachBundleV1
}

/** 统一 receipt 的动作集合。 */
export type ProviderContinuationActionKindV1 =
  | 'create'
  | 'continue_existing'
  | 'native_full_fork'
  | 'attach_context'
  | 'send'
  | 'status'
  | 'cancel'
  | 'recover_existing'

/** 统一 receipt 的结果集合：outcome_unknown / unresolved 是诚实状态，不是失败替身。 */
export type ProviderContinuationOutcomeV1 =
  | 'accepted'
  | 'external_created'
  | 'resumed'
  | 'sent'
  | 'attached'
  | 'recovered'
  | 'unsupported'
  | 'failed'
  | 'outcome_unknown'
  | 'unresolved'

export interface ProviderContinuationErrorV1 {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly outcomeUnknown: boolean
}

/** T7 统一 receipt（T7 V2 §7.2 最小字段）。 */
export interface ProviderContinuationOperationResultV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly correlationId: string
  readonly provider: string
  readonly adapterId: string
  readonly action: ProviderContinuationActionKindV1
  readonly outcome: ProviderContinuationOutcomeV1
  /** 只有 adapter 证明 provider-native identity 后才能填写；ACP/relay session 只放 transportSessionId。 */
  readonly externalSessionId?: string
  readonly transportSessionId?: string
  readonly agentletId?: string
  readonly threadId?: string
  readonly pid?: number
  readonly cwd?: string
  readonly contextAttached: boolean
  readonly nativeFork: boolean
  readonly degradedFromNativeFork: boolean
  /** none=无需重试；reconcile=先查证；resume_existing=只续接不新建；cancel_unknown=外部 cancel 终态未知。 */
  readonly retryAction: 'none' | 'reconcile' | 'resume_existing' | 'cancel_unknown'
  readonly error?: ProviderContinuationErrorV1
  readonly probeId?: string
  readonly observedAt: string
}

/** 唯一允许 T6 调用的最小 adapter surface（T7 V2 §7）。 */
export interface ContinuationProviderAdapterV1 {
  readonly adapterId: string
  readonly provider: ContinuationProviderIdV1
  probe(input: CapabilityProbeInputV1): Promise<ProviderContinuationCapabilitySnapshotV1>
  createSession(input: CreateSessionInputV1): Promise<ProviderContinuationOperationResultV1>
  continueExisting(input: ContinueExistingInputV1): Promise<ProviderContinuationOperationResultV1>
  nativeFork(input: NativeForkInputV1): Promise<ProviderContinuationOperationResultV1>
  attachContext(input: AttachContextInputV1): Promise<ProviderContinuationOperationResultV1>
  send(input: SendInputV1): Promise<ProviderContinuationOperationResultV1>
  status(input: StatusInputV1): Promise<ProviderContinuationOperationResultV1>
  cancel(input: CancelInputV1): Promise<ProviderContinuationOperationResultV1>
  recoverExisting(input: RecoverExistingInputV1): Promise<ProviderContinuationOperationResultV1>
}

/**
 * 由 T7 receipt 构建 T6 journal 的 external evidence（Sprint 1A 的
 * ContinuationExternalEvidenceV1 消费者映射；cross-module seam 唯一转换点）。
 */
export function continuationExternalEvidenceFromReceiptV1(receipt: {
  readonly provider: string
  readonly externalSessionId?: string
  readonly correlationId: string
  readonly observedAt: string
  readonly transportSessionId?: string
}): { readonly schemaVersion: 1; readonly provider: string; readonly externalSessionId: string; readonly correlationId: string; readonly createdAt: string; readonly raw?: { readonly kind: 'provider_receipt'; readonly ref: string } } | undefined {
  if (receipt.externalSessionId === undefined) return undefined
  return {
    schemaVersion: 1,
    provider: receipt.provider,
    externalSessionId: receipt.externalSessionId,
    correlationId: receipt.correlationId,
    createdAt: receipt.observedAt,
    ...(receipt.transportSessionId === undefined ? {} : { raw: { kind: 'provider_receipt' as const, ref: `transport:${receipt.transportSessionId}` } }),
  }
}

/** 结果是否可自动 retry（副作用安全）。create/recover 的 outcome_unknown 永远不能自动 retry。 */
export function isProviderOutcomeAutoRetryableV1(outcome: ProviderContinuationOutcomeV1): boolean {
  if (outcome === 'outcome_unknown' || outcome === 'unresolved' || outcome === 'accepted') return false
  return outcome === 'failed' || outcome === 'unsupported'
}
