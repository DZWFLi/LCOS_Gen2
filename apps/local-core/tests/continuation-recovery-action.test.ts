import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { ContinuationSubmitRequestV1 } from '@local-creative-os/contracts'
import { ContinuationStaleRevisionError, ConversationContinuationService, RecoveryActionUnsupportedError } from '../src/conversation-continuation-service.js'
import { HuabuAgentletContinuationAdapterV1 } from '../src/huabu-agentlet-continuation-adapter.js'
import { DevFakeAgentletTransportV1 } from '../src/dev-fake-agentlet-transport.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { ReceiverRuntimeService } from '../src/receiver-runtime-service.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcos-recovery-action-'))
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
    projectId, conversationRef: 'recovery-target', executorId: 'e', provider: 'codex', label: '恢复目标',
  })
  const transport = new DevFakeAgentletTransportV1()
  const adapter = new HuabuAgentletContinuationAdapterV1(transport, { adapterId: 'test-fake' })
  return { root, metadata, projectId, conversationId: conversation.id, service, adapter, transport }
}

function submitInput(projectId: string, conversationId: string, operationId: string): ContinuationSubmitRequestV1 {
  return {
    schemaVersion: 1, operationId, projectId, connectedConversationId: conversationId,
    mode: 'continue_existing', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex',
  }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('executeRecoveryAction（intent → T6 service → T7 adapter → receipt → journal）', () => {
  it('recover_external：adapter createSession 成功 → external_create confirmed + evidence', async () => {
    const { service, projectId, conversationId, adapter } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-1'))
    const fresh = await service.executeRecoveryAction(projectId, 'op-1', 'recover_external', adapter)
    expect(fresh.steps.external_create).toBe('confirmed')
    expect(fresh.externalEvidence?.externalSessionId).toBeTruthy()
    expect(fresh.status).toBe('binding')
  })

  it('recover_external：transport 超时 → outcome_unknown + 只允许 reconcile（绝不二次 create 自动重试）', async () => {
    const { service, projectId, conversationId, adapter, transport } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-2'))
    transport.failNextSpawnOnce()
    const fresh = await service.executeRecoveryAction(projectId, 'op-2', 'recover_external', adapter)
    expect(fresh.steps.external_create).toBe('outcome_unknown')
    expect(fresh.status).toBe('outcome_unknown')
    expect(fresh.allowedActions.map((a) => a.action)).toEqual(['reconcile', 'cancel_request'])
  })

  it('native_full_fork：provider 不支持 native fork → degrade 到 create + bundle，errorEvidence 记录降级（不冒充 fork）', async () => {
    const { service, projectId, conversationId, adapter } = await setup()
    service.submit({ ...submitInput(projectId, conversationId, 'op-fork'), mode: 'native_full_fork' })
    // DevFake adapter.nativeFork 固定返回 unsupported + degradedFromNativeFork
    const fresh = await service.executeRecoveryAction(projectId, 'op-fork', 'recover_external', adapter)
    expect(fresh.steps.external_create).toBe('confirmed')
    expect(fresh.externalEvidence?.externalSessionId).toBeTruthy()
    expect(fresh.errorEvidence).toMatch(/native fork unsupported.*degraded to create/)
  })

  it('native_full_fork：无 fork 源（未指定 connectedConversationId）→ 直接 create（不冒充 fork）', async () => {
    const { service, projectId, adapter } = await setup()
    service.submit({
      schemaVersion: 1, operationId: 'op-fork-nosrc', projectId,
      mode: 'native_full_fork', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex',
    })
    const fresh = await service.executeRecoveryAction(projectId, 'op-fork-nosrc', 'recover_external', adapter)
    expect(fresh.steps.external_create).toBe('confirmed')
    expect(fresh.externalEvidence?.externalSessionId).toBeTruthy()
    expect(fresh.errorEvidence).toMatch(/source unavailable.*degraded to create/)
  })

  it('duplicate submit（同一 operationId）→ 幂等返回，绝不产生第二次 create intent', async () => {
    const { service, projectId, conversationId } = await setup()
    const first = service.submit(submitInput(projectId, conversationId, 'op-dup'))
    expect(first.created).toBe(true)
    const second = service.submit(submitInput(projectId, conversationId, 'op-dup'))
    expect(second.created).toBe(false)
    expect(second.projection.operationId).toBe('op-dup')
  })

  it('同一 operationId 复用不同 payload → 拒绝 idempotency conflict', async () => {
    const { service, projectId, conversationId } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-conflict'))
    expect(() => service.submit({ ...submitInput(projectId, conversationId, 'op-conflict'), mode: 'blank_new' }))
      .toThrow(/Idempotency conflict/)
  })

  it('reconcile lookup miss 保持 outcome_unknown，不重新开放 create', async () => {
    const { service, projectId, adapter } = await setup()
    service.submit({ schemaVersion: 1, operationId: 'op-reconcile-miss', projectId, mode: 'blank_new', contextInheritance: 'none', checkout: 'shared', provider: 'codex' })
    service.advanceStep(projectId, 'op-reconcile-miss', { step: 'external_create', outcome: 'outcome_unknown' })
    const fresh = await service.executeRecoveryAction(projectId, 'op-reconcile-miss', 'reconcile', adapter)
    expect(fresh.steps.external_create).toBe('outcome_unknown')
    expect(fresh.allowedActions.map((a) => a.action)).toEqual(['reconcile', 'cancel_request'])
  })

  it('并发 recover_external 只允许一个 SQLite pending claim 调 provider create', async () => {
    const { service, projectId, adapter, transport } = await setup()
    service.submit({ ...submitInput(projectId, 'missing-target', 'op-concurrent'), connectedConversationId: undefined })
    const results = await Promise.allSettled([
      service.executeRecoveryAction(projectId, 'op-concurrent', 'recover_external', adapter),
      service.executeRecoveryAction(projectId, 'op-concurrent', 'recover_external', adapter),
    ])
    expect(transport.spawnCalls).toBe(1)
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
  })

  it('recover_bind：外部已确认 + bind 失败 → adapter continueExisting resumed → core_bind confirmed', async () => {
    const { service, projectId, conversationId, adapter, metadata } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-3'))
    const external = await service.executeRecoveryAction(projectId, 'op-3', 'recover_external', adapter)
    expect(external.steps.external_create).toBe('confirmed')
    service.advanceStep(projectId, 'op-3', { step: 'core_bind', outcome: 'failed', errorEvidence: 'bind-timeout' })
    const fresh = await service.executeRecoveryAction(projectId, 'op-3', 'recover_bind', adapter)
    expect(fresh.steps.core_bind).toBe('confirmed')
    expect(fresh.status).toBe('attaching')
    expect(metadata.getConnectedConversation(projectId, conversationId)?.conversationRef)
      .toBe(external.externalEvidence?.externalSessionId)
  })

  it('blank/new bind writes the canonical id back to the journal in the same transaction', async () => {
    const { service, projectId, adapter, metadata } = await setup()
    service.submit({
      schemaVersion: 1,
      operationId: 'op-blank-bind',
      projectId,
      mode: 'blank_new',
      contextInheritance: 'none',
      checkout: 'shared',
      provider: 'codex',
    })
    const external = await service.executeRecoveryAction(projectId, 'op-blank-bind', 'recover_external', adapter)
    const fresh = await service.executeRecoveryAction(projectId, 'op-blank-bind', 'recover_bind', adapter)
    expect(fresh.steps.core_bind).toBe('confirmed')
    expect(fresh.connectedConversationId).toBeTruthy()
    expect(metadata.getContinuationOperationJournal(projectId, 'op-blank-bind')?.connectedConversationId)
      .toBe(fresh.connectedConversationId)
    expect(metadata.getConnectedConversationByRef(projectId, external.externalEvidence!.externalSessionId)?.id)
      .toBe(fresh.connectedConversationId)
  })

  it('core_bind CAS conflict rolls back the connected conversation insert', async () => {
    const { service, projectId, adapter, metadata } = await setup()
    service.submit({
      schemaVersion: 1,
      operationId: 'op-atomic-bind',
      projectId,
      mode: 'blank_new',
      contextInheritance: 'none',
      checkout: 'shared',
      provider: 'codex',
    })
    const external = await service.executeRecoveryAction(projectId, 'op-atomic-bind', 'recover_external', adapter)
    const before = metadata.getContinuationOperationJournal(projectId, 'op-atomic-bind')!
    const claimed = metadata.claimContinuationOperationStep(projectId, 'op-atomic-bind', 'core_bind', before.revision)
    expect(claimed?.steps.core_bind).toBe('pending')
    expect(() => metadata.confirmContinuationCoreBind({
      projectId,
      operationId: 'op-atomic-bind',
      expectedRevision: claimed!.revision - 1,
      externalSessionId: external.externalEvidence!.externalSessionId,
      fallbackConnectedConversationId: 'connected-conversation-atomic-rollback',
    })).toThrow(/revision mismatch/)
    expect(metadata.getConnectedConversationByRef(projectId, external.externalEvidence!.externalSessionId)).toBeUndefined()
    expect(metadata.getContinuationOperationJournal(projectId, 'op-atomic-bind')?.steps.core_bind).toBe('pending')
  })

  it('retry_projection：T1 未接线 → RecoveryActionUnsupportedError（前端禁用按钮）', async () => {
    const { service, projectId, conversationId, adapter } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-4'))
    const external = await service.executeRecoveryAction(projectId, 'op-4', 'recover_external', adapter)
    expect(external.steps.external_create).toBe('confirmed')
    service.advanceStep(projectId, 'op-4', { step: 'core_bind', outcome: 'confirmed' })
    service.advanceStep(projectId, 'op-4', { step: 'attach', outcome: 'confirmed' })
    service.advanceStep(projectId, 'op-4', { step: 'projection', outcome: 'failed' })
    await expect(service.executeRecoveryAction(projectId, 'op-4', 'retry_projection', adapter))
      .rejects.toBeInstanceOf(RecoveryActionUnsupportedError)
  })

  it('cancel_request：本地意图 requested + adapter cancel accepted → cancel 保持 requested（不冒充 cancelled）', async () => {
    const { service, projectId, conversationId, adapter } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-5'))
    await service.executeRecoveryAction(projectId, 'op-5', 'recover_external', adapter)
    const fresh = await service.executeRecoveryAction(projectId, 'op-5', 'cancel_request', adapter)
    expect(fresh.cancel).toBe('requested')
    expect(fresh.status).toBe('recovering')
  })

  it('防重/幂等：settled 后再次执行同一动作被拒绝（不重复副作用）', async () => {
    const { service, projectId, conversationId, adapter } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-6'))
    await service.executeRecoveryAction(projectId, 'op-6', 'recover_external', adapter)
    await expect(service.executeRecoveryAction(projectId, 'op-6', 'recover_external', adapter))
      .rejects.toThrow(/not allowed/)
  })

  it('stale expectedRevision → ContinuationStaleRevisionError', async () => {
    const { service, projectId, conversationId, adapter } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-7'))
    await expect(service.executeRecoveryAction(projectId, 'op-7', 'recover_external', adapter, 99))
      .rejects.toBeInstanceOf(ContinuationStaleRevisionError)
  })

  it('重启恢复：outcome_unknown 后关库重开 → 读回 unknown + reconcile', async () => {
    const { root, projectId, conversationId, service, adapter, transport } = await setup()
    service.submit(submitInput(projectId, conversationId, 'op-8'))
    transport.failNextSpawnOnce()
    await service.executeRecoveryAction(projectId, 'op-8', 'recover_external', adapter)
    const databasePath = join(root, 'metadata.sqlite')
    repositories.forEach((repo) => { try { repo.close() } catch { /* noop */ } })
    repositories.length = 0

    const reopened = new SqliteMetadataRepository(databasePath)
    repositories.push(reopened)
    const events = new ProjectEventHub()
    const serviceB = new ConversationContinuationService(reopened, events)
    const projection = serviceB.read(projectId, 'op-8')
    expect(projection?.steps.external_create).toBe('outcome_unknown')
    expect(projection?.allowedActions.map((a) => a.action)).toEqual(['reconcile', 'cancel_request'])
  })
})

describe('POST .../recovery-actions（HTTP，fake transport env）', () => {
  it('recover_external → Work View 回读 fresh projection；重复点击 409；会话隔离；adapter 未配置 503', async () => {
    const { root } = await setup()
    const databasePath = join(root, 'metadata.sqlite')
    repositories.forEach((repo) => { try { repo.close() } catch { /* noop */ } })
    repositories.length = 0

    const prev = process.env.LCOS_RECOVERY_TRANSPORT
    process.env.LCOS_RECOVERY_TRANSPORT = 'fake'
    try {
      const metadata = new SqliteMetadataRepository(databasePath)
      repositories.push(metadata)
      const graph = createMvpSampleSnapshot(join(root, 'project-http'), '2026-09-12T00:00:00.000Z')
      metadata.save(graph)
      const httpProjectId = String(graph.project.id)
      const events = new ProjectEventHub()
      const receivers = new ReceiverRuntimeService(metadata, events)
      const conversationA = receivers.connectConversation({
        projectId: httpProjectId, conversationRef: 'http-target-a', executorId: 'e', provider: 'codex', label: 'HTTP 恢复 A',
      })
      const conversationB = receivers.connectConversation({
        projectId: httpProjectId, conversationRef: 'http-target-b', executorId: 'e', provider: 'codex', label: 'HTTP 恢复 B',
      })

      const server = createLocalCoreServer({ metadataRepository: metadata })
      servers.push(server)
      const address = await server.start()
      const baseUrl = `http://127.0.0.1:${address.port}`
      const headers = { 'content-type': 'application/json' }

      const submitResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations`, {
        method: 'POST', headers, body: JSON.stringify({
          input: { operationId: 'op-http', mode: 'continue_existing', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex', connectedConversationId: conversationA.id },
        }),
      })
      expect(submitResponse.status).toBe(201)
      await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations`, {
        method: 'POST', headers, body: JSON.stringify({
          input: { operationId: 'op-b', mode: 'continue_existing', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex', connectedConversationId: conversationB.id },
        }),
      })

      const actionResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations/op-http/recovery-actions`, {
        method: 'POST', headers, body: JSON.stringify({ input: { action: 'recover_external', expectedRevision: 0 } }),
      })
      expect(actionResponse.status).toBe(200)
      const body = await actionResponse.json() as { value: { steps: { external_create: string }; status: string } }
      expect(body.value.steps.external_create).toBe('confirmed')
      expect(body.value.status).toBe('binding')

      // Work View 回读：同会话操作已更新为 confirmed；另一会话操作不混入（切换会话隔离）。
      const wvA = await fetch(`${baseUrl}/projects/${httpProjectId}/connected-conversations/${conversationA.id}/work-view`)
      const bodyA = await wvA.json() as { value: { operations: Array<{ operationId: string; steps: { external_create?: string }; status: string }> } }
      const opA = bodyA.value.operations.find((op) => op.operationId === 'op-http')
      expect(opA?.steps.external_create).toBe('confirmed')
      expect(opA?.status).toBe('binding')
      expect(bodyA.value.operations.find((op) => op.operationId === 'op-b')).toBeUndefined()

      const wvB = await fetch(`${baseUrl}/projects/${httpProjectId}/connected-conversations/${conversationB.id}/work-view`)
      const bodyB = await wvB.json() as { value: { operations: Array<{ operationId: string }> } }
      expect(bodyB.value.operations.map((op) => op.operationId)).toEqual(['op-b'])

      // 重复点击：settled 后再次执行同一动作 → 409（不重复副作用）。
      const duplicate = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations/op-http/recovery-actions`, {
        method: 'POST', headers, body: JSON.stringify({ input: { action: 'recover_external' } }),
      })
      expect(duplicate.status).toBe(409)
    } finally {
      if (prev === undefined) delete process.env.LCOS_RECOVERY_TRANSPORT
      else process.env.LCOS_RECOVERY_TRANSPORT = prev
    }
  })

  it('adapter 未配置 → recovery 动作 503 UNAVAILABLE', async () => {
    const { root } = await setup()
    const databasePath = join(root, 'metadata.sqlite')
    repositories.forEach((repo) => { try { repo.close() } catch { /* noop */ } })
    repositories.length = 0

    const prev = process.env.LCOS_RECOVERY_TRANSPORT
    delete process.env.LCOS_RECOVERY_TRANSPORT
    try {
      const metadata = new SqliteMetadataRepository(databasePath)
      repositories.push(metadata)
      const graph = createMvpSampleSnapshot(join(root, 'project-http'), '2026-09-12T00:00:00.000Z')
      metadata.save(graph)
      const httpProjectId = String(graph.project.id)
      const events = new ProjectEventHub()
      const receivers = new ReceiverRuntimeService(metadata, events)
      const conversation = receivers.connectConversation({
        projectId: httpProjectId, conversationRef: 'http-target', executorId: 'e', provider: 'codex', label: 'HTTP 恢复',
      })

      const server = createLocalCoreServer({ metadataRepository: metadata })
      servers.push(server)
      const address = await server.start()
      const baseUrl = `http://127.0.0.1:${address.port}`
      const headers = { 'content-type': 'application/json' }

      await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations`, {
        method: 'POST', headers, body: JSON.stringify({
          input: { operationId: 'op-no-adapter', mode: 'continue_existing', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex', connectedConversationId: conversation.id },
        }),
      })

      const actionResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations/op-no-adapter/recovery-actions`, {
        method: 'POST', headers, body: JSON.stringify({ input: { action: 'recover_external' } }),
      })
      expect(actionResponse.status).toBe(503)
      const body = await actionResponse.json() as { error: { code: string } }
      expect(body.error.code).toBe('UNAVAILABLE')
    } finally {
      if (prev === undefined) delete process.env.LCOS_RECOVERY_TRANSPORT
      else process.env.LCOS_RECOVERY_TRANSPORT = prev
    }
  })
})
