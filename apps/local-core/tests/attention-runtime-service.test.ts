import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ActiveContextStore } from '../src/active-context-store.js'
import { AttentionRuntimeService } from '../src/attention-runtime-service.js'
import type { IntelligenceProviderService } from '../src/intelligence-provider-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import type { ProjectSearchService } from '../src/project-search-service.js'
import { SpatialRetrievalService } from '../src/spatial-retrieval-service.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'lcos-b4-attention-'))
  cleanup.push(root)
  const graph = createMvpSampleSnapshot(join(root, 'project'), '2026-08-15T00:00:00.000Z')
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  repository.save(graph)
  const active = new ActiveContextStore(repository)
  const spatial = new SpatialRetrievalService(repository)
  return { graph, repository, active, spatial, projectId: String(graph.project.id), workspaceId: String(graph.workspaces[0]?.id ?? '') }
}

afterEach(async () => {
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

function noModel(): IntelligenceProviderService {
  return { inferIntent: async () => undefined } as unknown as IntelligenceProviderService
}

describe('AttentionRuntimeService B4 contract', () => {
  it('projects WorkState from ActiveContext and lets explicit Intent override inference', async () => {
    const { graph, repository, active, spatial, projectId, workspaceId } = await setup()
    active.update(projectId, graph, {
      workspaceId,
      scopeId: String(graph.scopes[0]?.id ?? ''),
      selectedViewIds: ['view-script'],
      pinnedContextIds: ['view-feedback'],
      excludedContextIds: [],
      lockedContextIds: ['view-brief'],
      currentSurface: 'arrange',
      currentHarness: 'codex',
      explicitIntent: { type: 'revise', goal: '根据最新反馈修改脚本' },
      updatedBy: 'web',
    })
    const service = new AttentionRuntimeService(repository, active, undefined, spatial, noModel())
    const snapshot = await service.snapshot(projectId, { workspaceId })

    expect(snapshot.workState.selectedViewIds).toEqual(['view-script'])
    expect(snapshot.workState.pinnedViewIds).toEqual(['view-feedback'])
    expect(snapshot.workState.lockedViewIds).toEqual(['view-brief'])
    expect(snapshot.workState.currentHarness).toBe('codex')
    expect(snapshot.intent).toMatchObject({ type: 'revise', source: 'explicit', confidenceBand: 'high' })
    expect(snapshot.skillTarget).toMatchObject({ sideEffect: 'LOCAL_MUTATION', requiresApproval: true })
  })

  it('keeps explicit Relation stronger than spatial locality and never reintroduces Excluded refs', async () => {
    const { graph, repository, active, spatial, projectId, workspaceId } = await setup()
    active.update(projectId, graph, {
      workspaceId,
      scopeId: String(graph.scopes[0]?.id ?? ''),
      selectedViewIds: ['view-script'],
      pinnedContextIds: [],
      excludedContextIds: ['view-feedback'],
      currentSurface: 'arrange',
      updatedBy: 'web',
    })
    const service = new AttentionRuntimeService(repository, active, undefined, spatial, noModel())
    const attention = await service.attention(projectId, { workspaceId, explicitAction: '理解当前脚本' })
    const all = [...attention.selected, ...attention.pinned, ...attention.related, ...attention.retrieved]
    const brief = attention.related.find((item) => item.viewId === 'view-brief')

    expect(brief?.source).toBe('explicit_relation')
    expect(all.some((item) => item.viewId === 'view-feedback')).toBe(false)
  })

  it('lets Intent retrieval compete with weak spatial evidence inside the same optional token budget', async () => {
    const { graph, repository, active, spatial, projectId, workspaceId } = await setup()
    active.update(projectId, graph, {
      workspaceId,
      scopeId: String(graph.scopes[0]?.id ?? ''),
      selectedViewIds: ['view-script'],
      pinnedContextIds: [],
      excludedContextIds: [],
      currentSurface: 'arrange',
      updatedBy: 'web',
    })
    const search = {
      search: async () => ({
        schemaVersion: 0 as const,
        query: '研究 Reference',
        hits: [{ entityType: 'artifact' as const, entityId: 'artifact-reference', viewId: 'view-reference', title: 'Reference', snippet: 'intent specific', source: 'artifact-title' as const, score: 100 }],
        truncated: false,
        generatedAt: '2026-08-15T00:00:00.000Z',
      }),
    } as unknown as ProjectSearchService
    const service = new AttentionRuntimeService(repository, active, search, spatial, noModel())
    const snapshot = await service.snapshot(projectId, { workspaceId, explicitAction: '研究 Reference', tokenBudget: 300 })

    expect(snapshot.attention.retrieved.some((item) => item.viewId === 'view-reference')).toBe(true)
    expect(snapshot.contextPack.items.some((item) => item.bucket === 'retrieved' && item.viewId === 'view-reference')).toBe(true)
    expect(snapshot.contextPack.estimatedTokens).toBeLessThanOrEqual(snapshot.contextPack.tokenBudget)
  })

  it('shares one in-flight model decision and ignores viewport-only changes in the semantic fingerprint', async () => {
    const { graph, repository, active, spatial, projectId, workspaceId } = await setup()
    active.update(projectId, graph, {
      workspaceId,
      scopeId: String(graph.scopes[0]?.id ?? ''),
      selectedViewIds: ['view-script'],
      pinnedContextIds: [],
      excludedContextIds: [],
      currentSurface: 'arrange',
      updatedBy: 'web',
    })
    let calls = 0
    const intelligence = {
      inferIntent: async () => {
        calls += 1
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { type: 'understand' as const, goal: '理解脚本', constraints: [], confidence: 0.75, providerId: 'deepseek', model: 'test-model' }
      },
    } as unknown as IntelligenceProviderService
    const service = new AttentionRuntimeService(repository, active, undefined, spatial, intelligence)

    const [first, second] = await Promise.all([
      service.resolveIntent(projectId, { workspaceId }),
      service.attention(projectId, { workspaceId }),
    ])
    expect(first.source).toBe('model')
    expect(second.selected.length).toBeGreaterThan(0)
    expect(calls).toBe(1)
    const fingerprint = service.workState(projectId, workspaceId).semanticFingerprint

    const current = active.get(projectId, graph, workspaceId)
    active.update(projectId, graph, {
      workspaceId,
      scopeId: current.scopeId ?? '',
      selectedViewIds: current.selectedViewIds,
      pinnedContextIds: current.pinnedContextIds,
      excludedContextIds: current.excludedContextIds,
      lockedContextIds: current.lockedContextIds ?? [],
      viewport: { x: 900, y: 400, zoom: 0.8 },
      visibleViewIds: current.selectedViewIds,
      updatedBy: 'web',
      expectedVersion: current.version,
    })
    await service.resolveIntent(projectId, { workspaceId })
    expect(service.workState(projectId, workspaceId).semanticFingerprint).toBe(fingerprint)
    expect(calls).toBe(1)
  })

  it('creates resumable candidates and suppresses a candidate after the user says later', async () => {
    const { graph, repository, active, spatial, projectId, workspaceId } = await setup()
    active.update(projectId, graph, {
      workspaceId,
      scopeId: String(graph.scopes[0]?.id ?? ''),
      selectedViewIds: ['view-script'],
      pinnedContextIds: ['view-feedback'],
      excludedContextIds: [],
      explicitIntent: { type: 'revise', goal: '继续修改脚本' },
      updatedBy: 'web',
    })
    const service = new AttentionRuntimeService(repository, active, undefined, spatial, noModel())
    const first = await service.snapshot(projectId, { workspaceId })
    const resume = first.candidates.find((item) => item.type === 'resume')
    expect(resume).toBeDefined()
    service.dismissCandidate(projectId, workspaceId, resume!.key)
    const second = await service.snapshot(projectId, { workspaceId })
    expect(second.candidates.some((item) => item.key === resume!.key)).toBe(false)
  })
})
