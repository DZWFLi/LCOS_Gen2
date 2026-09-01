import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { CapturePlacementService } from '../src/capture-placement-service.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

async function setup(): Promise<{ repository: SqliteMetadataRepository; projectId: string; scopeId: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'lcos-placement-'))
  cleanup.push(dir)
  const repository = new SqliteMetadataRepository(join(dir, 'metadata.sqlite'))
  repositories.push(repository)
  const now = '2026-08-11T00:00:00.000Z'
  const projectId = 'project-placement'
  const scopeId = 'scope-root'
  const snapshot = {
    schemaVersion: 32,
    graphVersion: 1 as const,
    project: { id: projectId, name: 'Placement', rootPath: 'probe://placement', graphVersion: 1 as const, createdAt: now, updatedAt: now },
    scopes: [{ id: scopeId, projectId, parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now }],
    workspaces: [],
    artifacts: [],
    fileRecords: [],
    artifactRevisions: [],
    artifactViews: [],
    relations: [],
    notes: [],
    checkpoints: [],
  }
  repository.save(snapshot as never)
  return { repository, projectId, scopeId }
}

afterEach(async () => {
  for (const repository of repositories.splice(0)) {
    try { repository.close() } catch { /* already closed */ }
  }
  for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => { /* best effort */ })
})

describe('CapturePlacementService (GUI-3)', () => {
  it('starts at the default anchor on an empty scope', async () => {
    const { repository, projectId, scopeId } = await setup()
    const service = new CapturePlacementService(repository)
    expect(service.place({ projectId, scopeId })).toEqual({ x: 180, y: 160 })
  })

  it('never overlaps across 20 consecutive placements', async () => {
    const { repository, projectId, scopeId } = await setup()
    const service = new CapturePlacementService(repository)
    const placed: Array<{ x: number; y: number }> = []
    const width = 280
    const height = 190
    const gap = 24
    for (let index = 0; index < 20; index += 1) {
      const point = service.place({ projectId, scopeId, width, height })
      for (const existing of placed) {
        const overlap = !(point.x + width + gap <= existing.x
          || existing.x + width + gap <= point.x
          || point.y + height + gap <= existing.y
          || existing.y + height + gap <= point.y)
        expect(overlap, `placement ${index} overlaps at ${JSON.stringify(point)}`).toBe(false)
      }
      placed.push(point)
      // 模拟本次放置落库（供下一次碰撞检测使用）：artifact + view。
      repository.upsertArtifact({
        id: `artifact-capture-${index}`,
        projectId,
        title: `Capture ${index}`,
        kind: 'image',
        availability: 'available',
        createdAt: '2026-08-11T00:00:00.000Z',
        updatedAt: '2026-08-11T00:00:00.000Z',
      })
      repository.upsertArtifactView({
        id: `view-capture-${index}`,
        artifactId: `artifact-capture-${index}`,
        revisionId: undefined,
        scopeId,
        referenceKind: 'primary',
        position: point,
        size: { width, height },
        displayMode: 'card',
        collapsed: false,
      })
    }
    // 位置应各不相同
    expect(new Set(placed.map((point) => `${point.x},${point.y}`)).size).toBe(20)
  })

  it('anchors from the last placed view (cluster anchor)', async () => {
    const { repository, projectId, scopeId } = await setup()
    repository.upsertArtifact({
      id: 'artifact-a',
      projectId,
      title: 'A',
      kind: 'text',
      availability: 'available',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    })
    repository.upsertArtifactView({
      id: 'view-a',
      artifactId: 'artifact-a',
      revisionId: undefined,
      scopeId,
      referenceKind: 'primary',
      position: { x: 300, y: 200 },
      size: { width: 280, height: 190 },
      displayMode: 'card',
      collapsed: false,
    })
    const service = new CapturePlacementService(repository)
    const point = service.place({ projectId, scopeId })
    // 在 (300+280, 200+190) = (580, 390) 右下展开，不与既有视图重叠
    expect(point.x).toBeGreaterThanOrEqual(580)
    expect(point.y).toBeGreaterThanOrEqual(390)
    const overlap = !(point.x + 280 + 24 <= 300 || 300 + 280 + 24 <= point.x || point.y + 190 + 24 <= 200 || 200 + 190 + 24 <= point.y)
    expect(overlap).toBe(false)
  })
})
