import type {
  AttachContextInputV1,
  CancelInputV1,
  CapabilityClaimV1,
  CapabilityProbeInputV1,
  ContinueExistingInputV1,
  ContinuationProviderAdapterV1,
  CreateSessionInputV1,
  NativeForkInputV1,
  ProviderContinuationCapabilitySnapshotV1,
  ProviderContinuationErrorV1,
  ProviderContinuationOperationResultV1,
  RecoverExistingInputV1,
  SendInputV1,
  StatusInputV1,
} from '@local-creative-os/contracts'
import { unknownCapabilityClaimV1, type CapabilityEvidenceSourceV1 } from '@local-creative-os/contracts'

/**
 * Sprint 1B（T7）：Huabu Agentlet continuation adapter。
 *
 * 职责边界（T7 V2 §5）：只做 donor mapping / probe / unknown-error 分类，
 * 不拥有 Run/Conversation/Canvas/lineage/Core journal。唯一生产 caller 是
 * T6 ConversationContinuationService；本文件不注册到任何 generic provider platform。
 *
 * transport seam 镜像 Huabu AgentletGateway / ACP donor 的最小方法面
 * （gateway.ts spawnOnAgentlet/stopOnAgentlet/listOnAgentlet/getSession/sendResource），
 * 真实 donor 进程 E2E 为外部 GAP；Fake transport 用于可重复故障验证。
 */

/** transport seam：镜像 donor gateway 的最小方法面（Fake 可替换）。 */
export interface HuabuAgentletSessionInfoV1 {
  readonly sessionId: string
  readonly appId?: string
  readonly pid?: number
  readonly cwd?: string
  readonly status: string
}

export interface HuabuAgentletTransportV1 {
  readonly kind: string
  /** spawn（sessionId 缺省）或 resume/load（sessionId 提供时，resume 优先、load fallback）。 */
  spawn(params: { readonly agentletId: string; readonly appId: string; readonly sessionId?: string }): Promise<{ readonly sessionId: string; readonly pid: number; readonly cwd?: string; readonly loaded?: boolean }>
  stop(params: { readonly agentletId: string; readonly sessionId: string }): Promise<{ readonly stopped: boolean }>
  list(agentletId: string): Promise<{ readonly agents: readonly HuabuAgentletSessionInfoV1[] }>
  getSession(agentletId: string, sessionId: string): Promise<HuabuAgentletSessionInfoV1 | undefined>
  sendResource(params: { readonly agentletId: string; readonly sessionId: string; readonly text?: string; readonly resourceRef?: string }): Promise<void>
  /** 真实 donor probe；未知字段不得猜 true。 */
  probe(): Promise<{ readonly session: Readonly<Partial<Record<'createSession' | 'continueExisting' | 'send' | 'status' | 'cancel' | 'recoverExisting', CapabilityClaimV1>>>; readonly limitations?: readonly string[] }>
}

const PROBE_SOURCE: CapabilityEvidenceSourceV1 = 'gateway_probe'
const DECL_SOURCE: CapabilityEvidenceSourceV1 = 'adapter_declaration'
const HARD_GAP_SOURCE: CapabilityEvidenceSourceV1 = 'protocol_inspection'

const UNKNOWN_TTL_MS = 60_000
const CONFIRMED_TTL_MS = 600_000

/** transport 异常 → provider error 分类（timeout/断线 = outcomeUnknown，绝不自动 retry）。 */
export function classifyHuabuTransportErrorV1(error: unknown): ProviderContinuationErrorV1 {
  const message = error instanceof Error ? error.message : String(error)
  const isTimeout = /timeout|timed out|disconnect|ETIMEDOUT|ECONNRESET/i.test(message)
  const isConnection = /connection|socket|econn|refused/i.test(message)
  const outcomeUnknown = isTimeout || isConnection
  return {
    code: outcomeUnknown ? 'transport_outcome_unknown' : 'transport_error',
    message,
    retryable: false,
    outcomeUnknown,
  }
}

export interface HuabuAgentletContinuationAdapterOptionsV1 {
  readonly adapterId?: string
  readonly agentletId?: string
}

export class HuabuAgentletContinuationAdapterV1 implements ContinuationProviderAdapterV1 {
  readonly provider = 'huabu-agentlet' as const
  readonly adapterId: string
  private readonly agentletId: string
  private readonly transport: HuabuAgentletTransportV1
  private cache: { readonly key: string; readonly snapshot: ProviderContinuationCapabilitySnapshotV1; readonly fetchedAt: number } | undefined

  constructor(transport: HuabuAgentletTransportV1, options: HuabuAgentletContinuationAdapterOptionsV1 = {}) {
    this.transport = transport
    this.adapterId = options.adapterId ?? `huabu-agentlet:${transport.kind}`
    this.agentletId = options.agentletId ?? 'lcos-default-agentlet'
  }

  async probe(input: CapabilityProbeInputV1): Promise<ProviderContinuationCapabilitySnapshotV1> {
    const now = input.observedAt ?? new Date().toISOString()
    const key = `probe:${this.adapterId}:${input.providerRevisionOrProfileFingerprint ?? ''}`
    if (input.force !== true && this.cache !== undefined && this.cache.key === key) {
      const ttl = this.#hasUnknown(this.cache.snapshot) ? UNKNOWN_TTL_MS : CONFIRMED_TTL_MS
      if (Date.now() - this.cache.fetchedAt < ttl) return this.cache.snapshot
    }
    const declared = await this.transport.probe()
    const snapshot: ProviderContinuationCapabilitySnapshotV1 = {
      schemaVersion: 1,
      provider: 'huabu-agentlet',
      adapterId: this.adapterId,
      observedAt: now,
      probeId: input.probeId,
      session: {
        createSession: declared.session.createSession ?? unknownCapabilityClaimV1(PROBE_SOURCE, now, 'transport 未提供 create probe 结果'),
        continueExisting: declared.session.continueExisting ?? unknownCapabilityClaimV1(PROBE_SOURCE, now, 'transport 未提供 continue probe 结果'),
        // 权威 native fork probe 不存在：固定 unknown（Agenetes fork 不是 native full-history fork）。
        nativeFullHistoryFork: unknownCapabilityClaimV1(HARD_GAP_SOURCE, now, '无 authoritative native fork probe；Agenetes.fork 不算'),
        // provider attach RPC 不存在：固定 unknown。
        attachContext: unknownCapabilityClaimV1(HARD_GAP_SOURCE, now, '无 provider context-attach RPC'),
        send: declared.session.send ?? unknownCapabilityClaimV1(PROBE_SOURCE, now, 'transport 未提供 send probe 结果'),
        status: declared.session.status ?? unknownCapabilityClaimV1(PROBE_SOURCE, now, 'transport 未提供 status probe 结果'),
        cancel: declared.session.cancel ?? unknownCapabilityClaimV1(PROBE_SOURCE, now, 'transport 未提供 cancel probe 结果'),
        recoverExisting: declared.session.recoverExisting ?? unknownCapabilityClaimV1(PROBE_SOURCE, now, 'transport 未提供 recover probe 结果'),
      },
      checkout: {
        sharedCheckout: unknownCapabilityClaimV1(DECL_SOURCE, now, 'cwd 存在不等于 resolver 成功'),
        isolatedWorktree: unknownCapabilityClaimV1(HARD_GAP_SOURCE, now, '无 worktree resolver probe'),
        resolver: unknownCapabilityClaimV1(HARD_GAP_SOURCE, now, '无 checkout resolver probe'),
      },
      limitations: declared.limitations ?? [],
    }
    this.cache = { key, snapshot, fetchedAt: Date.now() }
    return snapshot
  }

  async createSession(input: CreateSessionInputV1): Promise<ProviderContinuationOperationResultV1> {
    try {
      const spawned = await this.transport.spawn({ agentletId: this.agentletId, appId: input.correlationId })
      return {
        schemaVersion: 1,
        operationId: input.operationId,
        correlationId: input.correlationId,
        provider: input.provider,
        adapterId: this.adapterId,
        action: 'create',
        outcome: 'external_created',
        externalSessionId: spawned.sessionId,
        agentletId: this.agentletId,
        ...(spawned.cwd === undefined ? {} : { cwd: spawned.cwd }),
        ...(spawned.pid === undefined ? {} : { pid: spawned.pid }),
        contextAttached: false,
        nativeFork: false,
        degradedFromNativeFork: false,
        retryAction: 'none',
        observedAt: new Date().toISOString(),
      }
    } catch (error: unknown) {
      const classified = classifyHuabuTransportErrorV1(error)
      return this.#failure('create', input.operationId, input.correlationId, input.provider, classified)
    }
  }

  async continueExisting(input: ContinueExistingInputV1): Promise<ProviderContinuationOperationResultV1> {
    try {
      const resumed = await this.transport.spawn({ agentletId: this.agentletId, appId: input.correlationId, sessionId: input.externalSessionId })
      return {
        schemaVersion: 1,
        operationId: input.operationId,
        correlationId: input.correlationId,
        provider: input.provider,
        adapterId: this.adapterId,
        action: 'continue_existing',
        outcome: 'resumed',
        externalSessionId: resumed.sessionId,
        agentletId: this.agentletId,
        ...(resumed.cwd === undefined ? {} : { cwd: resumed.cwd }),
        ...(resumed.pid === undefined ? {} : { pid: resumed.pid }),
        contextAttached: false,
        nativeFork: false,
        degradedFromNativeFork: false,
        retryAction: 'none',
        observedAt: new Date().toISOString(),
      }
    } catch (error: unknown) {
      const classified = classifyHuabuTransportErrorV1(error)
      return this.#failure('continue_existing', input.operationId, input.correlationId, input.provider, classified)
    }
  }

  async nativeFork(input: NativeForkInputV1): Promise<ProviderContinuationOperationResultV1> {
    // 权威 probe 缺省 unknown → unsupported；绝不改用 Agenetes fork 冒充。
    return {
      schemaVersion: 1,
      operationId: input.operationId,
      correlationId: input.correlationId,
      provider: input.provider,
      adapterId: this.adapterId,
      action: 'native_full_fork',
      outcome: 'unsupported',
      contextAttached: false,
      nativeFork: false,
      degradedFromNativeFork: true,
      retryAction: 'none',
      error: { code: 'native_fork_unsupported', message: 'Native full-history fork is not probed as supported.', retryable: false, outcomeUnknown: false },
      observedAt: new Date().toISOString(),
    }
  }

  async attachContext(input: AttachContextInputV1): Promise<ProviderContinuationOperationResultV1> {
    // provider attach RPC 不存在 → unsupported；是否 first-send degrade 由 T6 request 明示。
    return {
      schemaVersion: 1,
      operationId: input.operationId,
      correlationId: input.correlationId,
      provider: input.provider,
      adapterId: this.adapterId,
      action: 'attach_context',
      outcome: 'unsupported',
      externalSessionId: input.externalSessionId,
      contextAttached: false,
      nativeFork: false,
      degradedFromNativeFork: false,
      retryAction: 'reconcile',
      error: { code: 'attach_context_unsupported', message: 'Provider has no context-attach RPC.', retryable: false, outcomeUnknown: false },
      observedAt: new Date().toISOString(),
    }
  }

  async send(input: SendInputV1): Promise<ProviderContinuationOperationResultV1> {
    return {
      schemaVersion: 1,
      operationId: input.operationId,
      correlationId: input.correlationId,
      provider: input.provider,
      adapterId: this.adapterId,
      action: 'send',
      outcome: 'unsupported',
      externalSessionId: input.externalSessionId,
      agentletId: this.agentletId,
      contextAttached: false,
      nativeFork: false,
      degradedFromNativeFork: false,
      retryAction: 'none',
      error: {
        code: 'prompt_transport_not_wired',
        message: 'Huabu host prompt transport is not wired through the ACP session owner.',
        retryable: false,
        outcomeUnknown: false,
      },
      observedAt: new Date().toISOString(),
    }
  }

  async status(input: StatusInputV1): Promise<ProviderContinuationOperationResultV1> {
    if (input.externalSessionId === undefined) {
      return {
        schemaVersion: 1,
        operationId: input.operationId,
        correlationId: input.correlationId,
        provider: input.provider,
        adapterId: this.adapterId,
        action: 'status',
        outcome: 'unresolved',
        contextAttached: false,
        nativeFork: false,
        degradedFromNativeFork: false,
        retryAction: 'reconcile',
        error: { code: 'no_external_identity', message: 'No external session identity to query.', retryable: false, outcomeUnknown: false },
        observedAt: new Date().toISOString(),
      }
    }
    try {
      const session = await this.transport.getSession(this.agentletId, input.externalSessionId)
      if (session === undefined) {
        return {
          schemaVersion: 1,
          operationId: input.operationId,
          correlationId: input.correlationId,
          provider: input.provider,
          adapterId: this.adapterId,
          action: 'status',
          outcome: 'unresolved',
          externalSessionId: input.externalSessionId,
          contextAttached: false,
          nativeFork: false,
          degradedFromNativeFork: false,
          retryAction: 'reconcile',
          error: { code: 'session_not_found', message: 'Session lookup miss (not proof of termination).', retryable: false, outcomeUnknown: true },
          observedAt: new Date().toISOString(),
        }
      }
      return {
        schemaVersion: 1,
        operationId: input.operationId,
        correlationId: input.correlationId,
        provider: input.provider,
        adapterId: this.adapterId,
        action: 'status',
        outcome: 'accepted',
        externalSessionId: session.sessionId,
        agentletId: this.agentletId,
        ...(session.pid === undefined ? {} : { pid: session.pid }),
        ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
        contextAttached: false,
        nativeFork: false,
        degradedFromNativeFork: false,
        retryAction: 'none',
        observedAt: new Date().toISOString(),
      }
    } catch (error: unknown) {
      const classified = classifyHuabuTransportErrorV1(error)
      return this.#failure('status', input.operationId, input.correlationId, input.provider, classified, input.externalSessionId)
    }
  }

  async cancel(input: CancelInputV1): Promise<ProviderContinuationOperationResultV1> {
    if (input.externalSessionId === undefined) {
      return {
        schemaVersion: 1,
        operationId: input.operationId,
        correlationId: input.correlationId,
        provider: input.provider,
        adapterId: this.adapterId,
        action: 'cancel',
        outcome: 'outcome_unknown',
        contextAttached: false,
        nativeFork: false,
        degradedFromNativeFork: false,
        retryAction: 'cancel_unknown',
        error: { code: 'no_external_identity', message: 'Cannot stop without an external session identity.', retryable: false, outcomeUnknown: true },
        observedAt: new Date().toISOString(),
      }
    }
    try {
      const stopped = await this.transport.stop({ agentletId: this.agentletId, sessionId: input.externalSessionId })
      return {
        schemaVersion: 1,
        operationId: input.operationId,
        correlationId: input.correlationId,
        provider: input.provider,
        adapterId: this.adapterId,
        action: 'cancel',
        outcome: stopped.stopped ? 'accepted' : 'outcome_unknown',
        externalSessionId: input.externalSessionId,
        agentletId: this.agentletId,
        contextAttached: false,
        nativeFork: false,
        degradedFromNativeFork: false,
        retryAction: stopped.stopped ? 'none' : 'cancel_unknown',
        ...(stopped.stopped ? {} : { error: { code: 'stop_not_confirmed', message: 'Stop was not confirmed by the provider.', retryable: false, outcomeUnknown: true } }),
        observedAt: new Date().toISOString(),
      }
    } catch (error: unknown) {
      const classified = classifyHuabuTransportErrorV1(error)
      return this.#failure('cancel', input.operationId, input.correlationId, input.provider, classified, input.externalSessionId, 'cancel_unknown')
    }
  }

  async recoverExisting(input: RecoverExistingInputV1): Promise<ProviderContinuationOperationResultV1> {
    try {
      if (input.externalSessionId !== undefined) {
        const session = await this.transport.getSession(this.agentletId, input.externalSessionId)
        if (session !== undefined) return this.#recovered(input, session)
      }
      const listed = await this.transport.list(this.agentletId)
      const hit = listed.agents.find((agent) => input.identityHints.some((hint) => agent.sessionId === hint || agent.appId === hint))
      if (hit === undefined) {
        // lookup miss：固定 unresolved，绝不隐式 create（T7 V2 §7.1）。
        return {
          schemaVersion: 1,
          operationId: input.operationId,
          correlationId: input.correlationId,
          provider: input.provider,
          adapterId: this.adapterId,
          action: 'recover_existing',
          outcome: 'unresolved',
          contextAttached: false,
          nativeFork: false,
          degradedFromNativeFork: false,
          retryAction: 'reconcile',
          error: { code: 'recover_lookup_miss', message: 'No matching external session found; no second create is performed.', retryable: false, outcomeUnknown: true },
          observedAt: new Date().toISOString(),
        }
      }
      return this.#recovered(input, hit)
    } catch (error: unknown) {
      const classified = classifyHuabuTransportErrorV1(error)
      return this.#failure('recover_existing', input.operationId, input.correlationId, input.provider, classified, input.externalSessionId, 'reconcile')
    }
  }

  #recovered(input: RecoverExistingInputV1, session: HuabuAgentletSessionInfoV1): ProviderContinuationOperationResultV1 {
    return {
      schemaVersion: 1,
      operationId: input.operationId,
      correlationId: input.correlationId,
      provider: input.provider,
      adapterId: this.adapterId,
      action: 'recover_existing',
      outcome: 'recovered',
      externalSessionId: session.sessionId,
      agentletId: this.agentletId,
      ...(session.pid === undefined ? {} : { pid: session.pid }),
      ...(session.cwd === undefined ? {} : { cwd: session.cwd }),
      contextAttached: false,
      nativeFork: false,
      degradedFromNativeFork: false,
      retryAction: 'none',
      observedAt: new Date().toISOString(),
    }
  }

  #failure(
    action: ProviderContinuationOperationResultV1['action'],
    operationId: string,
    correlationId: string,
    provider: string,
    error: ProviderContinuationErrorV1,
    externalSessionId?: string,
    retryAction: ProviderContinuationOperationResultV1['retryAction'] = error.outcomeUnknown ? 'reconcile' : 'none',
  ): ProviderContinuationOperationResultV1 {
    return {
      schemaVersion: 1,
      operationId,
      correlationId,
      provider,
      adapterId: this.adapterId,
      action,
      outcome: error.outcomeUnknown ? 'outcome_unknown' : 'failed',
      ...(externalSessionId === undefined ? {} : { externalSessionId }),
      contextAttached: false,
      nativeFork: false,
      degradedFromNativeFork: false,
      retryAction,
      error,
      observedAt: new Date().toISOString(),
    }
  }

  #hasUnknown(snapshot: ProviderContinuationCapabilitySnapshotV1): boolean {
    const claims: readonly CapabilityClaimV1[] = [
      ...Object.values(snapshot.session),
      ...Object.values(snapshot.checkout),
    ]
    return claims.some((claim) => claim.value === 'unknown')
  }
}
