import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

import type { ContinuationOperationJournalRowV1, ContinuationStepAdvanceRequestV1, ContinuationSubmitRequestV1, ProjectEventEnvelope } from '@local-creative-os/contracts'
import { ContinuationStaleRevisionError, ConversationContinuationService } from '../src/conversation-continuation-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { ReceiverRuntimeService } from '../src/receiver-runtime-service.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcos-continuation-op-'))
  cleanup.push(root)
  const graph = createMvpSampleSnapshot(join(root, 'project'), '2026-09-12T00:00:00.000Z')
  const metadata = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(metadata)
  metadata.save(graph)
  const events = new ProjectEventHub()
  const projectId = String(graph.project.id)
  const received: ProjectEventEnvelope[] = []
  events.subscribe(projectId, (event) => { received.push(event) })
  const service = new ConversationContinuationService(metadata, events)
  // 承接关系原料：need a ConnectedConversation so submit can validate same-project target.
  const receivers = new ReceiverRuntimeService(metadata, events)
  const conversation = receivers.connectConversation({
    projectId,
    conversationRef: 'continuation-target-ref',
    executorId: 'executor-1',
    provider: 'codex',
    label: '续工目标会话',
  })
  return { root, metadata, service, projectId, conversationId: conversation.id, received }
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

function submitInput(projectId: string, conversationId: string, overrides: Partial<ContinuationSubmitRequestV1> = {}): ContinuationSubmitRequestV1 {
  return {
    schemaVersion: 1,
    operationId: 'op-1',
    projectId,
    connectedConversationId: conversationId,
    mode: 'continue_existing',
    contextInheritance: 'inherit',
    checkout: 'shared',
    provider: 'codex',
    ...overrides,
  }
}

function evidence(externalSessionId = 'ext-1'): NonNullable<ContinuationStepAdvanceRequestV1['externalEvidence']> {
  return { schemaVersion: 1, provider: 'codex', externalSessionId, correlationId: `corr-${externalSessionId}`, createdAt: '2026-09-12T00:00:00.000Z' }
}

describe('migration v53 continuation_operation_journal', () => {
  it('creates the journal table at schema version 53 and supports CRUD round-trip', async () => {
    const { metadata, projectId } = await setup()
    const row: ContinuationOperationJournalRowV1 = {
      schemaVersion: 1,
      operationId: 'op-migrate',
      projectId,
      connectedConversationId: null,
      mode: 'blank_new',
      contextInheritance: 'none',
      checkout: 'isolated',
      provider: 'workbuddy',
      steps: { external_create: 'not_started', core_bind: 'not_started', attach: 'not_started', projection: 'not_started' },
      cancel: 'none',
      revision: 0,
      createdAt: '2026-09-12T00:00:00.000Z',
      updatedAt: '2026-09-12T00:00:00.000Z',
    }
    metadata.saveContinuationOperationJournal(row)
    expect(metadata.getContinuationOperationJournal(projectId, 'op-migrate')?.operationId).toBe('op-migrate')
    expect(metadata.listContinuationOperationJournals(projectId).length).toBe(1)

    // 幂等 upsert：同一 operationId 覆盖（journal_json 更新）。
    metadata.saveContinuationOperationJournal({ ...row, revision: 1, updatedAt: '2026-09-12T01:00:00.000Z' })
    expect(metadata.getContinuationOperationJournal(projectId, 'op-migrate')?.revision).toBe(1)

    expect(() => metadata.saveContinuationOperationJournal({ ...row, projectId: 'another-project' }))
      .toThrow(/already owned by another project/)

    // 跨项目隔离
    expect(metadata.getContinuationOperationJournal('project-unknown', 'op-migrate')).toBeUndefined()
  })

  it('upgrades a legacy v52 database to v54 preserving existing project data', async () => {
    const { root } = await setup()
    const dbPath = join(root, 'legacy-v52.sqlite')
    const legacy = new DatabaseSync(dbPath)
    legacy.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL,
        graph_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );
      INSERT INTO projects (id, name, root_path, graph_version, created_at, updated_at)
      VALUES ('p-legacy', 'Legacy Project', '/tmp/legacy', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        scope_id TEXT NOT NULL, name TEXT NOT NULL, intent TEXT,
        viewport TEXT NOT NULL, focused_node_ids TEXT NOT NULL DEFAULT '[]',
        visible_layers TEXT NOT NULL DEFAULT '["core","process"]',
        context_policy TEXT NOT NULL DEFAULT 'selection-only',
        updated_at TEXT NOT NULL,
        frame_bounds TEXT,
        preferred_surface TEXT,
        version INTEGER NOT NULL DEFAULT 0
      );
      PRAGMA user_version = 52;
    `)
    legacy.close()

    const upgraded = new SqliteMetadataRepository(dbPath)
    repositories.push(upgraded)
    expect(upgraded.schemaVersion).toBe(54)
    // 旧数据保留
    expect(upgraded.getProject('p-legacy')?.name).toBe('Legacy Project')
    // 新表可用，外键指向旧项目
    upgraded.saveContinuationOperationJournal({
      schemaVersion: 1, operationId: 'op-legacy-1', projectId: 'p-legacy', connectedConversationId: null,
      mode: 'blank_new', contextInheritance: 'none', checkout: 'isolated', provider: 'codex',
      steps: { external_create: 'not_started', core_bind: 'not_started', attach: 'not_started', projection: 'not_started' },
      cancel: 'none', revision: 0,
      createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
    })
    expect(upgraded.getContinuationOperationJournal('p-legacy', 'op-legacy-1')?.operationId).toBe('op-legacy-1')
  })
})

describe('ConversationContinuationService submit（幂等，绝不重复 create）', () => {
  it('first submit creates journal; duplicate submit idempotently reuses it (created=false)', async () => {
    const { service, projectId, conversationId, received } = await setup()
    const first = service.submit(submitInput(projectId, conversationId))
    expect(first.created).toBe(true)
    expect(first.projection.status).toBe('established')
    expect(first.projection.steps.external_create).toBe('not_started')

    const second = service.submit(submitInput(projectId, conversationId))
    expect(second.created).toBe(false)
    expect(second.projection.operationId).toBe('op-1')
    expect(second.projection.revision).toBe(0)
    expect(received.some((event) => event.payload?.kind === 'continuation.submit_duplicate')).toBe(true)
  })

  it('rejects a target conversation outside the project', async () => {
    const { service, projectId, conversationId } = await setup()
    expect(() => service.submit(submitInput(projectId, conversationId, { connectedConversationId: 'other-project-conv' })))
      .toThrow(/Connected conversation not found/)
  })
})

describe('step progression and allowedActions', () => {
  it('external confirmed + bind failed → recover_bind; duplicate create never emitted', async () => {
    const { service, projectId, conversationId } = await setup()
    service.submit(submitInput(projectId, conversationId))
    const external = service.advanceStep(projectId, 'op-1', { step: 'external_create', outcome: 'confirmed', externalEvidence: evidence() })
    expect(external.steps.external_create).toBe('confirmed')
    expect(external.status).toBe('binding')

    const bind = service.advanceStep(projectId, 'op-1', { step: 'core_bind', outcome: 'failed', errorEvidence: 'bind-timeout' })
    expect(bind.status).toBe('recovering')
    expect(bind.errorEvidence).toBe('bind-timeout')
    const actions = bind.allowedActions.map((action) => action.action)
    expect(actions).toContain('recover_bind')
    expect(actions).not.toContain('recover_external')
  })

  it('bind confirmed + attach failed → retry_attach; projection failed → retry_projection', async () => {
    const { service, projectId, conversationId } = await setup()
    service.submit(submitInput(projectId, conversationId))
    service.advanceStep(projectId, 'op-1', { step: 'external_create', outcome: 'confirmed', externalEvidence: evidence() })
    service.advanceStep(projectId, 'op-1', { step: 'core_bind', outcome: 'confirmed' })
    const attach = service.advanceStep(projectId, 'op-1', { step: 'attach', outcome: 'failed' })
    expect(attach.allowedActions.some((action) => action.action === 'retry_attach')).toBe(true)

    service.advanceStep(projectId, 'op-1', { step: 'attach', outcome: 'confirmed' })
    const projection = service.advanceStep(projectId, 'op-1', { step: 'projection', outcome: 'failed' })
    expect(projection.allowedActions.some((action) => action.action === 'retry_projection')).toBe(true)
    // identity 保留（不删除 Conversation identity / provider session）
    expect(projection.connectedConversationId).toBe(conversationId)
  })

  it('timeout unknown allows reconcile only; a late external_confirmed reconciles to confirmed', async () => {
    const { service, projectId, conversationId } = await setup()
    service.submit(submitInput(projectId, conversationId))
    const unknown = service.advanceStep(projectId, 'op-1', { step: 'external_create', outcome: 'outcome_unknown' })
    expect(unknown.status).toBe('outcome_unknown')
    const actions = unknown.allowedActions.map((action) => action.action)
    expect(actions).toContain('reconcile')
    expect(actions).not.toContain('recover_external')

    const reconciled = service.reconcile(projectId, 'op-1', { externalConfirmed: true, externalEvidence: evidence() })
    expect(reconciled.steps.external_create).toBe('confirmed')
    expect(reconciled.status).toBe('binding')
  })

  it('confirmed external create requires external evidence (no forgery)', async () => {
    const { service, projectId, conversationId } = await setup()
    service.submit(submitInput(projectId, conversationId))
    expect(() => service.advanceStep(projectId, 'op-1', { step: 'external_create', outcome: 'confirmed' }))
      .toThrow(/externalEvidence/)
  })

  it('cancel_requested records intent but never claims cancelled; stays recoverable', async () => {
    const { service, projectId, conversationId } = await setup()
    service.submit(submitInput(projectId, conversationId))
    service.advanceStep(projectId, 'op-1', { step: 'external_create', outcome: 'confirmed', externalEvidence: evidence() })
    const cancelled = service.requestCancel(projectId, 'op-1')
    expect(cancelled.cancel).toBe('requested')
    expect(cancelled.status).toBe('recovering')
    expect(cancelled.allowedActions.some((action) => action.action === 'reconcile')).toBe(true)

    // cancel_outcome_unknown：外部终态未确认，不得显示 cancelled。
    const unknown = service.advanceStep(projectId, 'op-1', { step: 'core_bind', outcome: 'outcome_unknown' })
    expect(unknown.cancel).toBe('requested')
    expect(unknown.status).toBe('outcome_unknown')
  })
})

describe('revision / stale guard', () => {
  it('stale expectedRevision rejects the step and does NOT mutate the journal (no side effect)', async () => {
    const { service, projectId, conversationId, metadata } = await setup()
    service.submit(submitInput(projectId, conversationId))
    const before = service.read(projectId, 'op-1')
    expect(() => service.advanceStep(projectId, 'op-1', {
      step: 'external_create', outcome: 'confirmed', externalEvidence: evidence(), expectedRevision: 99,
    })).toThrow(ContinuationStaleRevisionError)
    const after = metadata.getContinuationOperationJournal(projectId, 'op-1')!
    expect(after.revision).toBe(before?.revision)
    expect(after.steps.external_create).toBe('not_started')
    expect(after.updatedAt).toBe(before?.updatedAt)
  })

  it('matching expectedRevision advances normally', async () => {
    const { service, projectId, conversationId } = await setup()
    service.submit(submitInput(projectId, conversationId))
    const advanced = service.advanceStep(projectId, 'op-1', {
      step: 'external_create', outcome: 'confirmed', externalEvidence: evidence(), expectedRevision: 0,
    })
    expect(advanced.revision).toBe(1)
  })
})

describe('restart recovery', () => {
  it('the journal and unknown steps survive reopening the same database', async () => {
    const { root, projectId, conversationId } = await setup()
    const databasePath = join(root, 'metadata.sqlite')
    const firstMetadata = repositories.splice(0, 1)[0]!
    const serviceA = new ConversationContinuationService(firstMetadata, new ProjectEventHub())
    serviceA.submit(submitInput(projectId, conversationId))
    serviceA.advanceStep(projectId, 'op-1', { step: 'external_create', outcome: 'outcome_unknown' })
    firstMetadata.close()

    const reopened = new SqliteMetadataRepository(databasePath)
    repositories.push(reopened)
    const serviceB = new ConversationContinuationService(reopened, new ProjectEventHub())
    const projection = serviceB.read(projectId, 'op-1')
    expect(projection).toBeDefined()
    expect(projection?.steps.external_create).toBe('outcome_unknown')
    expect(projection?.status).toBe('outcome_unknown')
    expect(projection?.allowedActions.some((action) => action.action === 'reconcile')).toBe(true)
    // 重启后重复 submit 依然幂等：不产生第二次 create。
    const resubmit = serviceB.submit(submitInput(projectId, conversationId))
    expect(resubmit.created).toBe(false)
  })
})

describe('cancel convergence (three-state)', () => {
  it('a journal cancel=outcome_unknown converges to confirmed via reconcile(failed) and is persisted', async () => {
    const { metadata, service, projectId } = await setup()
    // T7 上链形态：外部 cancel 终态未知。service 记账只写 requested；此处模拟 adapter 上链后的行。
    metadata.saveContinuationOperationJournal({
      schemaVersion: 1, operationId: 'op-cancel-unknown', projectId, connectedConversationId: null,
      mode: 'continue_existing', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex',
      steps: { external_create: 'pending', core_bind: 'not_started', attach: 'not_started', projection: 'not_started' },
      cancel: 'outcome_unknown', revision: 2,
      createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z',
    })
    const projected = service.reconcile(projectId, 'op-cancel-unknown', { externalConfirmed: false, errorEvidence: '外部 session 不存在' })
    expect(projected.cancel).toBe('confirmed')
    expect(projected.status).toBe('cancelled')
    expect(projected.allowedActions).toHaveLength(0)
    const persisted = metadata.getContinuationOperationJournal(projectId, 'op-cancel-unknown')!
    expect(persisted.cancel).toBe('confirmed')
    expect(persisted.revision).toBe(3)
  })
})

describe('HTTP route reaches the service', () => {
  it('submit → advance → reconcile end-to-end over fetch, stale rejected with CONFLICT', async () => {
    const { root } = await setup()
    const databasePath = join(root, 'metadata.sqlite')
    repositories.forEach((repo) => { try { repo.close() } catch { /* noop */ } })
    repositories.length = 0

    const metadata = new SqliteMetadataRepository(databasePath)
    repositories.push(metadata)
    const graph = createMvpSampleSnapshot(join(root, 'project-http'), '2026-09-12T00:00:00.000Z')
    metadata.save(graph)
    const httpProjectId = String(graph.project.id)

    const server = createLocalCoreServer({ metadataRepository: metadata })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://127.0.0.1:${address.port}`

    const submitBody = {
      input: { operationId: 'op-http-1', mode: 'continue_existing', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex' },
    }
    const submitResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submitBody),
    })
    expect(submitResponse.status).toBe(201)
    const submitted = (await submitResponse.json() as { value: { projection: { status: string; operationId: string } } }).value.projection
    expect(submitted.operationId).toBe('op-http-1')
    expect(submitted.status).toBe('established')

    // 重复 submit → 200 幂等复用，不再 create
    const dup = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(submitBody),
    })
    expect(dup.status).toBe(200)

    const readResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations/op-http-1`)
    expect(readResponse.status).toBe(200)
    const read = (await readResponse.json() as { value: { revision: number } }).value
    expect(read.revision).toBe(0)

    const advanceResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations/op-http-1/steps`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        input: {
          step: 'external_create', outcome: 'confirmed', expectedRevision: 0,
          externalEvidence: evidence('ext-http'),
        },
      }),
    })
    expect(advanceResponse.status).toBe(200)
    const advanced = (await advanceResponse.json() as { value: { revision: number; status: string } }).value
    expect(advanced.revision).toBe(1)

    // stale action：旧 revision 被拒绝（409 CONFLICT），不产生副作用
    const staleResponse = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations/op-http-1/steps`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        input: { step: 'core_bind', outcome: 'confirmed', expectedRevision: 0 },
      }),
    })
    expect(staleResponse.status).toBe(409)
    const staleBody = await staleResponse.json() as { error?: { code: string } }
    expect(staleBody.error?.code).toBe('CONFLICT')

    // 非法 mode 拒绝（真实运行时校验，非 as 绕过）
    const invalidMode = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        input: { operationId: 'op-bad', mode: 'teleport', contextInheritance: 'inherit', checkout: 'shared', provider: 'codex' },
      }),
    })
    expect(invalidMode.status).toBe(400)

    const malformedEvidence = await fetch(`${baseUrl}/projects/${httpProjectId}/conversation-continuations/op-http-1/steps`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        input: { step: 'core_bind', outcome: 'confirmed', externalEvidence: { provider: 'codex' } },
      }),
    })
    expect(malformedEvidence.status).toBe(400)
  })
})
