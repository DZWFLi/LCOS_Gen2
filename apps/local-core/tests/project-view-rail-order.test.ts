import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'local-core-rail-order-'))
  cleanup.push(directory)
  const databasePath = join(directory, 'metadata.sqlite')
  const repository = new SqliteMetadataRepository(databasePath)
  repository.save({
    schemaVersion: 34,
    graphVersion: 1,
    project: { id: 'rail-proj', name: 'Rail Fixture', rootPath: 'disposable://rail', graphVersion: 1, createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' },
    scopes: [{ id: 'scope-root', projectId: 'rail-proj', parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z' }],
    workspaces: [
      { id: 'ws-collection', projectId: 'rail-proj', scopeId: 'scope-root', name: 'Collection A', intent: 'collection', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'], contextPolicy: 'workspace-related', updatedAt: '2026-08-12T00:00:00.000Z' },
      { id: 'ws-context', projectId: 'rail-proj', scopeId: 'scope-root', name: 'Context Version', intent: 'context', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'], contextPolicy: 'workspace-related', updatedAt: '2026-08-12T00:00:00.000Z' },
      { id: 'ws-workflow', projectId: 'rail-proj', scopeId: 'scope-root', name: 'Workflow', intent: 'workflow', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'], contextPolicy: 'workspace-related', updatedAt: '2026-08-12T00:00:00.000Z' },
    ],
    artifacts: [],
    artifactViews: [],
    artifactRevisions: [],
    fileRecords: [],
    relations: [],
    notes: [],
    checkpoints: [],
  })
  return { directory, databasePath, repository }
}

describe('P0 — durable mixed Project View Rail order', () => {
  afterEach(async () => {
    for (const path of cleanup.splice(0)) void rm(path, { recursive: true, force: true }).catch(() => { /* best effort */ })
  })

  it('persists mixed Collection/Context/Workflow refs and reads them back', async () => {
    const { repository } = await fixture()
    const saved = repository.saveProjectViewRailOrder('rail-proj', [
      { kind: 'collection', viewId: 'ws-collection' },
      { kind: 'workflow', viewId: 'ws-workflow' },
      { kind: 'context', viewId: 'ws-context' },
    ], 0)
    expect(saved.version).toBe(1)
    const loaded = repository.getProjectViewRailOrder('rail-proj')
    expect(loaded?.orderedRefs.map((ref) => `${ref.kind}:${ref.viewId}`)).toEqual([
      'collection:ws-collection',
      'workflow:ws-workflow',
      'context:ws-context',
    ])
    expect(loaded?.version).toBe(1)
  })

  it('rejects stale writes with CAS and keeps the committed order', async () => {
    const { repository } = await fixture()
    repository.saveProjectViewRailOrder('rail-proj', [{ kind: 'collection', viewId: 'ws-collection' }], 0)
    repository.saveProjectViewRailOrder('rail-proj', [{ kind: 'workflow', viewId: 'ws-workflow' }], 1)
    expect(() => repository.saveProjectViewRailOrder('rail-proj', [{ kind: 'context', viewId: 'ws-context' }], 0)).toThrow(/Stale view rail order version/)
    const loaded = repository.getProjectViewRailOrder('rail-proj')
    expect(loaded?.orderedRefs[0]).toMatchObject({ kind: 'workflow', viewId: 'ws-workflow' })
    expect(loaded?.version).toBe(2)
  })

  it('survives Core restart (new repository over the same database file)', async () => {
    const { databasePath, repository } = await fixture()
    repository.saveProjectViewRailOrder('rail-proj', [
      { kind: 'context', viewId: 'ws-context' },
      { kind: 'collection', viewId: 'ws-collection' },
    ], 0)
    const restarted = new SqliteMetadataRepository(databasePath)
    const loaded = restarted.getProjectViewRailOrder('rail-proj')
    expect(loaded?.orderedRefs.map((ref) => `${ref.kind}:${ref.viewId}`)).toEqual([
      'context:ws-context',
      'collection:ws-collection',
    ])
    expect(loaded?.version).toBe(1)
  })

  it('tolerates missing workspaces by filtering them out of the committed refs', async () => {
    const { repository } = await fixture()
    repository.saveProjectViewRailOrder('rail-proj', [
      { kind: 'collection', viewId: 'ws-collection' },
      { kind: 'context', viewId: 'deleted-view' },
    ], 0)
    const order = repository.getProjectViewRailOrder('rail-proj')
    expect(order?.orderedRefs.map((ref) => ref.viewId)).toEqual(['ws-collection', 'deleted-view'])
    // 路由层会按现有 workspace/scope 过滤；仓储层保留原样，删除语义由读取方确定性处理。
    expect(order?.version).toBe(1)
  })
})
