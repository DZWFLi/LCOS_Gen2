import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { PresentationStateV0, PresentationViewV0 } from '@local-creative-os/contracts'
import type { ArtifactView, Scope } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { PresentationApplicationService, PresentationConflictError } from '../src/presentation-application-service.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function freshDb() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-presentation-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-presentation-project-'))
  roots.push(dbRoot, projectRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, '2026-08-01T09:00:00.000Z')
  repository.save(snapshot)
  return { repository, snapshot, dbPath: join(dbRoot, 'metadata.sqlite') }
}

const stateFor = (memberViewIds: string[]): PresentationStateV0 => ({
  memberViewIds,
  hiddenViewIds: [],
  positions: Object.fromEntries(memberViewIds.map((id, index) => [id, { x: index * 40, y: 40 }])),
  hierarchy: { parentByViewId: Object.fromEntries(memberViewIds.map((id) => [id, null])), orderByParent: { '': memberViewIds } },
  presentationEdges: [],
  pinnedViewIds: [],
  emphasisByViewId: {},
})

const viewFor = (projectId: string, scopeId: string, memberViewIds: string[], version = 0, updatedBy: PresentationViewV0['updatedBy'] = 'web'): PresentationViewV0 => ({
  schemaVersion: 0,
  id: 'presentation:context:scope-test',
  projectId,
  scopeId,
  capability: 'context',
  renderer: 'strands',
  state: stateFor(memberViewIds),
  version,
  updatedBy,
  createdAt: '2026-08-01T09:00:00.000Z',
  updatedAt: '2026-08-01T09:00:00.000Z',
})

describe('Presentation persistence (Phase B)', () => {
  it('survives repository restart with CAS version intact', () => {
    const { repository, snapshot, dbPath } = freshDb()
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const memberViewId = String(snapshot.artifactViews[0]!.id)
    const view = viewFor(String(snapshot.project.id), scopeId, [memberViewId])
    repository.insertPresentationView(view)

    repositories.splice(repositories.indexOf(repository), 1)
    repository.close()
    const reopened = new SqliteMetadataRepository(dbPath)
    repositories.push(reopened)

    const loaded = reopened.getPresentationView(String(snapshot.project.id), view.id)
    expect(loaded).toMatchObject({ id: view.id, version: 0, capability: 'context', renderer: 'strands' })
    expect(loaded?.state.memberViewIds).toEqual([memberViewId])
  })

  it('accepts legacy spatial region geometry for one-time migration', () => {
    const { repository, snapshot } = freshDb()
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const projectId = String(snapshot.project.id)
    const service = new PresentationApplicationService(repository, repository)
    const state: PresentationStateV0 = {
      ...stateFor([]),
      spatialRegions: [{ id: 'region-main-1', label: '参考资料', bounds: { x: 120, y: 80, width: 640, height: 420 } }],
    }

    const saved = service.save(projectId, {
      presentationId: 'presentation:arrange:scope-root',
      scopeId,
      capability: 'arrange',
      renderer: 'main-canvas',
      state,
      expectedVersion: 0,
      updatedBy: 'web',
    })

    expect(saved.state.spatialRegions).toEqual(state.spatialRegions)
    expect(saved.state.memberViewIds).toEqual([])
    expect(() => service.save(projectId, {
      presentationId: 'presentation:arrange:scope-invalid',
      scopeId,
      capability: 'arrange',
      renderer: 'main-canvas',
      state: { ...state, spatialRegions: [{ id: 'bad', bounds: { x: 0, y: 0, width: -1, height: 20 } }] },
      expectedVersion: 0,
      updatedBy: 'web',
    })).toThrow(/bounds must be positive/)
  })

  it('persists canonical Colony sticky membership and contour', () => {
    const { repository, snapshot } = freshDb()
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const projectId = String(snapshot.project.id)
    const service = new PresentationApplicationService(repository, repository)
    const state: PresentationStateV0 = {
      ...stateFor([]),
      colonies: [{
        id: 'colony-main-1',
        label: '参考资料',
        surface: 'main',
        memberIds: ['node-a', 'node-b'],
        contour: { points: [{ x: 80, y: 60 }, { x: 760, y: 80 }, { x: 720, y: 520 }, { x: 100, y: 500 }] },
      }],
    }

    const saved = service.save(projectId, {
      presentationId: 'presentation:arrange:scope-colony',
      scopeId,
      capability: 'arrange',
      renderer: 'main-canvas',
      state,
      expectedVersion: 0,
      updatedBy: 'web',
    })

    expect(saved.state.colonies).toEqual(state.colonies)
    expect(saved.state.memberViewIds).toEqual([])
    expect(() => service.save(projectId, {
      presentationId: 'presentation:arrange:scope-colony-invalid',
      scopeId,
      capability: 'arrange',
      renderer: 'main-canvas',
      state: { ...state, colonies: [{ ...state.colonies![0]!, contour: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] } }] },
      expectedVersion: 0,
      updatedBy: 'web',
    })).toThrow(/requires a closed contour/)
  })

  it('persists trusted SurfaceElements and validates geometry/project identity', () => {
    const { repository, snapshot } = freshDb()
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const projectId = String(snapshot.project.id)
    const service = new PresentationApplicationService(repository, repository)
    const state: PresentationStateV0 = {
      ...stateFor([]),
      surfaceElements: [{
        id: 'surface:context-pack:1',
        projectId,
        surface: 'context',
        type: 'context-pack',
        bounds: { x: 120, y: 90, w: 360, h: 220 },
        binding: { contextId: 'context-real-1' },
        presentation: { pinned: true, zIndex: 4 },
      }],
    }
    const saved = service.save(projectId, {
      presentationId: 'presentation:context:scope-root-components',
      scopeId,
      capability: 'context',
      renderer: 'context',
      state,
      expectedVersion: 0,
      updatedBy: 'web',
    })
    expect(saved.state.surfaceElements).toEqual(state.surfaceElements)
    expect(service.get(projectId, saved.id)?.state.surfaceElements).toEqual(state.surfaceElements)
    expect(() => service.save(projectId, {
      presentationId: 'presentation:context:scope-root-components-bad',
      scopeId, capability: 'context', renderer: 'context', expectedVersion: 0, updatedBy: 'web',
      state: { ...state, surfaceElements: [{ ...state.surfaceElements![0]!, id: 'bad', bounds: { x: 0, y: 0, w: -1, h: 20 } }] },
    })).toThrow(/bounds must be positive/)
    expect(() => service.save(projectId, {
      presentationId: 'presentation:context:scope-root-components-foreign',
      scopeId, capability: 'context', renderer: 'context', expectedVersion: 0, updatedBy: 'web',
      state: { ...state, surfaceElements: [{ ...state.surfaceElements![0]!, id: 'foreign', projectId: 'other-project' }] },
    })).toThrow(/another project/)
  })

  it('CAS rejects stale versions and exposes currentVersion', () => {
    const { repository, snapshot } = freshDb()
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const projectId = String(snapshot.project.id)
    const memberViewId = String(snapshot.artifactViews[0]!.id)
    const view = viewFor(projectId, scopeId, [memberViewId])
    repository.insertPresentationView(view)

    const stale = repository.compareAndSwapPresentationView(viewFor(projectId, scopeId, [memberViewId], 0), 7)
    expect(stale).toEqual({ updated: false, currentVersion: 0 })

    const ok = repository.compareAndSwapPresentationView(viewFor(projectId, scopeId, [memberViewId], 0), 0)
    expect(ok.updated).toBe(true)
    expect(ok.currentVersion).toBe(1)
    expect(repository.getPresentationView(projectId, view.id)?.version).toBe(1)
  })

  it('service rejects non-member hierarchy/edges and CAS conflicts', () => {
    const { repository, snapshot } = freshDb()
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const projectId = String(snapshot.project.id)
    const memberViewId = String(snapshot.artifactViews[0]!.id)
    const service = new PresentationApplicationService(repository, repository)

    const danglingEdge: PresentationStateV0 = {
      ...stateFor([memberViewId]),
      presentationEdges: [{ id: 'edge-x', fromViewId: memberViewId, toViewId: 'view-does-not-exist' }],
    }
    expect(() => service.save(projectId, {
      presentationId: 'presentation:context:scope-test',
      scopeId,
      capability: 'context',
      renderer: 'strands',
      state: danglingEdge,
      expectedVersion: 0,
      updatedBy: 'web',
    })).toThrow(/Presentation edge/)

    const crossProject: PresentationStateV0 = {
      ...stateFor(['view-foreign-project']),
      hierarchy: { parentByViewId: { 'view-foreign-project': null }, orderByParent: { '': ['view-foreign-project'] } },
    }
    expect(() => service.save(projectId, {
      presentationId: 'presentation:context:scope-test',
      scopeId,
      capability: 'context',
      renderer: 'strands',
      state: crossProject,
      expectedVersion: 0,
      updatedBy: 'web',
    })).toThrow(/does not belong to the project/)

    const first = service.save(projectId, {
      presentationId: 'presentation:context:scope-test',
      scopeId,
      capability: 'context',
      renderer: 'strands',
      state: stateFor([memberViewId]),
      expectedVersion: 0,
      updatedBy: 'web',
    })
    expect(first.version).toBe(0)
    service.save(projectId, {
      presentationId: 'presentation:context:scope-test',
      scopeId,
      capability: 'context',
      renderer: 'strands',
      state: stateFor([memberViewId]),
      expectedVersion: 0,
      updatedBy: 'web',
    })
    expect(() => service.save(projectId, {
      presentationId: 'presentation:context:scope-test',
      scopeId,
      capability: 'context',
      renderer: 'strands',
      state: stateFor([memberViewId]),
      expectedVersion: 0,
      updatedBy: 'web',
    })).toThrow(PresentationConflictError)
  })

  it('allows a Presentation owned by one Scope to reference Project Views from other Scopes', () => {
    const { repository, snapshot } = freshDb()
    const projectId = String(snapshot.project.id)
    const rootScopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const rootView = snapshot.artifactViews[0]!
    const childScopeId = 'scope-cross-presentation'
    const childScope: Scope = {
      id: childScopeId as Scope['id'],
      projectId: snapshot.project.id,
      parentScopeId: rootScopeId as Scope['id'],
      containerViewId: null,
      kind: 'collection',
      name: 'Cross-scope source',
      createdAt: snapshot.project.createdAt,
      updatedAt: snapshot.project.updatedAt,
    }
    const childView: ArtifactView = {
      ...rootView,
      id: 'view-cross-scope' as ArtifactView['id'],
      scopeId: childScope.id,
      referenceKind: 'explicit_additional',
      position: { x: 20, y: 20 },
    }
    repository.applyMutations({
      baseVersion: snapshot.graphVersion,
      ops: [
        { type: 'upsert_scope', scope: childScope },
        { type: 'upsert_artifact_view', view: childView },
      ],
    }, projectId)

    const service = new PresentationApplicationService(repository, repository)
    const saved = service.save(projectId, {
      presentationId: 'presentation:workflow:scope-root',
      scopeId: rootScopeId,
      capability: 'workflow',
      renderer: 'workflow',
      state: stateFor([String(rootView.id), String(childView.id)]),
      expectedVersion: 0,
      updatedBy: 'web',
    })

    expect(saved.state.memberViewIds).toEqual([String(rootView.id), String(childView.id)])
    expect(saved.scopeId).toBe(rootScopeId)
  })

  it('keeps aggregate Presentation refs in-project and cleans Workspace scene refs atomically on delete', () => {
    const { repository, snapshot } = freshDb()
    const projectId = String(snapshot.project.id)
    const rootScopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const workspace = snapshot.workspaces[0]!
    const service = new PresentationApplicationService(repository, repository)

    const contextState: PresentationStateV0 = {
      ...stateFor([]),
      memberEntityRefs: [{ type: 'workspace', id: String(workspace.id) }],
    }
    const context = service.save(projectId, {
      presentationId: 'presentation:context:scope-root',
      scopeId: rootScopeId,
      capability: 'context',
      renderer: 'context-graph',
      state: contextState,
      expectedVersion: 0,
      updatedBy: 'web',
    })
    expect(context.state.memberEntityRefs).toEqual([{ type: 'workspace', id: String(workspace.id) }])

    service.save(projectId, {
      presentationId: `presentation:custom:workspace:${String(workspace.id)}`,
      scopeId: String(workspace.scopeId),
      capability: 'custom',
      renderer: 'workspace-scene',
      state: stateFor([]),
      expectedVersion: 0,
      updatedBy: 'web',
    })

    repository.applyMutations({
      baseVersion: snapshot.graphVersion,
      ops: [{ type: 'delete_workspace', workspaceId: workspace.id }],
    }, projectId)

    expect(repository.getWorkspace(String(workspace.id))).toBeUndefined()
    expect(repository.getPresentationView(projectId, `presentation:custom:workspace:${String(workspace.id)}`)).toBeUndefined()
    expect(repository.getPresentationView(projectId, 'presentation:context:scope-root')?.state.memberEntityRefs).toEqual([])
  })

  it('publishes all Presentation invalidations through one project-level subscription', () => {
    const { repository, snapshot } = freshDb()
    const projectId = String(snapshot.project.id)
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const memberViewId = String(snapshot.artifactViews[0]!.id)
    const service = new PresentationApplicationService(repository, repository)
    const changes: string[] = []
    const unsubscribe = service.subscribeProject(projectId, (change) => changes.push(`${change.presentationId}@${change.version}`))
    service.save(projectId, {
      presentationId: 'presentation:context:scope-root', scopeId, capability: 'context', renderer: 'context-graph',
      state: stateFor([memberViewId]), expectedVersion: 0, updatedBy: 'web',
    })
    service.save(projectId, {
      presentationId: 'presentation:workflow:scope-root', scopeId, capability: 'workflow', renderer: 'workflow',
      state: stateFor([memberViewId]), expectedVersion: 0, updatedBy: 'web',
    })
    unsubscribe()
    expect(changes).toEqual(['presentation:context:scope-root@0', 'presentation:workflow:scope-root@0'])
  })

  it('rejects aggregate Presentation entity refs that are not part of the Project', () => {
    const { repository, snapshot } = freshDb()
    const projectId = String(snapshot.project.id)
    const rootScopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const service = new PresentationApplicationService(repository, repository)
    const badState: PresentationStateV0 = {
      ...stateFor([]),
      memberEntityRefs: [{ type: 'workspace', id: 'workspace-does-not-exist' }],
    }
    expect(() => service.save(projectId, {
      presentationId: 'presentation:context:bad-entity-ref',
      scopeId: rootScopeId,
      capability: 'context',
      renderer: 'context-graph',
      state: badState,
      expectedVersion: 0,
      updatedBy: 'web',
    })).toThrow(/workspace ref .* does not belong to the project/)
  })

  it('HTTP roundtrip: PUT persists, GET reads, DELETE removes, graphVersion unchanged', async () => {
    const { repository, snapshot } = freshDb()
    const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const projectId = String(snapshot.project.id)
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const memberViewId = String(snapshot.artifactViews[0]!.id)
    const presentationId = 'presentation:context:scope-test'

    const before = await (await fetch(`${baseUrl}/projects/${projectId}/graph`)).json() as { value: { project: { graphVersion: number } } }
    const contract = viewFor(projectId, scopeId, [memberViewId])
    const created = await fetch(`${baseUrl}/projects/${projectId}/presentations/${presentationId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract, expectedVersion: 0 }),
    })
    if (created.status !== 200) {
      console.log('PUT DEBUG BODY:', await created.clone().text())
    }
    expect(created.status).toBe(200)
    await expect(created.json()).resolves.toMatchObject({ ok: true, value: { id: presentationId, version: 0 } })

    const after = await (await fetch(`${baseUrl}/projects/${projectId}/graph`)).json() as { value: { project: { graphVersion: number } } }
    expect(after.value.project.graphVersion).toBe(before.value.project.graphVersion)

    const listed = await fetch(`${baseUrl}/projects/${projectId}/presentations`)
    await expect(listed.json()).resolves.toMatchObject({ ok: true, value: [{ id: presentationId }] })

    const stale = await fetch(`${baseUrl}/projects/${projectId}/presentations/${presentationId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract: { ...contract, version: 0 }, expectedVersion: 9 }),
    })
    expect(stale.status).toBe(409)

    const removed = await fetch(`${baseUrl}/projects/${projectId}/presentations/${presentationId}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    const missing = await fetch(`${baseUrl}/projects/${projectId}/presentations/${presentationId}`)
    expect(missing.status).toBe(404)
  })

  it('SSE stream pushes lightweight change notifications after save', async () => {
    const { repository, snapshot } = freshDb()
    const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const projectId = String(snapshot.project.id)
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const memberViewId = String(snapshot.artifactViews[0]!.id)
    const presentationId = 'presentation:context:scope-test'
    const contract = viewFor(projectId, scopeId, [memberViewId])

    await fetch(`${baseUrl}/projects/${projectId}/presentations/${presentationId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract, expectedVersion: 0 }),
    })

    const controller = new AbortController()
    const response = await fetch(`${baseUrl}/projects/${projectId}/presentations/${presentationId}/stream?afterVersion=0`, { signal: controller.signal })
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let received = ''
    const readUntil = async (needle: string, timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (received.includes(needle)) return true
        const { value, done } = await reader.read()
        if (done) break
        received += decoder.decode(value, { stream: true })
      }
      return received.includes(needle)
    }

    expect(await readUntil('event: snapshot', 5000)).toBe(true)

    const updated = await fetch(`${baseUrl}/projects/${projectId}/presentations/${presentationId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract: { ...contract, updatedBy: 'agent' as const }, expectedVersion: 0 }),
    })
    expect(updated.status).toBe(200)

    expect(await readUntil('event: update', 5000)).toBe(true)
    expect(received).toContain('"updatedBy":"agent"')
    controller.abort()
  })

  it('deduplicates timeout-style retries by operationId and exposes a receipt', async () => {
    const { repository, snapshot } = freshDb()
    const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const projectId = String(snapshot.project.id)
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const contract = viewFor(projectId, scopeId, [String(snapshot.artifactViews[0]!.id)])
    const origin = { clientId: 'browser-a', sessionId: 'tab-a', clientSeq: 1, operationId: 'operation-timeout-retry', sourceSurface: 'context' }
    const body = JSON.stringify({ contract, expectedVersion: 0, origin })
    const first = await fetch(`${baseUrl}/projects/${projectId}/presentations/${contract.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body })
    const duplicate = await fetch(`${baseUrl}/projects/${projectId}/presentations/${contract.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body })
    expect(first.status).toBe(200)
    expect(duplicate.status).toBe(200)
    await expect(duplicate.json()).resolves.toMatchObject({ value: { version: 0 } })
    expect(repository.getPresentationView(projectId, contract.id)?.version).toBe(0)
    const receipt = await fetch(`${baseUrl}/projects/${projectId}/mutations/${origin.operationId}`)
    await expect(receipt.json()).resolves.toMatchObject({ ok: true, value: { operationId: origin.operationId, resultingVersion: 0 } })
  })

  it('project event stream sends one snapshot then ordered business events', async () => {
    const { repository, snapshot } = freshDb()
    const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
    servers.push(server)
    const address = await server.start()
    const baseUrl = `http://${address.host}:${address.port}`
    const projectId = String(snapshot.project.id)
    const scopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
    const contract = viewFor(projectId, scopeId, [String(snapshot.artifactViews[0]!.id)])
    const controller = new AbortController()
    const response = await fetch(`${baseUrl}/projects/${projectId}/events`, { signal: controller.signal })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const firstFrame = decoder.decode((await reader.read()).value)
    expect(firstFrame).toContain('event: snapshot')
    await fetch(`${baseUrl}/projects/${projectId}/presentations/${contract.id}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contract, expectedVersion: 0 }),
    })
    const eventFrame = decoder.decode((await reader.read()).value)
    expect(eventFrame).toContain('event: project-event')
    expect(eventFrame).toContain('presentation.changed')
    expect(eventFrame).toContain('"projectSeq":1')
    controller.abort()
  })
})
