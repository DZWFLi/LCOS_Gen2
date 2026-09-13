/**
 * Sprint 1B（T7）：Provider Continuation Capability Snapshot —— field-level 能力快照。
 *
 * 规则（T7 V2 §6）：
 * - `unknown` 是默认值，不是失败的替身；`false` 只能在 exact probe 证明该
 *   adapter / provider revision 不支持后写入，不得按 Codex/Huabu/Agenetes 品牌猜。
 * - 每个 capability field 必须带 evidence source / observedAt / limitation。
 * - snapshot 是可再生 evidence（可缓存、可重探测），不是 Core truth。
 * - nativeFullHistoryFork / attachContext / isolatedWorktree / resolver 在权威
 *   probe 补齐前固定 `unknown`；Agenetes fork 不是 native full-history fork。
 */

/** 能力值：unknown 是默认。 */
export type CapabilityValueV1 = true | false | 'unknown'

/** 证据来源：禁止用"看起来支持"冒充 probe 结果。 */
export type CapabilityEvidenceSourceV1 =
  | 'acp_initialize'
  | 'session_profile'
  | 'gateway_probe'
  | 'protocol_inspection'
  | 'provider_probe'
  | 'adapter_declaration'

/** 单个能力字段的证据声明。 */
export interface CapabilityClaimV1 {
  readonly value: CapabilityValueV1
  readonly source: CapabilityEvidenceSourceV1
  readonly observedAt: string
  /** 对应 receipt / probe / donor artifact 的可追溯引用（非空泛文档名）。 */
  readonly evidenceRef?: string
  readonly limitation?: string
}

/** 首批 provider 集合；未来 provider 以新字面量加入，不扩大为万能字符串。 */
export type ContinuationProviderIdV1 = 'huabu-agentlet' | 'codex' | 'workbuddy'

/** field-level 能力快照（T7 V2 §6.1）。 */
export interface ProviderContinuationCapabilitySnapshotV1 {
  readonly schemaVersion: 1
  readonly provider: ContinuationProviderIdV1
  readonly adapterId: string
  readonly observedAt: string
  readonly probeId: string
  readonly session: {
    readonly createSession: CapabilityClaimV1
    readonly continueExisting: CapabilityClaimV1
    readonly nativeFullHistoryFork: CapabilityClaimV1
    readonly attachContext: CapabilityClaimV1
    readonly send: CapabilityClaimV1
    readonly status: CapabilityClaimV1
    readonly cancel: CapabilityClaimV1
    readonly recoverExisting: CapabilityClaimV1
  }
  readonly checkout: {
    readonly sharedCheckout: CapabilityClaimV1
    readonly isolatedWorktree: CapabilityClaimV1
    readonly resolver: CapabilityClaimV1
  }
  readonly limitations: readonly string[]
}

/** 未探测字段的默认 unknown claim（带 source 与 limitation）。 */
export function unknownCapabilityClaimV1(
  source: CapabilityEvidenceSourceV1,
  observedAt: string,
  limitation: string,
): CapabilityClaimV1 {
  return { value: 'unknown', source, observedAt, limitation }
}

/** 从探测结果构造确定值 claim。 */
export function claimV1(
  value: Exclude<CapabilityValueV1, 'unknown'>,
  source: CapabilityEvidenceSourceV1,
  observedAt: string,
  options: { readonly evidenceRef?: string; readonly limitation?: string } = {},
): CapabilityClaimV1 {
  return { value, source, observedAt, ...(options.evidenceRef === undefined ? {} : { evidenceRef: options.evidenceRef }), ...(options.limitation === undefined ? {} : { limitation: options.limitation }) }
}

/**
 * 缓存 key：provider + adapterId + providerRevisionOrProfileFingerprint。
 * 没有 revision 时退化为 adapterId + probe 指纹（T7 V2 §6.3）。
 */
export function providerCapabilityCacheKeyV1(
  provider: ContinuationProviderIdV1,
  adapterId: string,
  providerRevisionOrProfileFingerprint?: string,
): string {
  return providerRevisionOrProfileFingerprint === undefined
    ? `continuation-capability:${provider}:${adapterId}`
    : `continuation-capability:${provider}:${adapterId}:${providerRevisionOrProfileFingerprint}`
}
