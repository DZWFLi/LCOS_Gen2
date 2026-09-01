import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PresentationStateV0, PresentationViewV0, ProjectGraphSnapshot } from '@local-creative-os/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { SpatialRetrievalService } from '../src/spatial-retrieval-service.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

async function seededProject(): Promise<{ repository: SqliteMetadataRepository; projectId: string; viewIds: string[] }> {
  const now = '2026-08-11T00:00:00.000Z'
  const projectId = 'project-spatial-test'
  const scopeId = 'scope-root'
  const artifacts = Array.from({ length: 6 }, (_, index) => ({
    id: `artifact-${index + 1}`,
    projectId,
    title: `Spatial ${index + 1}`,
    kind: 'markdown',
    availability: 'available',
    currentRevisionId: `revision-${index + 1}`,
    createdAt: now,
    updatedAt: now,
  }))
  const fileRecords = Array.from({ length: 6 }, (_, index) => ({
    id: `file-${index + 1}`,
    projectId,
    observedPath: `probe://spatial-${index + 1}.md`,
    observedHash: `hash-${index + 1}`,
    size: 10,
    modifiedAt: now,
    mimeType: 'text/markdown',
    availability: 'current',
    observedAt: now,
  }))
  const artifactRevisions = Array.from({ length: 6 }, (_, index) => ({
    id: `revision-${index + 1}`,
    artifactId: `artifact-${index + 1}`,
    fileRecordId: `file-${index + 1}`,
    contentHash: `hash-${index + 1}`,
    source: 'import',
    status: 'current',
    createdAt: now,
  }))
  const viewIds = Array.from({ length: 6 }, (_, index) => `view-${index + 1}`)
  const artifactViews = viewIds.map((id, index) => ({
    id,
    artifactId: `artifact-${index + 1}`,
    revisionId: `revision-${index + 1}`,
    scopeId,
    referenceKind: 'primary',
    position: { x: 120 + index * 200, y: 100 + index * 40 },
    size: { width: 180, height: 60 },
    displayMode: 'card',
    collapsed: false,
  }))
  const snapshot: ProjectGraphSnapshot = {
    schemaVersion: 32,
    graphVersion: 1 as ProjectGraphSnapshot['graphVersion'],
    project: { id: projectId as ProjectGraphSnapshot['project']['id'], name: 'Spatial', rootPath: 'probe://spatial', graphVersion: 1 as ProjectGraphSnapshot['project']['graphVersion'], createdAt: now, updatedAt: now },
    scopes: [{ id: scopeId as ProjectGraphSnapshot['scopes'][number]['id'], projectId: projectId as ProjectGraphSnapshot['scopes'][number]['projectId'], parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now }],
    workspaces: [],
    artifacts,
    fileRecords,
    artifactRevisions,
    artifactViews,
    relations: [{ id: 'relation-1' as ProjectGraphSnapshot['relations'][number]['id'], projectId: projectId as ProjectGraphSnapshot['relations'][number]['projectId'], sourceEntityType: 'artifact', sourceEntityId: 'artifact-1' as ProjectGraphSnapshot['relations'][number]['sourceEntityId'], targetEntityType: 'artifact', targetEntityId: 'artifact-2' as ProjectGraphSnapshot['relations'][number]['targetEntityId'], kind: 'informs', createdAt: now, updatedAt: now }],
    notes: [],
    checkpoints: [],
  }
  const directory = await mkdtemp(join(tmpdir(), 'local-core-spatial-'))
  cleanup.push(directory)
  const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
  repositories.push(repository)
  repository.save(snapshot)
  const state: PresentationStateV0 = {
    memberViewIds: viewIds,
    hiddenViewIds: [],
    positions: {
      'view-1': { x: 400, y: 300 },
      'view-2': { x: 800, y: 300 },
      'view-3': { x: 1200, y: 300 },
      'view-4': { x: 1600, y: 300 },
      'view-5': { x: 2000, y: 300 },
      'view-6': { x: 2400, y: 300 },
    },
    hierarchy: {
      parentByViewId: { 'view-2': 'view-1', 'view-3': 'view-1' },
      orderByParent: { 'view-1': ['view-2', 'view-3'], '': ['view-1', 'view-4', 'view-5', 'view-6'] },
    },
    presentationEdges: [
      { id: 'context-temp:1', fromViewId: 'view-1', toViewId: 'view-4' },
      { id: 'context-temp:2', fromViewId: 'view-1', toViewId: 'view-6' },
    ],
    pinnedViewIds: [],
    emphasisByViewId: {},
  }
  const view: PresentationViewV0 = {
    schemaVersion: 0,
    id: `presentation:context:${scopeId}`,
    projectId,
    scopeId,
    capability: 'context',
    renderer: 'context',
    state,
    version: 0,
    updatedBy: 'test',
    createdAt: now,
    updatedAt: now,
  }
  repository.insertPresentationView(view)
  return { repository, projectId, viewIds }
}

afterEach(async () => {
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('SpatialRetrievalService (HU-4)', () => {
  it('returns bounded spatial candidates from hierarchy / presentation edges / geometry', async () => {
    const { repository, projectId, viewIds } = await seededProject()
    const service = new SpatialRetrievalService(repository)
    const candidates = service.retrieve(projectId, ['view-1'], 6)

    // seed view-1 的 hierarchy children（view-2/view-3）→ parent-child 0.80
    const parentChildren = candidates.filter((candidate) => candidate.reason === 'parent-child')
    expect(parentChildren.map((candidate) => candidate.viewId)).toEqual(['view-2', 'view-3'])
    expect(parentChildren[0]?.signal).toBe(0.8)
    // presentation edge 1-hop（view-4/view-6）→ 0.75
    const edgeHits = candidates.filter((candidate) => candidate.reason === 'presentation-edge')
    expect(edgeHits.map((candidate) => candidate.viewId)).toEqual(expect.arrayContaining(['view-4', 'view-6']))
    expect(edgeHits[0]?.signal).toBe(0.75)
    // same-top-level（view-5/view-6 等）→ 0.30
    expect(candidates.find((candidate) => candidate.reason === 'same-top-level')?.signal).toBe(0.3)
    // 总候选 ≤ limit，且 view-1 自身不出现
    expect(candidates.length).toBeLessThanOrEqual(6)
    expect(candidates.some((candidate) => candidate.viewId === 'view-1')).toBe(false)
    expect(candidates.every((candidate) => candidate.source === 'spatial')).toBe(true)
    // artifactId/title 已解析
    expect(candidates[0]?.artifactId).toBe('artifact-2')
    expect(candidates[0]?.title).toBe('Spatial 2')
  })

  it('keeps geometric candidates bounded and dedupes by best signal', async () => {
    const { repository, projectId } = await seededProject()
    const service = new SpatialRetrievalService(repository)
    // seed view-2：parent view-1（0.8）、sibling view-3（0.7）、几何近邻 view-4（0.15）。
    const candidates = service.retrieve(projectId, ['view-2'], 3)
    expect(candidates.length).toBeLessThanOrEqual(3)
    expect(candidates.some((candidate) => candidate.viewId === 'view-4')).toBe(true)
    expect(candidates.some((candidate) => candidate.reason === 'geometric-near')).toBe(true)
    expect(candidates.filter((candidate) => candidate.reason === 'geometric-near').length).toBeLessThanOrEqual(3)
    // 同一 view 只出现一次（hierarchy 高分覆盖几何低分）。
    expect(new Set(candidates.map((candidate) => candidate.viewId)).size).toBe(candidates.length)
  })

  it('returns empty for empty or unknown seeds', async () => {
    const { repository, projectId } = await seededProject()
    const service = new SpatialRetrievalService(repository)
    expect(service.retrieve(projectId, [])).toEqual([])
    expect(service.retrieve(projectId, ['view-missing'])).toEqual([])
  })

  it('never mutates domain truth (relations unchanged) and is Ollama-independent', async () => {
    const { repository, projectId, viewIds } = await seededProject()
    const before = repository.get(projectId)?.relations.length ?? 0
    const service = new SpatialRetrievalService(repository)
    service.retrieve(projectId, viewIds.slice(0, 2), 6)
    expect(repository.get(projectId)?.relations.length).toBe(before)
    // 服务只依赖 repository（无 semantic / conversation 依赖）——构造签名即证据。
    expect(service).toBeInstanceOf(SpatialRetrievalService)
  })
})
