import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseRailwayStoredRefV1, railwayStableKeyV1 } from '@local-creative-os/contracts'
import { RailwayDestinationService } from '../src/railway-destination-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'

const cleanup: string[] = []
const repositories: SqliteMetadataRepository[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'local-core-rail-spatial-'))
  cleanup.push(directory)
  const repository = new SqliteMetadataRepository(join(directory, 'metadata.sqlite'))
  repositories.push(repository)
  const now = '2026-10-07T00:00:00.000Z'
  repository.save({
    schemaVersion: 34,
    graphVersion: 1,
    project: { id: 'rail-spatial-project', name: 'Rail Spatial Fixture', rootPath: 'disposable://rail-spatial', graphVersion: 1, createdAt: now, updatedAt: now },
    scopes: [
      { id: 'scope-root', projectId: 'rail-spatial-project', parentScopeId: null, containerViewId: null, kind: 'root', name: 'Root', createdAt: now, updatedAt: now },
      { id: 'scope-context', projectId: 'rail-spatial-project', parentScopeId: 'scope-root', containerViewId: null, kind: 'context', name: '研究脉络', createdAt: now, updatedAt: now },
      { id: 'scope-workflow', projectId: 'rail-spatial-project', parentScopeId: 'scope-root', containerViewId: null, kind: 'workflow', name: '交付流程', createdAt: now, updatedAt: now },
      { id: 'scope-temporary', projectId: 'rail-spatial-project', parentScopeId: 'scope-root', containerViewId: null, kind: 'temporary-workbench', name: '临时工作台', createdAt: now, updatedAt: now },
    ],
    collections: [{ id: 'collection-refs', projectId: 'rail-spatial-project', title: '参考集合', createdAt: now, updatedAt: now }],
    workspaces: [
      { id: 'workspace-main', projectId: 'rail-spatial-project', scopeId: 'scope-root', name: 'Main', intent: 'understand', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'], contextPolicy: 'workspace-related', preferredSurface: 'main', canvasId: 'canvas-main', updatedAt: now },
      { id: 'workspace-context-root', projectId: 'rail-spatial-project', scopeId: 'scope-root', name: 'Context Root', intent: 'understand', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'], contextPolicy: 'workspace-related', preferredSurface: 'context', canvasId: 'canvas-context-root', updatedAt: now },
      { id: 'workspace-workflow-root', projectId: 'rail-spatial-project', scopeId: 'scope-root', name: 'Workflow Root', intent: 'build', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'], contextPolicy: 'workspace-related', preferredSurface: 'workflow', canvasId: 'canvas-workflow-root', updatedAt: now },
      { id: 'workspace-context-child', projectId: 'rail-spatial-project', scopeId: 'scope-context', name: '研究画布', intent: 'understand', viewport: { x: 0, y: 0, zoom: 1 }, focusedViewIds: [], visibleLayers: ['core'], contextPolicy: 'workspace-related', preferredSurface: 'context', canvasId: 'canvas-context-child', updatedAt: now },
    ],
    artifacts: [], artifactViews: [], relations: [], notes: [], artifactRevisions: [], fileRecords: [], checkpoints: [],
  })
  repository.runCurationMutation({projectId:'rail-spatial-project',collectionAdds:[{
    id:'collection-refs',projectId:'rail-spatial-project',title:'参考集合',createdAt:now,updatedAt:now,
  }]})
  return { repository, service: new RailwayDestinationService(repository), projectId: 'rail-spatial-project' }
}

afterEach(async () => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const path of cleanup.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('Railway canonical spatial destinations', () => {
  it('strictly parses and keys Collection and Scope identities by entity type and project', () => {
    const collectionRef = { kind: 'spatial', projectId: 'rail-spatial-project', entityType: 'collection', entityId: 'same-id' } as const
    const scopeRef = { kind: 'spatial', projectId: 'rail-spatial-project', entityType: 'scope', entityId: 'same-id' } as const
    expect(parseRailwayStoredRefV1(collectionRef, 'rail-spatial-project')).toEqual(collectionRef)
    expect(parseRailwayStoredRefV1(scopeRef, 'rail-spatial-project')).toEqual(scopeRef)
    expect(railwayStableKeyV1(collectionRef)).not.toBe(railwayStableKeyV1(scopeRef))
    expect(parseRailwayStoredRefV1({ ...collectionRef, projectId: 'other-project' }, 'rail-spatial-project')).toBeUndefined()
    expect(parseRailwayStoredRefV1({ ...collectionRef, presentationId: 'not-canonical' }, 'rail-spatial-project')).toBeUndefined()
  })

  it('resolves real aggregates to explicit source and receive owners without adding them to default candidates', async () => {
    const { repository, service, projectId } = await fixture()
    const initial = service.read(projectId)
    expect(initial.candidates.map((item) => item.workspaceId)).toEqual(['workspace-context-child'])
    expect(initial.candidates.some((item) => item.ref.kind === 'spatial')).toBe(false)

    const saved = service.save(projectId, [
      { kind: 'spatial', projectId, entityType: 'collection', entityId: 'collection-refs' },
      { kind: 'spatial', projectId, entityType: 'scope', entityId: 'scope-context' },
      { kind: 'spatial', projectId, entityType: 'scope', entityId: 'scope-workflow' },
    ], initial.order.version)
    expect(saved.destinations.map((item) => ({ role: item.role, label: item.label }))).toEqual([
      { role: 'spatial', label: '参考集合' },
      { role: 'spatial', label: '研究脉络' },
      { role: 'spatial', label: '交付流程' },
    ])
    expect(saved.destinations[0]).toMatchObject({
      sourceRef: { kind: 'collection', id: 'collection-refs' },
      receiveTarget: { owner: 'collection-membership', collectionId: 'collection-refs' },
    })
    expect(saved.destinations[1]).toMatchObject({
      sourceRef: { kind: 'context', id: 'scope-context' },
      receiveTarget: { owner: 'assembly', targetRef: { kind: 'context', id: 'scope-context' } },
    })
    expect(saved.destinations[2]).toMatchObject({
      sourceRef: { kind: 'workflow', id: 'scope-workflow' },
      receiveTarget: { owner: 'assembly', targetRef: { kind: 'workflow', id: 'scope-workflow' } },
    })
    expect(repository.listCollectionMemberships(projectId, 'collection-refs')).toHaveLength(0)
    expect(saved.candidates.map((item) => item.workspaceId)).toEqual(['workspace-context-child'])
  })

  it('allows explicitly pinning a real root Workspace without listing root workspaces as candidates', async () => {
    const { service, projectId } = await fixture()
    const initial = service.read(projectId)
    expect(initial.candidates.some((item) => item.workspaceId === 'workspace-main')).toBe(false)
    const saved = service.save(projectId, [{ kind: 'worksite', projectId, worksiteId: 'workspace-main' }], initial.order.version)
    expect(saved.destinations[0]).toMatchObject({
      role: 'worksite', available: true, workspaceId: 'workspace-main', canvasId: 'canvas-main',
      sourceRef: { kind: 'scene', id: 'workspace-main' },
    })
    expect(saved.candidates.some((item) => item.workspaceId === 'workspace-main')).toBe(false)
  })

  it('rejects absent or semantically unsupported Scope identities and preserves the Railway CAS order', async () => {
    const { repository, service, projectId } = await fixture()
    expect(() => service.save(projectId, [{ kind: 'spatial', projectId, entityType: 'scope', entityId: 'missing-scope' }], 0)).toThrow(/目的地已变化/)
    expect(() => service.save(projectId, [{ kind: 'spatial', projectId, entityType: 'scope', entityId: 'scope-temporary' }], 0)).toThrow(/目的地已变化/)
    expect(repository.getRailwayOrderRecord(projectId)?.version ?? 0).toBe(0)
    const current = service.save(projectId, [{ kind: 'spatial', projectId, entityType: 'scope', entityId: 'scope-context' }], 0)
    expect(() => service.save(projectId, [], 0)).toThrow('目的地顺序已被修改，请重新读取。')
    expect(service.read(projectId).order.orderedRefs).toEqual(current.order.orderedRefs)
  })
})
