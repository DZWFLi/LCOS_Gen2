import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  BridgeTaskEnvelopeV0,
  BridgeTaskIdentity,
} from '../src/runtime-adapter.js'
import { ContextManifestService } from '../src/context-manifest-service.js'
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

class FakeBridge implements BridgeRuntimePort {
  async createTask(envelope: BridgeTaskEnvelopeV0): Promise<BridgeTaskIdentity> {
    return {
      taskId: `task-${envelope.lcosRunId}`,
      lcosRunId: envelope.lcosRunId,
      status: 'assigned',
      requestFingerprint: envelope.requestFingerprint,
      contractVersion: envelope.contractVersion,
    }
  }
  async findTaskByRunId(): Promise<BridgeTaskIdentity | undefined> { return undefined }
  async getResult(): Promise<BridgeResultEnvelopeV0 | undefined> { return undefined }
}

async function startServer() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-selected-nodes-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-selected-nodes-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-27T10:00:00.000Z')
  repository.save(snapshot)
  const review = new RuntimeReviewService(repository, undefined, () => 'sel-one')
  const application = new RuntimeApplicationService(
    repository,
    new ContextManifestService(repository),
    new RuntimeAdapterService(repository, new FakeBridge(), 'mvp-fast-build'),
    new RuntimeResultIngestionService(repository, new FakeBridge()),
    review,
    undefined,
    () => 'sel-one',
  )
  const server = createLocalCoreServer({
    port: 0,
    metadataRepository: repository,
    runtimeReviewService: review,
    runtimeApplicationService: application,
  })
  servers.push(server)
  const address = await server.start()
  return { baseUrl: `http://${address.host}:${address.port}`, snapshot }
}

const HEADERS = { 'content-type': 'application/json' }

async function call(baseUrl: string, path: string, body: unknown, method = 'POST') {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: HEADERS, body: JSON.stringify(body) })
  return { status: response.status, json: await response.json().catch(() => ({})) }
}

describe('run 上下文选中节点 L1 阶梯（P0 接线端到端，20260827）', () => {
  it('run 带 contextArtifactIds → context-prompt 渲染 <selected_nodes> 扫描头', async () => {
    const { baseUrl, snapshot } = await startServer()
    const markdown = snapshot.artifacts.filter((artifact) => artifact.kind === 'markdown')
    expect(markdown.length).toBeGreaterThanOrEqual(2)
    const [first, second] = markdown
    const run = await call(baseUrl, `/projects/${snapshot.project.id}/runs`, {
      instruction: 'Summarize the selected material.',
      outputIntent: 'analyze',
      contextArtifactIds: [String(first.id), String(second.id)],
    })
    expect(run.status).toBe(201)
    const runId = run.json.value?.review?.run?.id
    expect(runId).toBeTruthy()
    const prompt = await call(baseUrl, `/runs/${runId}/context-prompt`, undefined, 'GET')
    expect(prompt.status).toBe(200)
    const tail: string = prompt.json.value.compiledContextPrompt.dynamicTail
    expect(tail).toContain('<selected_nodes>')
    expect(tail).toContain('metadata only')
    // 两个选中节点都以 L1 扫描头出现（label + revision + preview）
    expect(tail.match(/<node /g)?.length).toBeGreaterThanOrEqual(2)
    expect(tail).toContain('revision="')
    // 选中节点排在 Context Delta 之前：先扫选择再读其余
    expect(tail.indexOf('<selected_nodes>')).toBeLessThan(tail.indexOf('## Context Delta'))
    expect(tail).toContain('</selected_nodes>')
  })

  it('无 contextArtifactIds 的 run → 无 <selected_nodes> 段（不伪造选择）', async () => {
    const { baseUrl, snapshot } = await startServer()
    const run = await call(baseUrl, `/projects/${snapshot.project.id}/runs`, {
      instruction: 'Analyze the project.',
      outputIntent: 'analyze',
    })
    expect(run.status).toBe(201)
    const runId = run.json.value?.review?.run?.id
    const prompt = await call(baseUrl, `/runs/${runId}/context-prompt`, undefined, 'GET')
    expect(prompt.status).toBe(200)
    expect(prompt.json.value.compiledContextPrompt.dynamicTail).not.toContain('<selected_nodes>')
  })
})
