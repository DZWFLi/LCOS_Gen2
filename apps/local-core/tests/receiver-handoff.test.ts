import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProjectEventEnvelope } from '@local-creative-os/contracts'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { ReceiverRuntimeService } from '../src/receiver-runtime-service.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcos-receiver-handoff-'))
  cleanup.push(root)
  const graph = createMvpSampleSnapshot(join(root, 'project'), '2026-08-25T00:00:00.000Z')
  const metadata = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(metadata)
  metadata.save(graph)
  const events = new ProjectEventHub()
  const projectId = String(graph.project.id)
  const received: ProjectEventEnvelope[] = []
  events.subscribe(projectId, (event) => { received.push(event) })
  const service = new ReceiverRuntimeService(metadata, events)
  return { root, metadata, service, projectId, received }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  // Windows 上 rm 打开中的 SQLite 文件会 hang（WAL 文件锁）；必须先 close 再删。
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('RECEIVER-3 ReceiverRuntimeService Handoff（prepare → 读 pending → consume）', () => {
  it('主链路：prepare 冻结现场 → 读 pending → consume 标记消费 → 幂等（再读/再消费都为 null）', async () => {
    const { service, projectId } = await setup()
    const from = service.connectConversation({ projectId, conversationRef: 'ref-a', executorId: 'executor-1', provider: 'codex', label: '会话A' })
    const to = service.connectConversation({ projectId, conversationRef: 'ref-b', executorId: 'executor-1', provider: 'codex', label: '会话B' })
    service.setActiveReceiver(projectId, from.id)

    const pack = service.prepareHandoff({
      projectId,
      fromConversationId: from.id,
      toConversationId: to.id,
      surface: { kind: 'main', surfaceId: 'workspace-main' },
      selectionEntityIds: ['view-brief', 'view-board'],
    })
    expect(pack.schemaVersion).toBe(1)
    expect(pack.fromConversationId).toBe(from.id)
    expect(pack.toConversationId).toBe(to.id)
    expect(pack.surface).toEqual({ kind: 'main', surfaceId: 'workspace-main' })
    expect(pack.selectionEntityIds).toEqual(['view-brief', 'view-board'])
    expect(pack.consumedAt).toBeNull()

    const pending = service.getPendingHandoff(projectId, to.id)
    expect(pending).not.toBeNull()
    expect(pending?.selectionEntityIds).toEqual(['view-brief', 'view-board'])

    const consumed = service.consumePendingHandoff(projectId, to.id)
    expect(consumed).not.toBeNull()
    expect(consumed?.consumedAt).not.toBeNull()

    // 幂等：已消费后再读 pending 为 null；再 consume 返回 null 不报错。
    expect(service.getPendingHandoff(projectId, to.id)).toBeNull()
    expect(service.consumePendingHandoff(projectId, to.id)).toBeNull()
  })

  it('from=null 首次承接（无前手）', async () => {
    const { service, projectId } = await setup()
    const to = service.connectConversation({ projectId, conversationRef: 'ref-a', executorId: 'executor-1', provider: 'codex', label: '会话A' })
    const pack = service.prepareHandoff({
      projectId,
      fromConversationId: null,
      toConversationId: to.id,
      surface: { kind: 'context', surfaceId: 'context-1' },
      selectionEntityIds: [],
    })
    expect(pack.fromConversationId).toBeNull()
    expect(service.getPendingHandoff(projectId, to.id)?.fromConversationId).toBeNull()
  })

  it('事件总线：prepare 发 receiver.handoff_prepared，consume 发 receiver.handoff_consumed（continuity 频道）', async () => {
    const { service, projectId, received } = await setup()
    const from = service.connectConversation({ projectId, conversationRef: 'ref-a', executorId: 'executor-1', provider: 'codex', label: '会话A' })
    const to = service.connectConversation({ projectId, conversationRef: 'ref-b', executorId: 'executor-1', provider: 'codex', label: '会话B' })
    received.length = 0

    service.prepareHandoff({ projectId, fromConversationId: from.id, toConversationId: to.id, surface: { kind: 'workflow', surfaceId: 'workflow-1' }, selectionEntityIds: [] })
    service.consumePendingHandoff(projectId, to.id)

    const kinds = received.map((event) => (event.payload as { kind?: string }).kind)
    expect(kinds).toContain('receiver.handoff_prepared')
    expect(kinds).toContain('receiver.handoff_consumed')
    const prepared = received.find((event) => (event.payload as { kind?: string }).kind === 'receiver.handoff_prepared')
    expect(prepared?.channel).toBe('continuity')
    expect(prepared?.type).toBe('continuity.changed')
    expect(prepared?.entityRefs).toEqual([to.id])
    const consumed = received.find((event) => (event.payload as { kind?: string }).kind === 'receiver.handoff_consumed')
    expect(consumed?.entityRefs).toEqual([to.id])
  })

  it('同一 to 会话重复 prepare 覆盖旧 pending（保留最新现场）', async () => {
    const { service, projectId } = await setup()
    const to = service.connectConversation({ projectId, conversationRef: 'ref-a', executorId: 'executor-1', provider: 'codex', label: '会话A' })
    service.prepareHandoff({ projectId, fromConversationId: null, toConversationId: to.id, surface: { kind: 'main', surfaceId: 'workspace-1' }, selectionEntityIds: ['view-old'] })
    service.prepareHandoff({ projectId, fromConversationId: null, toConversationId: to.id, surface: { kind: 'context', surfaceId: 'context-2' }, selectionEntityIds: ['view-new-1', 'view-new-2'] })
    const pending = service.getPendingHandoff(projectId, to.id)
    expect(pending?.surface).toEqual({ kind: 'context', surfaceId: 'context-2' })
    expect(pending?.selectionEntityIds).toEqual(['view-new-1', 'view-new-2'])
  })

  it('校验：to/from 会话不存在时抛错；consume 从未 prepare 的会话返回 null', async () => {
    const { service, projectId } = await setup()
    const a = service.connectConversation({ projectId, conversationRef: 'ref-a', executorId: 'executor-1', provider: 'codex', label: '会话A' })
    expect(() => service.prepareHandoff({ projectId, fromConversationId: null, toConversationId: 'missing-id', surface: { kind: 'main', surfaceId: 'w' }, selectionEntityIds: [] })).toThrow('Connected conversation not found in project.')
    expect(() => service.prepareHandoff({ projectId, fromConversationId: 'missing-id', toConversationId: a.id, surface: { kind: 'main', surfaceId: 'w' }, selectionEntityIds: [] })).toThrow('From conversation not found in project.')
    expect(service.consumePendingHandoff(projectId, a.id)).toBeNull()
  })

  it('持久化：pending handoff 落库（migration v40 表），重启 repository 后仍可读', async () => {
    const { root, metadata, service, projectId } = await setup()
    const from = service.connectConversation({ projectId, conversationRef: 'ref-a', executorId: 'executor-1', provider: 'codex', label: '会话A' })
    const to = service.connectConversation({ projectId, conversationRef: 'ref-b', executorId: 'executor-1', provider: 'codex', label: '会话B' })
    service.prepareHandoff({ projectId, fromConversationId: from.id, toConversationId: to.id, surface: { kind: 'main', surfaceId: 'workspace-main' }, selectionEntityIds: ['view-brief'] })

    const databasePath = join(root, 'metadata.sqlite')
    metadata.close()
    const reopened = new SqliteMetadataRepository(databasePath)
    repositories.push(reopened)
    const reopenedService = new ReceiverRuntimeService(reopened, new ProjectEventHub())
    const pending = reopenedService.getPendingHandoff(projectId, to.id)
    expect(pending?.selectionEntityIds).toEqual(['view-brief'])
    expect(pending?.fromConversationId).toBe(from.id)
  })
})

describe('RECEIVER-3 REST 面（真实 HTTP 服务端到端：prepare → GET pending → consume）', () => {
  it('POST /receiver-handoff 建快照，GET pending 可查，POST consume 消费后 GET 为 null', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lcos-receiver-handoff-http-'))
    cleanup.push(root)
    const graph = createMvpSampleSnapshot(join(root, 'project'), '2026-08-25T00:00:00.000Z')
    const metadata = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
    repositories.push(metadata)
    metadata.save(graph)
    const server = createLocalCoreServer({ port: 0, metadataRepository: metadata })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const projectId = String(graph.project.id)

    // 两个承接对话 + 前手设为 active。
    const createConversation = async (ref: string) => {
      const response = await fetch(`${baseUrl}/projects/${projectId}/connected-conversations`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'connect', provider: 'codex', executorId: 'executor-1', conversationRef: ref, label: `会话${ref}` }),
      })
      const body = await response.json() as { ok: boolean; value: { id: string } }
      expect(response.status).toBe(201)
      expect(body.ok).toBe(true)
      return body.value.id
    }
    const fromId = await createConversation('ref-a')
    const toId = await createConversation('ref-b')
    const bindResponse = await fetch(`${baseUrl}/projects/${projectId}/receiver-binding`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connectedConversationId: fromId }),
    })
    expect(bindResponse.status).toBe(200)

    // prepare：201 + 契约字段。
    const prepareResponse = await fetch(`${baseUrl}/projects/${projectId}/receiver-handoff`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromConversationId: fromId, toConversationId: toId, surface: { kind: 'context', surfaceId: 'context-1' }, selectionEntityIds: ['view-brief', 'view-board'] }),
    })
    expect(prepareResponse.status).toBe(201)
    const prepared = await prepareResponse.json() as { ok: boolean; value: { fromConversationId: string; toConversationId: string; surface: { kind: string }; selectionEntityIds: string[]; consumedAt: string | null } }
    expect(prepared.ok).toBe(true)
    expect(prepared.value.fromConversationId).toBe(fromId)
    expect(prepared.value.toConversationId).toBe(toId)
    expect(prepared.value.surface).toEqual({ kind: 'context', surfaceId: 'context-1' })
    expect(prepared.value.selectionEntityIds).toEqual(['view-brief', 'view-board'])
    expect(prepared.value.consumedAt).toBeNull()

    // GET pending：切换后可查。
    const pendingResponse = await fetch(`${baseUrl}/projects/${projectId}/receiver-handoff/${toId}`)
    expect(pendingResponse.status).toBe(200)
    const pending = await pendingResponse.json() as { ok: boolean; value: { selectionEntityIds: string[] } | null }
    expect(pending.value?.selectionEntityIds).toEqual(['view-brief', 'view-board'])

    // consume：注入首条消息后标记；幂等（再 GET 为 null，再 consume 为 null）。
    const consumeResponse = await fetch(`${baseUrl}/projects/${projectId}/receiver-handoff/${toId}/consume`, { method: 'POST' })
    expect(consumeResponse.status).toBe(200)
    const consumed = await consumeResponse.json() as { ok: boolean; value: { consumedAt: string | null } | null }
    expect(consumed.value?.consumedAt).not.toBeNull()
    const afterResponse = await fetch(`${baseUrl}/projects/${projectId}/receiver-handoff/${toId}`)
    const after = await afterResponse.json() as { ok: boolean; value: unknown }
    expect(after.value).toBeNull()
    const consumeAgainResponse = await fetch(`${baseUrl}/projects/${projectId}/receiver-handoff/${toId}/consume`, { method: 'POST' })
    const consumeAgain = await consumeAgainResponse.json() as { ok: boolean; value: unknown }
    expect(consumeAgain.value).toBeNull()

    // 校验面：非法 surface.kind → 400；不存在的 to 会话 → 400。
    const badKindResponse = await fetch(`${baseUrl}/projects/${projectId}/receiver-handoff`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromConversationId: null, toConversationId: toId, surface: { kind: 'bogus', surfaceId: 'x' }, selectionEntityIds: [] }),
    })
    expect(badKindResponse.status).toBe(400)
    const missingToResponse = await fetch(`${baseUrl}/projects/${projectId}/receiver-handoff`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fromConversationId: null, toConversationId: 'missing', surface: { kind: 'main', surfaceId: 'x' }, selectionEntityIds: [] }),
    })
    expect(missingToResponse.status).toBe(400)
  })
})
