import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  BridgeTaskEnvelopeV0,
  BridgeTaskIdentity,
} from '../src/runtime-adapter.js'
import type { Artifact, ArtifactReturn, ArtifactRevision, FileRecord } from '@local-creative-os/domain'
import { ContextManifestService } from '../src/context-manifest-service.js'
import { ConversationImportService } from '../src/conversation-import-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { RuntimeAdapterService } from '../src/runtime-adapter.js'
import { RuntimeApplicationService } from '../src/runtime-application-service.js'
import { RuntimeResultIngestionService } from '../src/runtime-result-ingestion.js'
import { RuntimeReviewService } from '../src/runtime-review-service.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []
const importers: ConversationImportService[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const importer of importers.splice(0)) importer.close()
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

/** 桥返回带 sessionId —— RuntimeBinding.externalSessionId 的真实来源（runtime-adapter bind 回绑）。 */
class SessionBridge implements BridgeRuntimePort {
  constructor(private readonly sessionId: string) {}
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    return {
      taskId: `task-${envelope.lcosRunId}`,
      lcosRunId: envelope.lcosRunId,
      status: 'assigned',
      requestFingerprint: envelope.requestFingerprint,
      contractVersion: envelope.contractVersion,
      sessionId: this.sessionId,
    }
  }
  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> { return undefined }
  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> { return undefined }
}

async function startServer(sessionId = 'codex-sess-42') {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-identity-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-identity-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-27T14:00:00.000Z')
  repository.save(snapshot)
  const review = new RuntimeReviewService(repository, undefined, () => 'identity-one')
  const application = new RuntimeApplicationService(
    repository,
    new ContextManifestService(repository),
    new RuntimeAdapterService(repository, new SessionBridge(sessionId), 'mvp-fast-build'),
    new RuntimeResultIngestionService(repository, new SessionBridge(sessionId)),
    review,
    undefined,
    () => 'identity-one',
  )
  const server = createLocalCoreServer({
    port: 0,
    metadataRepository: repository,
    runtimeReviewService: review,
    runtimeApplicationService: application,
  })
  servers.push(server)
  const address = await server.start()
  // 测试侧自带 importer（与 compose 实例共库；WAL 多连接安全）——importManual 造导入会话。
  importers.push(new ConversationImportService(repository))
  return {
    baseUrl: `http://${address.host}:${address.port}`,
    repository,
    importer: importers.at(-1)!,
    projectId: String(snapshot.project.id),
    scopeId: `scope-${String(snapshot.project.id)}-root`,
  }
}

const HEADERS = { 'content-type': 'application/json' }

async function call(baseUrl: string, path: string, body?: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

async function connectConversation(baseUrl: string, projectId: string, conversationRef: string) {
  const result = await call(baseUrl, `/projects/${projectId}/connected-conversations`, {
    action: 'connect',
    provider: 'workbuddy',
    executorId: 'executor-1',
    conversationRef,
    label: '承接会话',
  })
  expect(result.status).toBe(201)
  return result.json.value as { id: string; conversationRef: string }
}

describe('Conversation Identity Bridge（P0 · canonical 身份链）', () => {
  it('未链接 = 诚实缺席：identity 链上 conversationSession/view 全 undefined，不猜', async () => {
    const { baseUrl, projectId } = await startServer()
    const cc = await connectConversation(baseUrl, projectId, 'codex-sess-42')
    const identity = await call(baseUrl, `/projects/${projectId}/connected-conversations/${cc.id}/identity`, undefined, 'GET')
    expect(identity.status).toBe(200)
    expect(identity.json.value.connectedConversation.id).toBe(cc.id)
    expect(identity.json.value.conversationSession).toBeUndefined()
    expect(identity.json.value.conversationArtifactId).toBeUndefined()
    expect(identity.json.value.conversationViewId).toBeUndefined()
  })

  it('link-session 建链 → 链上出现 session + artifact + view；链是唯一写路径', async () => {
    const { baseUrl, projectId, repository, importer, scopeId } = await startServer()
    const cc = await connectConversation(baseUrl, projectId, 'codex-sess-42')
    const imported = await importer.importManual(projectId, {
      title: '设计讨论',
      scopeId,
      entries: [
        { role: 'user', contentText: '给我三个方向' },
        { role: 'assistant', contentText: '方向一：装配台隐喻。' },
      ],
    })
    expect(imported.session.conversationArtifactId).toBeTruthy()
    expect(imported.session.conversationViewId).toBeTruthy()

    // bogus session → 404；正确 session → 200 全链
    const bad = await call(baseUrl, `/projects/${projectId}/connected-conversations/${cc.id}/link-session`, { conversationSessionId: 'conversation-nope' })
    expect(bad.status).toBe(404)
    const linked = await call(baseUrl, `/projects/${projectId}/connected-conversations/${cc.id}/link-session`, { conversationSessionId: imported.session.id })
    expect(linked.status).toBe(200)
    expect(linked.json.value.conversationSession.id).toBe(imported.session.id)
    expect(linked.json.value.conversationArtifactId).toBe(imported.session.conversationArtifactId)
    expect(linked.json.value.conversationViewId).toBe(imported.session.conversationViewId)

    // 幂等 connect 刷新不清链接
    const again = await connectConversation(baseUrl, projectId, 'codex-sess-42')
    expect(again.id).toBe(cc.id)
    const identity = await call(baseUrl, `/projects/${projectId}/connected-conversations/${cc.id}/identity`, undefined, 'GET')
    expect(identity.json.value.conversationSession.id).toBe(imported.session.id)
    expect(repository.getConnectedConversation(projectId, cc.id)?.conversationSessionId).toBe(imported.session.id)
  })

  it('active-receiver-identity：无 active=null；设 active 后全链可达（含 lifecycle 投影）', async () => {
    const { baseUrl, projectId, importer, scopeId } = await startServer()
    const before = await call(baseUrl, `/projects/${projectId}/active-receiver-identity`, undefined, 'GET')
    expect(before.status).toBe(200)
    expect(before.json.value.activeReceiverId).toBeNull()

    const cc = await connectConversation(baseUrl, projectId, 'codex-sess-42')
    const imported = await importer.importManual(projectId, {
      title: '承接现场',
      scopeId,
      entries: [{ role: 'user', contentText: '继续' }, { role: 'assistant', contentText: '好' }],
    })
    await call(baseUrl, `/projects/${projectId}/connected-conversations/${cc.id}/link-session`, { conversationSessionId: imported.session.id })

    // run 创建 → lifecycle 行（workbuddy connecting）
    const run = await call(baseUrl, `/projects/${projectId}/runs`, { instruction: 'Analyze.', outputIntent: 'analyze' })
    expect(run.status).toBe(201)

    const binding = await call(baseUrl, `/projects/${projectId}/receiver-binding`, { connectedConversationId: cc.id })
    expect(binding.status).toBe(200)
    const active = await call(baseUrl, `/projects/${projectId}/active-receiver-identity`, undefined, 'GET')
    expect(active.json.value.activeReceiverId).toBe(cc.id)
    expect(active.json.value.chain.connectedConversation.id).toBe(cc.id)
    expect(active.json.value.chain.conversationViewId).toBe(imported.session.conversationViewId)
    expect(active.json.value.chain.lifecycle.phase).toBe('connecting')
  })
})

describe('Artifact Birth Provenance（P0 · 出生谱系全链）', () => {
  it('run 诞生 artifact → birth 全链：run → binding(externalSessionId) → connectedConversation(ref 唯一命中) → session → view', async () => {
    const { baseUrl, projectId, repository, importer, scopeId } = await startServer('codex-sess-42')
    // ① run + dispatch（桥回绑 externalSessionId）
    const run = await call(baseUrl, `/projects/${projectId}/runs`, { instruction: 'Create a brief.', outputIntent: 'create' })
    const runId = run.json.value?.review?.run?.id as string
    const dispatch = await call(baseUrl, `/runs/${runId}/dispatch`, {})
    expect(dispatch.status).toBe(200)
    // ② 承接会话（conversationRef = externalSessionId）+ 导入会话 + 链接
    const cc = await connectConversation(baseUrl, projectId, 'codex-sess-42')
    const imported = await importer.importManual(projectId, {
      title: '出生现场',
      scopeId,
      entries: [{ role: 'user', contentText: '写个 brief' }, { role: 'assistant', contentText: '好的' }],
    })
    await call(baseUrl, `/projects/${projectId}/connected-conversations/${cc.id}/link-session`, { conversationSessionId: imported.session.id })

    // ③ 复刻 ingestion 诞生路径：fileRecord + 无 current 的 artifact + draft revision + return
    const now = new Date().toISOString()
    const bornPath = join(roots.at(-1)!, 'born-brief.md')
    writeFileSync(bornPath, '# Brief\n\nagent 产出', 'utf8')
    const fileRecord: FileRecord = {
      id: 'file-born-1' as never,
      projectId: projectId as never,
      observedPath: bornPath,
      observedHash: 'hash-born-1' as never,
      size: 20,
      modifiedAt: now,
      mimeType: 'text/markdown',
      availability: 'current',
      observedAt: now,
    }
    const artifact: Artifact = {
      id: 'artifact-born-1' as never,
      projectId: projectId as never,
      title: 'born-brief.md',
      kind: 'markdown',
      availability: 'available',
      createdAt: now,
      updatedAt: now,
    }
    const draft: ArtifactRevision = {
      id: 'revision-born-1' as never,
      artifactId: artifact.id,
      fileRecordId: fileRecord.id,
      contentHash: 'hash-born-1' as never,
      source: 'run',
      runId: runId as never,
      status: 'draft',
      createdAt: now,
    }
    const artifactReturn: ArtifactReturn = {
      id: 'return-born-1' as never,
      runId: runId as never,
      targetArtifactId: artifact.id,
      baseRevisionId: draft.id,
      returnedFileId: fileRecord.id,
      contentHash: 'hash-born-1' as never,
      canonicalPath: bornPath,
      action: 'created',
      status: 'pending_review',
      draftRevisionId: draft.id,
      createdAt: now,
      updatedAt: now,
    }
    repository.createRuntimeCreatedArtifact(fileRecord, artifact, draft, artifactReturn)
    const accepted = repository.acceptArtifactReturn(artifactReturn.id, draft.id, now)
    expect(accepted.artifactReturn.status).toBe('adopted')

    // ④ birth 全链解析
    const birth = await call(baseUrl, `/projects/${projectId}/artifacts/${String(artifact.id)}/birth`, undefined, 'GET')
    expect(birth.status).toBe(200)
    const value = birth.json.value
    expect(value.origin).toBe('run-return')
    expect(value.birthRunId).toBe(runId)
    expect(value.run.id).toBe(runId)
    expect(typeof value.run.status).toBe('string')
    expect(value.runtimeBinding.externalSessionId).toBe('codex-sess-42')
    expect(value.connectedConversation.id).toBe(cc.id)
    expect(value.conversationSession.id).toBe(imported.session.id)
    expect(value.conversationViewId).toBe(imported.session.conversationViewId)
  })

  it('GUI 直建 artifact → origin=unknown，birthRunId 诚实缺席；未知 artifact → 404', async () => {
    const { baseUrl, projectId } = await startServer()
    const created = await call(baseUrl, `/projects/${projectId}/curation/text`, { scopeId: `scope-${projectId}-root`, title: '手写', body: '用户手写' })
    expect(created.status).toBe(200)
    const birth = await call(baseUrl, `/projects/${projectId}/artifacts/${created.json.value.artifactId}/birth`, undefined, 'GET')
    expect(birth.status).toBe(200)
    expect(birth.json.value.origin).toBe('unknown')
    expect(birth.json.value.birthRunId).toBeUndefined()
    const missing = await call(baseUrl, `/projects/${projectId}/artifacts/artifact-nope/birth`, undefined, 'GET')
    expect(missing.status).toBe(404)
  })
})
