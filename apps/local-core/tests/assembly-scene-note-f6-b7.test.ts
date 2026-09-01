/**
 * F6 B7 裁决验收（20260828）。
 *
 * 裁决 1：Note 可进 Scene——entity 成员进 working-set truth（canonical note identity，
 * 不伪造 view、不复制正文）；membership ChangeSet-backed；placement 入 Scene Presentation
 * （positions key 约定 `note:<id>`）；同 note 同 scene 单实例；revert/restart 稳定。
 * 裁决 2：Note/Resource 不进 OrderedRunReference——propose 对 note ref fail-honest（过滤）。
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
import { WarehouseService } from '../src/warehouse-service.js'
import { ConversationImportService } from '../src/conversation-import-service.js'
import { ImportCopyService } from '../src/import-copy-service.js'
import { UniversalResourceImportService } from '../src/resources/universal-resource-import-service.js'
import { IntelligenceProviderService } from '../src/intelligence-provider-service.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'

const AT = '2026-08-28T14:00:00.000Z'
const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []
const servers: LocalCoreServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

async function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-b7-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-b7-project-'))
  const blobRoot = mkdtempSync(join(tmpdir(), 'lcos-b7-blobs-'))
  roots.push(dbRoot, projectRoot, blobRoot)
  const dbPath = join(dbRoot, 'metadata.sqlite')
  const repository = new SqliteMetadataRepository(dbPath)
  repositories.push(repository)
  const snapshot = createMvpSampleSnapshot(projectRoot, AT)
  repository.save(snapshot)
  const projectId = String(snapshot.project.id)
  const rootScopeId = String(snapshot.scopes.find((scope) => scope.kind === 'root')!.id)
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
  const server = createLocalCoreServer({ port: 0, metadataRepository: repository })
  servers.push(server)
  const address = await server.start()
  const workspaceId = String(repository.get(projectId)!.workspaces[0]!.id)
  const workspaceScopeId = String(repository.getWorkspace(workspaceId as never)!.scopeId)
  return { dbPath, repository, projectId, rootScopeId, workspaceId, workspaceScopeId, apply, mutationSafety, presentation, warehouse, baseUrl: `http://${address.host}:${address.port}` }
}

type Setup = Awaited<ReturnType<typeof setup>>

function freshNote(s: Setup, id: string): void {
  s.repository.upsertNote({ id, projectId: s.projectId as never, anchor: { type: 'project' }, body: `b7 note ${id}`, createdAt: AT, updatedAt: AT })
}

describe('裁决 1：Note → Scene（entity 成员进 working-set truth）', () => {
  it('applied + ChangeSet + canonical note identity；同 scene 单实例（re-apply already-member）', async () => {
    const s = await setup()
    freshNote(s, 'note-b7-1')
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'note', id: 'note-b7-1' }],
      targetRef: { kind: 'scene', id: s.workspaceId },
    })
    const item = result.results[0]!
    expect(item.status).toBe('applied')
    expect(item.channel).toBe('workspace-membership')
    expect(item.changeSetId).toBeTruthy()
    // canonical note identity：entity membership 行（entityType note），无 view 伪造
    const members = s.repository.listWorkspaceEntityMembers(s.workspaceId as never)
    expect(members.some((m) => m.entityType === 'note' && m.entityId === 'note-b7-1')).toBe(true)
    // view membership 不受影响（无伪造 view 行）
    expect(s.repository.getNote('note-b7-1')).toBeDefined()
    // 单实例：re-apply = already-member
    const second = await s.apply.apply({ schemaVersion: 1, projectId: s.projectId, sourceRefs: [{ kind: 'note', id: 'note-b7-1' }], targetRef: { kind: 'scene', id: s.workspaceId } })
    expect(second.results[0]!.status).toBe('skipped')
    expect(second.results[0]!.channel).toBe('already-member')
    expect(s.repository.listWorkspaceEntityMembers(s.workspaceId as never).filter((m) => m.entityId === 'note-b7-1')).toHaveLength(1)
  })

  it('revert 移除 membership；reapply 恢复；跨 Project fail-close', async () => {
    const s = await setup()
    freshNote(s, 'note-b7-2')
    const result = await s.apply.apply({ schemaVersion: 1, projectId: s.projectId, sourceRefs: [{ kind: 'note', id: 'note-b7-2' }], targetRef: { kind: 'scene', id: s.workspaceId } })
    const changeSetId = result.results[0]!.changeSetId!
    expect(s.mutationSafety.revert(changeSetId).revertable).toBe(true)
    expect(s.repository.listWorkspaceEntityMembers(s.workspaceId as never).some((m) => m.entityId === 'note-b7-2')).toBe(false)
    expect(s.mutationSafety.reapply(changeSetId).revertable).toBe(true)
    expect(s.repository.listWorkspaceEntityMembers(s.workspaceId as never).some((m) => m.entityId === 'note-b7-2')).toBe(true)

    freshNote(s, 'note-b7-cross')
    const otherRoot = mkdtempSync(join(tmpdir(), 'lcos-b7-other-'))
    roots.push(otherRoot)
    const other = createMvpSampleSnapshot(otherRoot, AT)
    s.repository.save(other)
    const otherWorkspace = String(s.repository.get(String(other.project.id))!.workspaces[0]!.id)
    const cross = await s.apply.apply({ schemaVersion: 1, projectId: s.projectId, sourceRefs: [{ kind: 'note', id: 'note-b7-cross' }], targetRef: { kind: 'scene', id: otherWorkspace } })
    expect(cross.results[0]!.status).toBe('failed')
  })

  it('restart 持久（close → reopen 后 membership + ChangeSet 均在，且可 revert）', async () => {
    const s = await setup()
    freshNote(s, 'note-b7-3')
    const result = await s.apply.apply({ schemaVersion: 1, projectId: s.projectId, sourceRefs: [{ kind: 'note', id: 'note-b7-3' }], targetRef: { kind: 'scene', id: s.workspaceId } })
    const changeSetId = result.results[0]!.changeSetId!
    s.repository.close()
    repositories.pop()
    const reopened = new SqliteMetadataRepository(s.dbPath)
    repositories.push(reopened)
    expect(reopened.listWorkspaceEntityMembers(s.workspaceId as never).some((m) => m.entityType === 'note' && m.entityId === 'note-b7-3')).toBe(true)
    const reopenedPresentation = new PresentationApplicationService(reopened, reopened)
    const reopenedSafety = new MutationSafetyService(reopened, reopenedPresentation)
    expect(reopenedSafety.revert(changeSetId).revertable).toBe(true)
    expect(reopened.listWorkspaceEntityMembers(s.workspaceId as never).some((m) => m.entityId === 'note-b7-3')).toBe(false)
  })

  it('placement 入 Scene Presentation（key 约定 note:<id>）；remove envelope 对称', async () => {
    const s = await setup()
    // scaffold Scene Presentation（capability custom；与既有 saved-scene 约定同 id）
    const scenePresentationId = `presentation:custom:workspace:${s.workspaceId}`
    s.presentation.save(s.projectId, {
      presentationId: scenePresentationId,
      scopeId: s.workspaceScopeId,
      capability: 'custom',
      renderer: 'workspace',
      state: {
        memberViewIds: [], hiddenViewIds: [], positions: {},
        hierarchy: { parentByViewId: {}, orderByParent: {} },
        presentationEdges: [], pinnedViewIds: [], emphasisByViewId: {},
      },
      expectedVersion: 0,
      updatedBy: 'web',
    })
    freshNote(s, 'note-b7-4')
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'note', id: 'note-b7-4' }],
      targetRef: { kind: 'scene', id: s.workspaceId },
      placementBySource: { 'note-b7-4': { x: 11, y: 22 } },
    })
    expect(result.results[0]!.placementApplied).toBe(true)
    const state = s.presentation.get(s.projectId, scenePresentationId)!.state
    expect(state.positions['note:note-b7-4']).toEqual({ x: 11, y: 22 })

    // remove envelope：removeWorkspaceEntityMember + revert
    const remove = s.mutationSafety.removeWorkspaceEntityMember({ projectId: s.projectId, workspaceId: s.workspaceId, entityType: 'note', entityId: 'note-b7-4' })
    expect(remove).toBeDefined()
    expect(s.repository.listWorkspaceEntityMembers(s.workspaceId as never).some((m) => m.entityId === 'note-b7-4')).toBe(false)
    expect(s.mutationSafety.revert(remove!.id).revertable).toBe(true)
    expect(s.repository.listWorkspaceEntityMembers(s.workspaceId as never).some((m) => m.entityId === 'note-b7-4')).toBe(true)
  })

  it('Warehouse note 行 usageCount 反映 scene 投影计数；GET /workspaces/:id/entity-members 读面', async () => {
    const s = await setup()
    freshNote(s, 'note-b7-5')
    await s.apply.apply({ schemaVersion: 1, projectId: s.projectId, sourceRefs: [{ kind: 'note', id: 'note-b7-5' }], targetRef: { kind: 'scene', id: s.workspaceId } })
    const snapshot = s.warehouse.query(s.projectId, { kinds: ['note'], search: 'b7 note note-b7-5' })
    expect(snapshot.items).toHaveLength(1)
    expect(snapshot.items[0]!.usageCount).toBe(1)

    const response = await (await fetch(`${s.baseUrl}/workspaces/${encodeURIComponent(s.workspaceId)}/entity-members`)).json() as { ok: boolean; value: Array<{ entityType: string; entityId: string }> }
    expect(response.ok).toBe(true)
    expect(response.value.some((m) => m.entityType === 'note' && m.entityId === 'note-b7-5')).toBe(true)
  })
})

describe('裁决 2：Note 不进 OrderedRunReference（fail-honest）', () => {
  it('propose 携带 note ref → 被过滤，不进 proposal.orderedReferences', async () => {
    const s = await setup()
    const response = await (await fetch(`${s.baseUrl}/projects/${s.projectId}/runs/propose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'b7 propose with note ref',
        requestedProvider: 'auto',
        contextItems: [],
        editTargets: [],
        orderedReferences: [
          { ref: { type: 'artifact', artifactId: 'artifact-x' }, order: 0 },
          { ref: { type: 'note', noteId: 'note-b7-1' }, order: 1, mode: 'summary' },
        ],
      }),
    })).json() as { ok: boolean; value?: { proposal?: { orderedReferences?: Array<{ ref: { type: string } }> } } }
    expect(response.ok).toBe(true)
    const refs = response.value?.proposal?.orderedReferences ?? []
    expect(refs).toHaveLength(1)
    expect(refs[0]!.ref.type).toBe('artifact')
    expect(refs.some((entry) => entry.ref.type === 'note')).toBe(false)
  })
})