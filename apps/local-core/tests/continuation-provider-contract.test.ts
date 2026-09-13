import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  CapabilityClaimV1,
  ContinuityAttachBundleV1,
  ContinuationSubmitRequestV1,
} from '@local-creative-os/contracts'
import { continuationExternalEvidenceFromReceiptV1 } from '@local-creative-os/contracts'
import {
  classifyHuabuTransportErrorV1,
  HuabuAgentletContinuationAdapterV1,
  type HuabuAgentletSessionInfoV1,
  type HuabuAgentletTransportV1,
} from '../src/huabu-agentlet-continuation-adapter.js'
import { ConversationContinuationService } from '../src/conversation-continuation-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { ReceiverRuntimeService } from '../src/receiver-runtime-service.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

function bundleFixture(projectId: string): ContinuityAttachBundleV1 {
  const intent = {
    type: 'continue_work' as const,
    objectViewIds: [] as readonly string[],
    goal: '继续',
    constraints: [] as readonly string[],
    evidenceKeys: [] as readonly string[],
    suggestedSkillIds: [] as readonly string[],
    confidence: 0.5,
  }
  return {
    schemaVersion: 1,
    projectId,
    workspaceId: null,
    intent,
    contextPack: { schemaVersion: 0, projectId, workspaceId: null, intent, items: [], selectedCount: 0, pinnedCount: 0, relatedCount: 0 },
    skillTarget: { intentType: 'continue_work', supportingSkillIds: [], target: '', sideEffect: 'READ_ONLY', requiresApproval: false, reason: '' },
    selectedViewIds: [],
    sourceRefs: [],
    generatedAt: '2026-09-12T00:00:00.000Z',
  }
}

interface FakeTransportOverrides {
  readonly spawnError?: Error
  readonly spawnSessionId?: string
  readonly stopError?: Error
  readonly stopResult?: { readonly stopped: boolean }
  readonly sendError?: Error
  readonly getSessionResult?: HuabuAgentletSessionInfoV1 | undefined
  readonly listAgents?: readonly HuabuAgentletSessionInfoV1[]
  readonly probeClaims?: Readonly<Partial<Record<'createSession' | 'continueExisting' | 'send' | 'status' | 'cancel' | 'recoverExisting', CapabilityClaimV1>>>
}

class FakeHuabuTransport implements HuabuAgentletTransportV1 {
  readonly kind = 'fake'
  spawnCalls = 0
  private readonly overrides: FakeTransportOverrides

  constructor(overrides: FakeTransportOverrides = {}) {
    this.overrides = overrides
  }

  async spawn(_params: { readonly agentletId: string; readonly appId: string; readonly sessionId?: string }): Promise<{ readonly sessionId: string; readonly pid: number; readonly cwd?: string }> {
    this.spawnCalls += 1
    if (this.overrides.spawnError !== undefined) throw this.overrides.spawnError
    return { sessionId: this.overrides.spawnSessionId ?? 'fake-session-1', pid: 4242, cwd: '/tmp/fake' }
  }

  async stop(_params: { readonly agentletId: string; readonly sessionId: string }): Promise<{ readonly stopped: boolean }> {
    if (this.overrides.stopError !== undefined) throw this.overrides.stopError
    return this.overrides.stopResult ?? { stopped: true }
  }

  async list(_agentletId: string): Promise<{ readonly agents: readonly HuabuAgentletSessionInfoV1[] }> {
    return { agents: this.overrides.listAgents ?? [] }
  }

  async getSession(_agentletId: string, sessionId: string): Promise<HuabuAgentletSessionInfoV1 | undefined> {
    if (this.overrides.getSessionResult !== undefined) return this.overrides.getSessionResult
    const agents = this.overrides.listAgents ?? []
    return agents.find((agent) => agent.sessionId === sessionId)
  }

  async sendResource(_params: { readonly agentletId: string; readonly sessionId: string; readonly text?: string; readonly resourceRef?: string }): Promise<void> {
    if (this.overrides.sendError !== undefined) throw this.overrides.sendError
  }

  async probe(): Promise<{ readonly session: Readonly<Partial<Record<'createSession' | 'continueExisting' | 'send' | 'status' | 'cancel' | 'recoverExisting', CapabilityClaimV1>>>; readonly limitations?: readonly string[] }> {
    return { session: this.overrides.probeClaims ?? {}, limitations: ['fake transport'] }
  }
}

afterEach(async () => {
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('HuabuAgentletContinuationAdapter probe（unknown 默认 + 证据来源）', () => {
  it('nativeFork/attachContext/isolatedWorktree/resolver stay unknown without an authoritative probe', async () => {
    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport(), { adapterId: 'adapter-a' })
    const snapshot = await adapter.probe({ provider: 'huabu-agentlet', adapterId: 'adapter-a', probeId: 'probe-1' })
    expect(snapshot.session.nativeFullHistoryFork.value).toBe('unknown')
    expect(snapshot.session.attachContext.value).toBe('unknown')
    expect(snapshot.checkout.isolatedWorktree.value).toBe('unknown')
    expect(snapshot.checkout.resolver.value).toBe('unknown')
    expect(snapshot.session.createSession.value).toBe('unknown')
    expect(snapshot.limitations).toContain('fake transport')
  })

  it('declared probe results are honored and the snapshot is cached until force', async () => {
    const transport = new FakeHuabuTransport({ probeClaims: { createSession: { value: true, source: 'gateway_probe', observedAt: '2026-09-12T00:00:00.000Z' } } })
    const adapter = new HuabuAgentletContinuationAdapterV1(transport, { adapterId: 'adapter-a' })
    const first = await adapter.probe({ provider: 'huabu-agentlet', adapterId: 'adapter-a', probeId: 'probe-1' })
    expect(first.session.createSession.value).toBe(true)
    const second = await adapter.probe({ provider: 'huabu-agentlet', adapterId: 'adapter-a', probeId: 'probe-2' })
    expect(second.probeId).toBe('probe-1') // cached snapshot reused
    const forced = await adapter.probe({ provider: 'huabu-agentlet', adapterId: 'adapter-a', probeId: 'probe-3', force: true })
    expect(forced.probeId).toBe('probe-3')
  })
})

describe('adapter create / continue / send / status / cancel / recover（unknown 语义）', () => {
  it('createSession success returns external_created with a provider-native session identity', async () => {
    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport(), { adapterId: 'adapter-a' })
    const receipt = await adapter.createSession({
      operationId: 'op-1', correlationId: 'corr-1', provider: 'codex', createVariant: 'blank', bundle: bundleFixture('p-1'),
    })
    expect(receipt.action).toBe('create')
    expect(receipt.outcome).toBe('external_created')
    expect(receipt.externalSessionId).toBe('fake-session-1')
    expect(receipt.retryAction).toBe('none')
  })

  it('createSession transport timeout → outcome_unknown + reconcile（绝不自动 retry create）', async () => {
    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport({ spawnError: new Error('connect timed out after 3000ms') }), { adapterId: 'adapter-a' })
    const receipt = await adapter.createSession({
      operationId: 'op-1', correlationId: 'corr-1', provider: 'codex', createVariant: 'blank', bundle: bundleFixture('p-1'),
    })
    expect(receipt.outcome).toBe('outcome_unknown')
    expect(receipt.retryAction).toBe('reconcile')
    expect(receipt.error?.outcomeUnknown).toBe(true)
    expect(receipt.error?.retryable).toBe(false)
  })

  it('continueExisting resumes the same identity; identity-known failure is failed, not unknown', async () => {
    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport(), { adapterId: 'adapter-a' })
    const ok = await adapter.continueExisting({
      operationId: 'op-2', correlationId: 'corr-2', provider: 'codex', externalSessionId: 'ext-1', bundle: bundleFixture('p-1'),
    })
    expect(ok.outcome).toBe('resumed')

    const failing = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport({ spawnError: new Error('session resume unavailable') }), { adapterId: 'adapter-a' })
    const bad = await failing.continueExisting({
      operationId: 'op-2', correlationId: 'corr-2', provider: 'codex', externalSessionId: 'ext-1', bundle: bundleFixture('p-1'),
    })
    expect(bad.outcome).toBe('failed')
    expect(bad.error?.outcomeUnknown).toBe(false)
  })

  it('nativeFork and attachContext are unsupported until an authoritative probe', async () => {
    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport(), { adapterId: 'adapter-a' })
    const fork = await adapter.nativeFork({
      operationId: 'op-3', correlationId: 'corr-3', provider: 'codex', sourceExternalSessionId: 'ext-1', bundle: bundleFixture('p-1'),
    })
    expect(fork.outcome).toBe('unsupported')
    expect(fork.degradedFromNativeFork).toBe(true)

    const attach = await adapter.attachContext({
      operationId: 'op-4', correlationId: 'corr-4', provider: 'codex', externalSessionId: 'ext-1', bundle: bundleFixture('p-1'),
    })
    expect(attach.outcome).toBe('unsupported')
    expect(attach.contextAttached).toBe(false)
  })

  it('send success → sent; disconnect → outcome_unknown, never sent', async () => {
    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport(), { adapterId: 'adapter-a' })
    const ok = await adapter.send({ operationId: 'op-5', correlationId: 'corr-5', provider: 'codex', externalSessionId: 'ext-1', payload: { kind: 'prompt', text: '继续' } })
    expect(ok.outcome).toBe('sent')

    const broken = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport({ sendError: new Error('socket disconnected') }), { adapterId: 'adapter-a' })
    const bad = await broken.send({ operationId: 'op-5', correlationId: 'corr-5', provider: 'codex', externalSessionId: 'ext-1', payload: { kind: 'prompt', text: '继续' } })
    expect(bad.outcome).toBe('outcome_unknown')
  })

  it('status lookup miss is unresolved (not proof of termination); query error is outcome_unknown', async () => {
    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport(), { adapterId: 'adapter-a' })
    const miss = await adapter.status({ operationId: 'op-6', correlationId: 'corr-6', provider: 'codex', externalSessionId: 'ghost' })
    expect(miss.outcome).toBe('unresolved')
    expect(miss.error?.code).toBe('session_not_found')

    const found = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport({ getSessionResult: { sessionId: 'ext-1', status: 'running', pid: 7, cwd: '/tmp' } }), { adapterId: 'adapter-a' })
    const hit = await found.status({ operationId: 'op-6', correlationId: 'corr-6', provider: 'codex', externalSessionId: 'ext-1' })
    expect(hit.outcome).toBe('accepted')
    expect(hit.pid).toBe(7)
  })

  it('cancel timeout → cancel_unknown; confirmed stop → accepted', async () => {
    const timeout = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport({ stopError: new Error('stop timed out') }), { adapterId: 'adapter-a' })
    const unknownReceipt = await timeout.cancel({ operationId: 'op-7', correlationId: 'corr-7', provider: 'codex', externalSessionId: 'ext-1' })
    expect(unknownReceipt.outcome).toBe('outcome_unknown')
    expect(unknownReceipt.retryAction).toBe('cancel_unknown')

    const ok = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport(), { adapterId: 'adapter-a' })
    const acceptedReceipt = await ok.cancel({ operationId: 'op-7', correlationId: 'corr-7', provider: 'codex', externalSessionId: 'ext-1' })
    expect(acceptedReceipt.outcome).toBe('accepted')
  })

  it('recoverExisting lookup miss → unresolved and never performs a second create', async () => {
    const transport = new FakeHuabuTransport()
    const adapter = new HuabuAgentletContinuationAdapterV1(transport, { adapterId: 'adapter-a' })
    const receipt = await adapter.recoverExisting({ operationId: 'op-8', correlationId: 'corr-8', provider: 'codex', identityHints: ['ghost-session'] })
    expect(receipt.outcome).toBe('unresolved')
    expect(receipt.retryAction).toBe('reconcile')
    expect(receipt.error?.code).toBe('recover_lookup_miss')
    // 禁止隐式 create：spawn 一次都不允许发生
    expect(transport.spawnCalls).toBe(0)
  })

  it('recoverExisting hit by identity hint returns recovered with the same external session', async () => {
    const transport = new FakeHuabuTransport({ listAgents: [{ sessionId: 'ext-1', appId: 'app-1', pid: 9, cwd: '/tmp', status: 'running' }] })
    const adapter = new HuabuAgentletContinuationAdapterV1(transport, { adapterId: 'adapter-a' })
    const receipt = await adapter.recoverExisting({ operationId: 'op-8', correlationId: 'corr-8', provider: 'codex', identityHints: ['app-1'] })
    expect(receipt.outcome).toBe('recovered')
    expect(receipt.externalSessionId).toBe('ext-1')
  })
})

describe('classifyHuabuTransportErrorV1', () => {
  it('timeout/disconnect errors are outcome_unknown and non-retryable', () => {
    expect(classifyHuabuTransportErrorV1(new Error('connect timed out after 3000ms')).outcomeUnknown).toBe(true)
    expect(classifyHuabuTransportErrorV1(new Error('ECONNRESET')).outcomeUnknown).toBe(true)
    expect(classifyHuabuTransportErrorV1(new Error('resume unavailable')).outcomeUnknown).toBe(false)
  })
})

describe('T7 receipt → T6 journal 集成（Provider 成功/Core 失败 + cancel 三态上链）', () => {
  async function setupT6() {
    const root = await mkdtemp(join(tmpdir(), 'lcos-continuation-adapter-'))
    cleanup.push(root)
    const graph = createMvpSampleSnapshot(join(root, 'project'), '2026-09-12T00:00:00.000Z')
    const metadata = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
    repositories.push(metadata)
    metadata.save(graph)
    const events = new ProjectEventHub()
    const projectId = String(graph.project.id)
    const service = new ConversationContinuationService(metadata, events)
    const receivers = new ReceiverRuntimeService(metadata, events)
    const conversation = receivers.connectConversation({
      projectId,
      conversationRef: 'adapter-integration-target',
      executorId: 'executor-1',
      provider: 'codex',
      label: '续工目标',
    })
    return { root, metadata, service, projectId, conversationId: conversation.id }
  }

  function submitInput(projectId: string, conversationId: string, operationId: string): ContinuationSubmitRequestV1 {
    return {
      schemaVersion: 1,
      operationId,
      projectId,
      connectedConversationId: conversationId,
      mode: 'continue_existing',
      contextInheritance: 'inherit',
      checkout: 'shared',
      provider: 'codex',
    }
  }

  it('Provider success → Core bind failure：journal 保留外部 identity，只允许 recover_bind，绝不二次 create', async () => {
    const { service, projectId, conversationId } = await setupT6()
    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport({ spawnSessionId: 'ext-created' }), { adapterId: 'adapter-a' })
    const opId = 'op-provider-success'
    service.submit(submitInput(projectId, conversationId, opId))
    const createReceipt = await adapter.createSession({
      operationId: opId, correlationId: 'corr-p', provider: 'codex', createVariant: 'long_lived', bundle: bundleFixture(projectId),
    })
    const evidence = continuationExternalEvidenceFromReceiptV1(createReceipt)
    expect(evidence?.externalSessionId).toBe('ext-created')

    const bound = service.advanceStep(projectId, opId, { step: 'external_create', outcome: 'confirmed', externalEvidence: evidence! })
    expect(bound.status).toBe('binding')

    const failed = service.advanceStep(projectId, opId, { step: 'core_bind', outcome: 'failed', errorEvidence: 'bind-timeout' })
    expect(failed.status).toBe('recovering')
    expect(failed.externalEvidence?.externalSessionId).toBe('ext-created')
    const actions = failed.allowedActions.map((action) => action.action)
    expect(actions).toContain('recover_bind')
    expect(actions).not.toContain('recover_external')
  })

  it('cancel 三态上链：adapter timeout receipt → journal outcome_unknown → reconcile 收敛 confirmed', async () => {
    const { service, projectId, conversationId } = await setupT6()
    const opId = 'op-cancel-chain'
    service.submit(submitInput(projectId, conversationId, opId))
    service.advanceStep(projectId, opId, {
      step: 'external_create', outcome: 'confirmed',
      externalEvidence: { schemaVersion: 1, provider: 'codex', externalSessionId: 'ext-1', correlationId: 'corr-1', createdAt: '2026-09-12T00:00:00.000Z' },
    })

    const adapter = new HuabuAgentletContinuationAdapterV1(new FakeHuabuTransport({ stopError: new Error('stop timed out') }), { adapterId: 'adapter-a' })
    const cancelReceipt = await adapter.cancel({ operationId: opId, correlationId: 'corr-1', provider: 'codex', externalSessionId: 'ext-1' })
    expect(cancelReceipt.outcome).toBe('outcome_unknown')
    expect(cancelReceipt.retryAction).toBe('cancel_unknown')

    // T7 cancel receipt → journal cancel 轴：outcome_unknown 诚实上链
    const journaled = service.applyProviderCancelReceipt(projectId, opId, { outcome: cancelReceipt.outcome, errorEvidence: cancelReceipt.error?.message })
    expect(journaled.cancel).toBe('outcome_unknown')
    expect(journaled.status).toBe('outcome_unknown')
    expect(journaled.allowedActions.map((action) => action.action)).toEqual(['reconcile'])

    // 外部确认 session 不存在 → cancel 收敛 confirmed（Sprint 1A reconcile 语义）
    const converged = service.reconcile(projectId, opId, { externalConfirmed: false, errorEvidence: '外部 session 不存在' })
    expect(converged.cancel).toBe('confirmed')
    expect(converged.status).toBe('cancelled')
    expect(converged.allowedActions).toHaveLength(0)
    expect(service.read(projectId, opId)?.revision).toBe(3)
  })
})
