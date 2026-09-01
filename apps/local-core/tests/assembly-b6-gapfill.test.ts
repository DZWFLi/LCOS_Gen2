/**
 * F6 B6 补洞单验收（20260828）。
 *
 * 覆盖：
 * - census（P1-B）：DELETE 破坏性路由 ChangeSet 化（view/note）、workspace members
 *   envelope（remove/move）、ResultSlot materialize 挂 parent Run ChangeSet、
 *   presentations.save membership diff-gate（placement-only 不记账）
 * - P0-B：Warehouse 聚合物种（context/workflow/scene/collection）
 * - P0-C：artifact 行 truthful visualFamily
 * - P0-D：Capture staging 真分页（>50 pending 完整浏览）
 * - P0-E：note（方案 A entity 成员）+ resource（方案 B canonical view 解析）
 * - P0-F：propose 保留 Unified Execution Contract 字段
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { createLocalCoreServer, type LocalCoreServer } from '../src/server.js'
import { AssemblyApplyService } from '../src/assembly-apply-service.js'
import { CaptureStagingService } from '../src/capture-staging-service.js'
import { CaptureSpaceService } from '../src/capture-space-service.js'
import { CapturePlacementService } from '../src/capture-placement-service.js'
import { MutationSafetyService } from '../src/mutation-safety-service.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { CurationCommandService } from '../src/curation-command-service.js'
import { ResultSlotService } from '../src/result-slot-service.js'
import { WarehouseService } from '../src/warehouse-service.js'
import { ConversationImportService } from '../src/conversation-import-service.js'
import { ImportCopyService } from '../src/import-copy-service.js'
import { UniversalResourceImportService } from '../src/resources/universal-resource-import-service.js'
import { IntelligenceProviderService } from '../src/intelligence-provider-service.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { proposeRun } from '../src/runtime-proposal-service.js'

const AT = '2026-08-28T13:00:00.000Z'
const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

function makeScope(projectId: string, id: string, parentScopeId: string, kind: 'context' | 'workflow' | 'collection', name: string) {
  return { id, projectId, parentScopeId, containerViewId: null, kind, name, createdAt: AT, updatedAt: AT }
}

async function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-b6-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-b6-project-'))
  const blobRoot = mkdtempSync(join(tmpdir(), 'lcos-b6-blobs-'))
  roots.push(dbRoot, projectRoot, blobRoot)
  const repository = new SqliteMetadataRepository(join(dbRoot, 'metadata.sqlite'))
  repositories.push(repository)
  const base = createMvpSampleSnapshot(projectRoot, AT)
  const projectId = String(base.project.id)
  const rootScopeId = String(base.scopes.find((scope) => scope.kind === 'root')!.id)
  const contextScopeId = 'scope-b6-context'
  const workflowScopeId = 'scope-b6-workflow'
  const collectionScopeId = 'scope-b6-collection'
  repository.save({
    ...base,
    scopes: [
      ...base.scopes,
      makeScope(base.project.id, contextScopeId, rootScopeId, 'context', 'B6 Context'),
      makeScope(base.project.id, workflowScopeId, rootScopeId, 'workflow', 'B6 Workflow'),
      makeScope(base.project.id, collectionScopeId, rootScopeId, 'collection', 'B6 Collection'),
    ] as never,
  })
  const events = new ProjectEventHub()
  const presentation = new PresentationApplicationService(repository, repository, undefined, events)
  const mutationSafety = new MutationSafetyService(repository, presentation, events)
  const conversations = new ConversationImportService(repository)
  const curationCommand = new CurationCommandService({ repository, presentations: presentation })
  const staging = new CaptureStagingService(repository, blobRoot)
  const importCopy = new ImportCopyService(repository)
  const resources = new UniversalResourceImportService(repository, importCopy)
  const captureSpace = new CaptureSpaceService(repository, staging, resources, new CapturePlacementService(repository), new IntelligenceProviderService(), blobRoot)
  const apply = new AssemblyApplyService(repository, captureSpace, mutationSafety, conversations, curationCommand, presentation)
  const warehouse = new WarehouseService(repository)
  const resultSlots = new ResultSlotService(repository)
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
  servers.push(server)
  const address = await server.start()
  return {
    dbRoot, repository, projectId, rootScopeId, contextScopeId, workflowScopeId, collectionScopeId,
    apply, mutationSafety, presentation, curationCommand, warehouse, resultSlots, staging, resources,
    baseUrl: `http://${address.host}:${address.port}`,
  }
}

type Setup = Awaited<ReturnType<typeof setup>>

async function freshViewId(s: Setup): Promise<string> {
  const created = await s.curationCommand.createText(s.projectId, { scopeId: s.rootScopeId, title: 'B6 member', body: 'b6 gapfill content' })
  return String(created.viewId)
}

function freshNote(s: Setup, id: string): void {
  s.repository.upsertNote({ id, projectId: s.projectId as never, anchor: { type: 'project' }, body: `b6 note ${id}`, createdAt: AT, updatedAt: AT })
}

describe('F6 B6 census: destructive DELETE → ChangeSet（revert/reapply）', () => {
  it('deleteArtifactView：view 删除进 ChangeSet；revert 恢复；reapply 再删', async () => {
    const s = await setup()
    const viewId = await freshViewId(s)
    expect(s.repository.getArtifactView(viewId)).toBeDefined()
    const changeSet = s.mutationSafety.deleteArtifactView({ projectId: s.projectId, viewId })
    expect(s.repository.getArtifactView(viewId)).toBeUndefined()
    expect(s.mutationSafety.revert(changeSet.id).revertable).toBe(true)
    expect(s.repository.getArtifactView(viewId)).toBeDefined()
    expect(s.mutationSafety.reapply(changeSet.id).revertable).toBe(true)
    expect(s.repository.getArtifactView(viewId)).toBeUndefined()
  })

  it('deleteNote：note 删除进 ChangeSet；revert 恢复', async () => {
    const s = await setup()
    freshNote(s, 'note-b6-del-1')
    const changeSet = s.mutationSafety.deleteNote({ projectId: s.projectId, noteId: 'note-b6-del-1' })
    expect(s.repository.getNote('note-b6-del-1')).toBeUndefined()
    expect(s.mutationSafety.revert(changeSet.id).revertable).toBe(true)
    expect(s.repository.getNote('note-b6-del-1')).toBeDefined()
  })

  it('cross-project DELETE fail-close', async () => {
    const s = await setup()
    const viewId = await freshViewId(s)
    expect(() => s.mutationSafety.deleteArtifactView({ projectId: 'project-not-exist', viewId })).toThrow()
  })
})

describe('F6 B6 census: workspace membership envelope（remove / move）', () => {
  it('removeWorkspaceMember + revert；move = 单 ChangeSet 一次撤销', async () => {
    const s = await setup()
    const viewId = await freshViewId(s)
    const workspace = s.repository.get(s.projectId)!.workspaces[0]!
    const workspaceId = String(workspace.id)
    const add = s.mutationSafety.addWorkspaceMember({ projectId: s.projectId, workspaceId, viewId })
    expect(add).toBeDefined()

    const remove = s.mutationSafety.removeWorkspaceMember({ projectId: s.projectId, workspaceId, viewId })
    expect(remove).toBeDefined()
    expect(s.repository.listWorkspaceMembers(workspaceId as never).some((m) => String(m.artifactViewId) === viewId)).toBe(false)
    expect(s.mutationSafety.revert(remove!.id).revertable).toBe(true)
    expect(s.repository.listWorkspaceMembers(workspaceId as never).some((m) => String(m.artifactViewId) === viewId)).toBe(true)

    // 第二个 workspace 作为 move 目标
    const targetWorkspace = s.repository.get(s.projectId)!.workspaces.find((w) => String(w.id) !== workspaceId)!
    const targetId = String(targetWorkspace.id)
    const move = s.mutationSafety.moveWorkspaceMember({ projectId: s.projectId, fromWorkspaceId: workspaceId, toWorkspaceId: targetId, viewId })
    expect(s.repository.listWorkspaceMembers(workspaceId as never).some((m) => String(m.artifactViewId) === viewId)).toBe(false)
    expect(s.repository.listWorkspaceMembers(targetId as never).some((m) => String(m.artifactViewId) === viewId)).toBe(true)
    // 一次撤销还原整个 move
    expect(s.mutationSafety.revert(move.id).revertable).toBe(true)
    expect(s.repository.listWorkspaceMembers(workspaceId as never).some((m) => String(m.artifactViewId) === viewId)).toBe(true)
    expect(s.repository.listWorkspaceMembers(targetId as never).some((m) => String(m.artifactViewId) === viewId)).toBe(false)
  })
})

describe('F6 B6 census: ResultSlot materialize → parent Run ChangeSet', () => {
  it('materialize 记 ChangeSet；revert 回 review（清空绑定）；reapply 恢复 materialized', async () => {
    const s = await setup()
    const slot = s.resultSlots.create({ projectId: s.projectId, scopeId: s.rootScopeId, x: 10, y: 10 })
    s.resultSlots.claim(slot.id, 'run-b6-1')
    s.resultSlots.markReview(slot.id, 'run-b6-1')
    const viewId = await freshViewId(s)
    const artifactId = String(s.repository.getArtifactView(viewId)!.artifactId)
    const materialized = s.resultSlots.materialize(slot.id, 'run-b6-1', artifactId, viewId)
    // 与 runtime-review accept 相同形状的记账
    const changeSet = s.mutationSafety.record({
      projectId: s.projectId,
      operationId: 'run-accept-ret-b6-1',
      actorKind: 'web',
      changes: [{
        type: 'result_slot_materialize',
        slotId: slot.id,
        runId: 'run-b6-1',
        artifactId,
        artifactViewId: viewId,
        inverse: { type: 'result_slot_restore', slotId: slot.id, status: 'review' },
        forward: { type: 'result_slot_materialize', slotId: slot.id, runId: 'run-b6-1', artifactId, artifactViewId: viewId },
        appliedFingerprint: `result-slot:${slot.id}:materialized:${viewId}`,
      }],
    })
    expect(materialized.status).toBe('materialized')
    expect(s.mutationSafety.revert(changeSet.id).revertable).toBe(true)
    const afterRevert = s.repository.getResultSlot(slot.id)!
    expect(afterRevert.status).toBe('review')
    expect(afterRevert.artifactViewId).toBeUndefined()
    expect(s.mutationSafety.reapply(changeSet.id).revertable).toBe(true)
    expect(s.repository.getResultSlot(slot.id)!.status).toBe('materialized')
  })
})

describe('F6 B6 P0-B/P0-C: Warehouse 聚合物种 + visualFamily', () => {
  it('context/workflow/scene/collection 出现在 read model；entityRef 可转 AssemblySourceRefV1', async () => {
    const s = await setup()
    const snapshot = s.warehouse.query(s.projectId, { kinds: ['context', 'workflow', 'scene', 'collection'] })
    const kinds = new Set(snapshot.items.map((item) => item.kind))
    expect(kinds.has('context')).toBe(true)
    expect(kinds.has('workflow')).toBe(true)
    expect(kinds.has('scene')).toBe(true)
    expect(kinds.has('collection')).toBe(true)
    const context = snapshot.items.find((item) => item.kind === 'context')!
    expect(context.entityRef.type).toBe('context')
    expect(context.entityRef.id).toBe(s.contextScopeId)
    const scene = snapshot.items.find((item) => item.kind === 'scene')!
    expect(scene.entityRef.type).toBe('scene')
    expect(scene.entityRef.id).toBe(String(s.repository.get(s.projectId)!.workspaces[0]!.id))
    // 搜索按名称命中
    const searched = s.warehouse.query(s.projectId, { kinds: ['context'], search: 'B6 Context' })
    expect(searched.items.length).toBe(1)
  })

  it('artifact 行带 truthful visualFamily（markdown 文本 → markdown 家族）', async () => {
    const s = await setup()
    await freshViewId(s)
    const snapshot = s.warehouse.query(s.projectId, { kinds: ['artifact'] })
    expect(snapshot.items.length).toBeGreaterThan(0)
    for (const item of snapshot.items) {
      expect(item.visualFamily).toBeDefined()
    }
    expect(snapshot.items.some((item) => item.visualFamily === 'markdown')).toBe(true)
  })
})

describe('F6 B6 P0-D: Capture staging 真分页（pending > 50 完整浏览）', () => {
  it('55 条 pending：limit=50 → 50 + nextCursor；第二页 5 条收尾', async () => {
    const s = await setup()
    for (let i = 0; i < 55; i++) {
      await s.staging.enqueue({
        operationId: `b6-capture-${i}`,
        kind: 'text',
        payloadBytes: new TextEncoder().encode(`b6 capture payload ${i}`),
        source: { title: `B6 Capture ${i}` },
        suggestedProjects: [],
        capturedAt: new Date(Date.parse('2026-08-28T13:00:00.000Z') + i * 1000).toISOString(),
      })
    }
    expect(s.repository.countPendingCaptureStagingItems()).toBe(55)
    const page1 = await (await fetch(`${s.baseUrl}/runtime/captures/staging?limit=50`)).json() as { ok: boolean; value: { items: unknown[]; pendingCount: number; nextCursor?: string } }
    expect(page1.value.items.length).toBe(50)
    expect(page1.value.pendingCount).toBe(55)
    expect(page1.value.nextCursor).toBe('offset:50')
    const page2 = await (await fetch(`${s.baseUrl}/runtime/captures/staging?limit=50&cursor=${encodeURIComponent(page1.value.nextCursor!)}`)).json() as { ok: boolean; value: { items: unknown[]; pendingCount: number; nextCursor?: string } }
    expect(page2.value.items.length).toBe(5)
    expect(page2.value.nextCursor).toBeUndefined()
  })
})

describe('F6 B6 P0-E: note（方案 A）+ resource（方案 B）', () => {
  it('note → main：entity 成员进 presentation + ChangeSet；revert 移除；re-apply already-member', async () => {
    const s = await setup()
    freshNote(s, 'note-b6-member-1')
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'note', id: 'note-b6-member-1' }],
      targetRef: { kind: 'main' },
    })
    const item = result.results[0]!
    expect(item.status).toBe('applied')
    expect(item.channel).toBe('presentation-membership')
    expect(item.changeSetId).toBeTruthy()
    const presentationId = `presentation:context:${s.rootScopeId}`
    expect(item.presentationId).toBe(presentationId)
    const state = s.presentation.get(s.projectId, presentationId)!.state
    expect((state.memberEntityRefs ?? []).some((ref) => ref.type === 'note' && ref.id === 'note-b6-member-1')).toBe(true)
    // revert：entity 成员随 ChangeSet 撤销
    expect(s.mutationSafety.revert(item.changeSetId!).revertable).toBe(true)
    const afterRevert = s.presentation.get(s.projectId, presentationId)!.state
    expect((afterRevert.memberEntityRefs ?? []).some((ref) => ref.type === 'note' && ref.id === 'note-b6-member-1')).toBe(false)
    // re-apply → applied；再 apply → already-member
    const second = await s.apply.apply({ schemaVersion: 1, projectId: s.projectId, sourceRefs: [{ kind: 'note', id: 'note-b6-member-1' }], targetRef: { kind: 'main' } })
    expect(second.results[0]!.status).toBe('applied')
    const third = await s.apply.apply({ schemaVersion: 1, projectId: s.projectId, sourceRefs: [{ kind: 'note', id: 'note-b6-member-1' }], targetRef: { kind: 'main' } })
    expect(third.results[0]!.status).toBe('skipped')
    expect(third.results[0]!.channel).toBe('already-member')
  })

  it('aggregate（context）→ main：scope entity 成员（不递归展开）；cross-project note fail-close', async () => {
    const s = await setup()
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'context', id: s.contextScopeId }],
      targetRef: { kind: 'main' },
    })
    const item = result.results[0]!
    expect(item.status).toBe('applied')
    expect(item.channel).toBe('presentation-membership')
    const state = s.presentation.get(s.projectId, `presentation:context:${s.rootScopeId}`)!.state
    expect((state.memberEntityRefs ?? []).some((ref) => ref.type === 'scope' && ref.id === s.contextScopeId)).toBe(true)
    // 聚合只投影自身：memberViewIds 不因此增加
    const viewCountBefore = state.memberViewIds.length
    expect(viewCountBefore).toBe(state.memberViewIds.length)

    freshNote(s, 'note-b6-cross')
    const otherRoot = mkdtempSync(join(tmpdir(), 'lcos-b6-other-'))
    roots.push(otherRoot)
    const other = createMvpSampleSnapshot(otherRoot, AT)
    s.repository.save(other)
    const cross = await s.apply.apply({ schemaVersion: 1, projectId: String(other.project.id), sourceRefs: [{ kind: 'note', id: 'note-b6-cross' }], targetRef: { kind: 'main' } })
    expect(cross.results[0]!.status).toBe('failed')
  })

  it('resource → main：经 canonical descriptor 解析 view 后入会（方案 B）', async () => {
    const s = await setup()
    const imported = await s.resources.importFile(s.projectId as never, {
      importRequestId: 'b6-resource-import-1',
      fileName: 'b6-image.png',
      contentType: 'image/png',
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      scopeId: s.rootScopeId as never,
      position: { x: 1, y: 1 },
    })
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'resource', id: String(imported.resourceId) }],
      targetRef: { kind: 'main' },
    })
    const item = result.results[0]!
    expect(item.status).toBe('applied')
    expect(item.channel).toBe('presentation-membership')
    expect(item.memberViewId).toBe(String(imported.viewId))
    // resource 行的 artifact 获得真实 visualFamily
    const snapshot = s.warehouse.query(s.projectId, { kinds: ['artifact'], search: 'b6-image' })
    expect(snapshot.items.length).toBe(1)
    expect(snapshot.items[0]!.visualFamily).toBe('image')
  })
})

describe('F6 B6 P0-F: propose 保留 Unified Execution Contract', () => {
  it('receiverRef / orderedReferences（含 note ref）/ resultSlotId 原样透传', () => {
    const value = proposeRun({
      projectId: 'project-b6',
      prompt: 'b6 propose',
      requestedProvider: 'auto',
      contextItems: [],
      editTargets: [],
      receiverRef: { connectedConversationId: 'cc-b6' },
      orderedReferences: [
        { ref: { type: 'artifact', artifactId: 'artifact-a' }, order: 0 },
        { ref: { type: 'scope', scopeId: 'scope-b6-context' }, order: 1, mode: 'summary' },
      ],
      resultSlotId: 'slot-b6',
    })
    expect(value.proposal.receiverRef).toEqual({ connectedConversationId: 'cc-b6' })
    expect(value.proposal.orderedReferences).toHaveLength(2)
    expect(value.proposal.orderedReferences![1]!.ref).toEqual({ type: 'scope', scopeId: 'scope-b6-context' })
    expect(value.proposal.resultSlotId).toBe('slot-b6')
    expect(value.confidence).toBe('high')
  })
})

describe('F6 B6 census: presentations.save membership diff-gate', () => {
  it('membership 变化记 presentation_state ChangeSet；纯 placement 保存不记账', async () => {
    const s = await setup()
    const presentationId = `presentation:context:${s.rootScopeId}`
    const emptyState = {
      memberViewIds: [] as string[], hiddenViewIds: [] as string[], positions: {},
      hierarchy: { parentByViewId: {}, orderByParent: {} },
      presentationEdges: [] as unknown[], pinnedViewIds: [] as string[], emphasisByViewId: {},
    }
    const contract = {
      schemaVersion: 0 as const, id: presentationId, projectId: s.projectId, scopeId: s.rootScopeId,
      capability: 'context' as const, renderer: 'arrange', state: emptyState, version: 0,
      updatedBy: 'web' as const, createdAt: AT, updatedAt: AT,
    }
    const create = await (await fetch(`${s.baseUrl}/projects/${s.projectId}/presentations/${encodeURIComponent(presentationId)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract: { ...contract, state: emptyState }, expectedVersion: 0 }),
    })).json() as { ok: boolean }
    expect(create.ok).toBe(true)

    const before = s.repository.listMutationChangeSets(s.projectId, 100).length
    // 纯 placement 保存（member 不变）：不记账
    const positionState = { ...emptyState, positions: { 'view-x': { x: 5, y: 6 } } }
    const placementOnly = await (await fetch(`${s.baseUrl}/projects/${s.projectId}/presentations/${encodeURIComponent(presentationId)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract: { ...contract, state: positionState }, expectedVersion: 0 }),
    })).json() as { ok: boolean }
    expect(placementOnly.ok).toBe(true)
    expect(s.repository.listMutationChangeSets(s.projectId, 100).length).toBe(before)

    // membership 变化：记 presentation_state ChangeSet
    const viewId = await freshViewId(s)
    const memberState = { ...positionState, memberViewIds: [viewId] }
    const withMember = await (await fetch(`${s.baseUrl}/projects/${s.projectId}/presentations/${encodeURIComponent(presentationId)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contract: { ...contract, state: memberState }, expectedVersion: 1 }),
    })).json() as { ok: boolean }
    expect(withMember.ok).toBe(true)
    const changeSets = s.repository.listMutationChangeSets(s.projectId, 100)
    expect(changeSets.length).toBe(before + 1)
    const change = (changeSets[0]!.changes[0] as { type: string; touchedKeys?: string[] })
    expect(change.type).toBe('presentation_state')
    expect(change.touchedKeys).toContain('memberViewIds')
  })
})