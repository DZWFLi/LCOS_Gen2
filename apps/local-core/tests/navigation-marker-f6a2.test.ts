/**
 * F6A2 后端小刀验收（20260829）：Spatial Marker Intent 持久化 + Navigation Target Resolver。
 *
 * followup §Acceptance 七条：
 * 1. local marker reload 后 target identity 不变；
 * 2. cross-surface marker Context → Workflow resolve 到稳定 surface + anchor；
 * 3. target move 后 resolve 返回当前位置（Core 不复制坐标）；
 * 4. target delete 后 unresolved；
 * 5. cross-project ref 失败；
 * 6. 无 fuzzy rebind；
 * 7. Core schema/API 不出现 Pin/Cursor/Cluster 字段。
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'
import { MutationSafetyService } from '../src/mutation-safety-service.js'
import { NavigationMarkerService } from '../src/navigation-marker-service.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'

const AT = '2026-08-29T02:00:00.000Z'
const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-marker-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-marker-project-'))
  roots.push(dbRoot, projectRoot)
  const dbPath = join(dbRoot, 'metadata.sqlite')
  const repository = new SqliteMetadataRepository(dbPath)
  repositories.push(repository)
  // sample 只有 root scope；补 Context / Workflow scope 以覆盖跨 Surface 解析。
  const base = createMvpSampleSnapshot(projectRoot, AT)
  const projectId = String(base.project.id)
  const rootScopeId = String(base.scopes.find((scope) => scope.kind === 'root')!.id)
  const ctxScopeId = 'scope-ctx-f6a2'
  const wfScopeId = 'scope-wf-f6a2'
  repository.save({
    ...base,
    scopes: [
      ...base.scopes,
      { id: ctxScopeId as never, projectId: base.project.id, parentScopeId: rootScopeId as never, containerViewId: null, kind: 'context', name: 'Context F6A2', createdAt: AT, updatedAt: AT },
      { id: wfScopeId as never, projectId: base.project.id, parentScopeId: rootScopeId as never, containerViewId: null, kind: 'workflow', name: 'Workflow F6A2', createdAt: AT, updatedAt: AT },
    ],
  })
  // Context scope 内的一个 view（复用 sample artifact，跨 scope 第二 view 是合法形态）。
  const briefView = base.artifactViews[0]!
  const viewInCtx = { ...briefView, id: 'view-ctx-f6a2' as never, scopeId: ctxScopeId as never, position: { x: 10, y: 20 } }
  repository.upsertArtifactView(viewInCtx)
  const events = new ProjectEventHub()
  const presentation = new PresentationApplicationService(repository, repository, undefined, events)
  const mutationSafety = new MutationSafetyService(repository, presentation, events)
  const resolver = new NavigationMarkerService(repository)
  return { dbPath, repository, projectId, rootScopeId, ctxScopeId, wfScopeId, viewInCtx, mutationSafety, resolver }
}

type Setup = ReturnType<typeof setup>

async function setupWithServer() {
  const s = setup()
  const server = createLocalCoreServer({ port: 0, metadataRepository: s.repository })
  servers.push(server)
  const address = await server.start()
  return { ...s, baseUrl: `http://${address.host}:${address.port}` }
}

describe('P0-1 Spatial Marker Intent persistence（只存 intent）', () => {
  it('local marker reload 后 target identity 不变；跨 Project 创建 fail-close', () => {
    const s = setup()
    const { marker, changeSet } = s.mutationSafety.addSpatialMarker({
      projectId: s.projectId,
      targetRef: { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) },
      scope: 'local',
      sourceSurfaceRef: 'main',
      actorKind: 'web',
    })
    expect(changeSet.changes[0]!.type).toBe('spatial_marker_add')
    expect(marker.targetRef).toEqual({ projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) })
    expect(marker.scope).toBe('local')
    expect(marker.sourceSurfaceRef).toBe('main')

    // reload：close → reopen 同一 db 文件，intent 原样（acceptance 1）。
    const dbPath = s.dbPath
    s.repository.close()
    repositories.pop()
    const reopened = new SqliteMetadataRepository(dbPath)
    repositories.push(reopened)
    const reloaded = reopened.listSpatialMarkerIntents(s.projectId)
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]!.id).toBe(marker.id)
    expect(reloaded[0]!.targetRef).toEqual(marker.targetRef)
    expect(reopened.getSpatialMarkerIntent(marker.id)?.scope).toBe('local')

    // 跨 Project 创建 fail-close（acceptance 5 的写面）。
    const reopenedMutation = new MutationSafetyService(
      reopened,
      new PresentationApplicationService(reopened, reopened, undefined, new ProjectEventHub()),
      new ProjectEventHub(),
    )
    expect(() => reopenedMutation.addSpatialMarker({
      projectId: s.projectId,
      targetRef: { projectId: 'other-project', kind: 'view', id: 'view-x' },
      scope: 'cross-surface',
      actorKind: 'web',
    })).toThrow(/Cross-project/)
  })
})

describe('P0-2 resolveNavigationTarget（七 Surface + invariants）', () => {
  it('cross-surface marker：Context view → 稳定 surface + anchor；Workflow surface 直解（acceptance 2）', () => {
    const s = setup()
    const ctxResolution = s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) })
    expect(ctxResolution).toEqual({
      status: 'resolved',
      target: { projectId: s.projectId, surfaceRef: `scope:${s.ctxScopeId}`, surfaceKind: 'context', anchorRef: String(s.viewInCtx.id), worldPosition: { x: 10, y: 20 } },
    })
    const wfSurface = s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'surface', id: `scope:${s.wfScopeId}` })
    expect(wfSurface).toEqual({ status: 'resolved', target: { projectId: s.projectId, surfaceRef: `scope:${s.wfScopeId}`, surfaceKind: 'workflow' } })
    // Scene（workspace entity）与 Main / Assembly。
    const workspaceId = String(s.repository.get(s.projectId)!.workspaces[0]!.id)
    expect(s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'entity', id: workspaceId }).target?.surfaceKind).toBe('scene')
    expect(s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'surface', id: 'main' }).target?.surfaceKind).toBe('main')
    expect(s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'surface', id: 'assembly' }).target?.surfaceKind).toBe('assembly')
  })

  it('target move 后 resolve 返回当前位置——Core 不复制坐标（acceptance 3）', () => {
    const s = setup()
    const before = s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) })
    expect(before.target?.worldPosition).toEqual({ x: 10, y: 20 })
    s.repository.upsertArtifactView({ ...s.viewInCtx, position: { x: 99, y: 88 } })
    const after = s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) })
    expect(after.target?.worldPosition).toEqual({ x: 99, y: 88 })
  })

  it('target delete 后 unresolved；同源新对象不接管（acceptance 4 + 6：无 fuzzy rebind）', () => {
    const s = setup()
    s.repository.deleteArtifactView(String(s.viewInCtx.id))
    const gone = s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) })
    expect(gone).toEqual({ status: 'unresolved', reason: 'target-missing' })
    // 复制同 artifact（同标题同来源）的另一个 view 出现——旧 id 仍 target-missing。
    s.repository.upsertArtifactView({ ...s.viewInCtx, id: 'view-lookalike-f6a2' as never })
    expect(s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) })).toEqual({ status: 'unresolved', reason: 'target-missing' })
  })

  it('cross-project ref 失败（acceptance 5）', () => {
    const s = setup()
    expect(s.resolver.resolveNavigationTarget(s.projectId, { projectId: 'other-project', kind: 'view', id: String(s.viewInCtx.id) }))
      .toEqual({ status: 'unresolved', reason: 'cross-project' })
  })

  it('Note entity：scope 锚随锚 surface；project 锚落 main（无坐标主张）', () => {
    const s = setup()
    s.repository.upsertNote({ id: 'note-ctx-1', projectId: s.projectId as never, anchor: { type: 'scope', scopeId: s.ctxScopeId as never }, body: 'ctx note', createdAt: AT, updatedAt: AT })
    s.repository.upsertNote({ id: 'note-root-1', projectId: s.projectId as never, anchor: { type: 'project' }, body: 'root note', createdAt: AT, updatedAt: AT })
    const ctxNote = s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'entity', id: 'note-ctx-1' })
    expect(ctxNote.target?.surfaceKind).toBe('context')
    expect(ctxNote.target?.surfaceRef).toBe(`scope:${s.ctxScopeId}`)
    const rootNote = s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'entity', id: 'note-root-1' })
    expect(rootNote.target?.surfaceKind).toBe('main')
    expect(rootNote.target?.worldPosition).toBeUndefined()
  })

  it('未知 surface 词汇 / 未知 kind 诚实失败', () => {
    const s = setup()
    expect(s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'surface', id: 'galaxy:omega' })).toEqual({ status: 'unresolved', reason: 'unknown-surface' })
    expect(s.resolver.resolveNavigationTarget(s.projectId, { projectId: s.projectId, kind: 'cosmic' as never, id: 'x' })).toEqual({ status: 'unresolved', reason: 'unknown-target-kind' })
  })
})

describe('Core truth 纯度（acceptance 7：无 Pin/Cursor/Cluster 投影字段）', () => {
  it('spatial_marker_intents 列集只含 intent 字段；resolver 源无 title/provider/time 重绑词', () => {
    const s = setup()
    const raw = new DatabaseSync(s.dbPath)
    try {
      const rows = raw.prepare('PRAGMA table_info(spatial_marker_intents)').all() as { name: string }[]
      const columns = rows.map((row) => row.name).sort()
      expect(columns).toEqual(['created_at', 'id', 'project_id', 'scope', 'source_surface_ref', 'target_id', 'target_kind', 'updated_at'])
    } finally {
      raw.close()
    }
    const serviceSource = readFileSync(new URL('../src/navigation-marker-service.ts', import.meta.url), 'utf8')
    expect(serviceSource).not.toMatch(/\.(title|provider)\b|lastRunAt|titleMatch/)
  })
})

describe('ChangeSet 纪律：marker 增删走 envelope（revert/reapply 完整链）', () => {
  it('add 的 revert 删除 / reapply 恢复；remove 的 revert 恢复 / reapply 再删', () => {
    const s = setup()
    const { marker, changeSet } = s.mutationSafety.addSpatialMarker({
      projectId: s.projectId,
      targetRef: { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) },
      scope: 'cross-surface',
      actorKind: 'web',
    })
    expect(s.repository.getSpatialMarkerIntent(marker.id)).toBeDefined()
    expect(s.mutationSafety.revert(changeSet.id).revertable).toBe(true)
    expect(s.repository.getSpatialMarkerIntent(marker.id)).toBeUndefined()
    expect(s.mutationSafety.reapply(changeSet.id).revertable).toBe(true)
    expect(s.repository.getSpatialMarkerIntent(marker.id)?.id).toBe(marker.id)

    const removeSet = s.mutationSafety.removeSpatialMarker({ projectId: s.projectId, markerId: marker.id, actorKind: 'web' })
    expect(removeSet).toBeDefined()
    expect(s.repository.getSpatialMarkerIntent(marker.id)).toBeUndefined()
    expect(s.mutationSafety.revert(removeSet!.id).revertable).toBe(true)
    expect(s.repository.getSpatialMarkerIntent(marker.id)?.id).toBe(marker.id)
    expect(s.mutationSafety.reapply(removeSet!.id).revertable).toBe(true)
    expect(s.repository.getSpatialMarkerIntent(marker.id)).toBeUndefined()
    // 非存在 marker 删除 → undefined（幂等诚实）。
    expect(s.mutationSafety.removeSpatialMarker({ projectId: s.projectId, markerId: marker.id, actorKind: 'web' })).toBeUndefined()
  })
})

describe('HTTP 路由（/projects/:id/spatial-markers + /navigation/resolve）', () => {
  it('create(201+changeSetId) → list → resolve → delete(200) → delete again(404) → 跨 Project 创建 422', async () => {
    const s = await setupWithServer()
    const headers = { 'content-type': 'application/json' }
    const createResponse = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers`, {
      method: 'POST', headers,
      body: JSON.stringify({ targetRef: { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) }, scope: 'local', sourceSurfaceRef: 'main' }),
    })
    expect(createResponse.status).toBe(201)
    const created = await createResponse.json() as { value: { id: string }; meta: { changeSetId: string } }
    expect(created.value.id).toBeTruthy()
    expect(created.meta.changeSetId).toBeTruthy()

    const listResponse = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers`)
    expect(listResponse.status).toBe(200)
    expect(((await listResponse.json()) as { value: unknown[] }).value).toHaveLength(1)

    const resolveResponse = await fetch(`${s.baseUrl}/projects/${s.projectId}/navigation/resolve`, {
      method: 'POST', headers,
      body: JSON.stringify({ targetRef: { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) } }),
    })
    expect(resolveResponse.status).toBe(200)
    const resolution = (await resolveResponse.json()) as { value: { status: string; target?: { surfaceKind: string } } }
    expect(resolution.value.status).toBe('resolved')
    expect(resolution.value.target?.surfaceKind).toBe('context')

    // unresolved 也是 200（诚实状态，不是 HTTP 错误）。
    const missingResponse = await fetch(`${s.baseUrl}/projects/${s.projectId}/navigation/resolve`, {
      method: 'POST', headers,
      body: JSON.stringify({ targetRef: { projectId: s.projectId, kind: 'view', id: 'view-not-exist' } }),
    })
    expect(missingResponse.status).toBe(200)
    expect(((await missingResponse.json()) as { value: { status: string; reason: string } }).value).toEqual({ status: 'unresolved', reason: 'target-missing' })

    const deleteResponse = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers/${created.value.id}`, { method: 'DELETE' })
    expect(deleteResponse.status).toBe(200)
    const againResponse = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers/${created.value.id}`, { method: 'DELETE' })
    expect(againResponse.status).toBe(404)

    const crossResponse = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers`, {
      method: 'POST', headers,
      body: JSON.stringify({ targetRef: { projectId: 'other-project', kind: 'view', id: 'view-x' }, scope: 'local', sourceSurfaceRef: 'main' }),
    })
    expect(crossResponse.status).toBe(422)

    const localWithoutSurface = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers`, {
      method: 'POST', headers,
      body: JSON.stringify({ targetRef: { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) }, scope: 'local' }),
    })
    expect(localWithoutSurface.status).toBe(400)

    const fakeUiSurface = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers`, {
      method: 'POST', headers,
      body: JSON.stringify({ targetRef: { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) }, scope: 'local', sourceSurfaceRef: 'context-graph-spatial' }),
    })
    expect(fakeUiSurface.status).toBe(400)

    const missingStableSurface = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers`, {
      method: 'POST', headers,
      body: JSON.stringify({ targetRef: { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) }, scope: 'local', sourceSurfaceRef: 'scope:missing' }),
    })
    expect(missingStableSurface.status).toBe(422)

    // Stable-looking aliases must resolve to the exact same canonical surface ref; root scope is `main`, not `scope:<root>`.
    const rootScopeAlias = await fetch(`${s.baseUrl}/projects/${s.projectId}/spatial-markers`, {
      method: 'POST', headers,
      body: JSON.stringify({ targetRef: { projectId: s.projectId, kind: 'view', id: String(s.viewInCtx.id) }, scope: 'local', sourceSurfaceRef: `scope:${s.rootScopeId}` }),
    })
    expect(rootScopeAlias.status).toBe(422)
  })
})
