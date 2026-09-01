/**
 * F6 follow-up B5 验收测试（20260828 补充冻结：Main/Context/Workflow/Scene Presentation Membership）。
 *
 * 对照补充冻结 §8 必测清单：
 *   Main add/re-add + revert(reapply)、Context add/remove/revert、Workflow blank drop 不建 action、
 *   Scene add + restart + revert、cross-project fail-close、capture→main 幂等重试、placement 分层。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { createMvpSampleSnapshot } from '../src/mvp-sample-project.js'
import { AssemblyApplyService } from '../src/assembly-apply-service.js'
import { CaptureStagingService } from '../src/capture-staging-service.js'
import { CaptureSpaceService } from '../src/capture-space-service.js'
import { CapturePlacementService } from '../src/capture-placement-service.js'
import { MutationSafetyService } from '../src/mutation-safety-service.js'
import { PresentationApplicationService } from '../src/presentation-application-service.js'
import { CurationCommandService } from '../src/curation-command-service.js'
import { ConversationImportService } from '../src/conversation-import-service.js'
import { ImportCopyService } from '../src/import-copy-service.js'
import { UniversalResourceImportService } from '../src/resources/universal-resource-import-service.js'
import { IntelligenceProviderService } from '../src/intelligence-provider-service.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

const AT = '2026-08-28T12:00:00.000Z'

function makeScope(projectId: string, id: string, parentScopeId: string, kind: 'context' | 'workflow', name: string) {
  return { id, projectId, parentScopeId, containerViewId: null, kind, name, createdAt: AT, updatedAt: AT }
}

function setup() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b5-db-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b5-project-'))
  const blobRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b5-blobs-'))
  roots.push(dbRoot, projectRoot, blobRoot)
  const dbPath = join(dbRoot, 'metadata.sqlite')
  const repository = new SqliteMetadataRepository(dbPath)
  repositories.push(repository)
  const base = createMvpSampleSnapshot(projectRoot, AT)
  const projectId = String(base.project.id)
  const rootScopeId = String(base.scopes.find((scope) => scope.kind === 'root')!.id)
  const contextScopeId = 'scope-b5-context'
  const workflowScopeId = 'scope-b5-workflow'
  repository.save({
    ...base,
    scopes: [
      ...base.scopes,
      makeScope(base.project.id, contextScopeId, rootScopeId, 'context', 'B5 Context'),
      makeScope(base.project.id, workflowScopeId, rootScopeId, 'workflow', 'B5 Workflow'),
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
  const workspaceId = String(repository.get(projectId)!.workspaces[0]!.id)
  return { dbPath, repository, projectId, rootScopeId, contextScopeId, workflowScopeId, workspaceId, apply, mutationSafety, presentation, curationCommand, staging }
}

async function freshViewId(s: ReturnType<typeof setup>): Promise<string> {
  const created = await s.curationCommand.createText(s.projectId, { scopeId: s.rootScopeId, title: 'B5 member', body: 'b5 membership test content' })
  return String(created.viewId)
}

describe('F6 B5: Main presentation membership（root scope context 投影）', () => {
  it('artifactView → main: ChangeSet + placement 同 patch；re-add skip；revert 撤 membership+投影；reapply 恢复', async () => {
    const s = setup()
    const viewId = await freshViewId(s)
    const presentationId = `presentation:context:${s.rootScopeId}`

    const first = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'main' },
      placementBySource: { [viewId]: { x: 100, y: 200 } },
    })
    const item = first.results[0]!
    expect(item.status).toBe('applied')
    expect(item.channel).toBe('presentation-membership')
    expect(item.presentationId).toBe(presentationId)
    expect(item.memberViewId).toBe(viewId)
    expect(item.changeSetId).toBeTruthy()
    expect(item.placementApplied).toBe(true)
    expect(first.changeSetId).toBe(item.changeSetId)

    const presentation = s.presentation.get(s.projectId, presentationId)!
    expect(presentation.state.memberViewIds).toContain(viewId)
    expect(presentation.state.positions[viewId]).toEqual({ x: 100, y: 200 })

    // re-add：幂等 skip（不 duplicate）
    const second = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'main' },
    })
    expect(second.results[0]!.status).toBe('skipped')
    expect(second.results[0]!.channel).toBe('already-member')

    // revert：membership+初始投影一起撤（补充冻结 §7）
    const revert = s.mutationSafety.revert(item.changeSetId!)
    expect(revert.revertable).toBe(true)
    const after = s.presentation.get(s.projectId, presentationId)!
    expect(after.state.memberViewIds).not.toContain(viewId)
    expect(after.state.positions[viewId]).toBeUndefined()

    // reapply：forward snapshot 恢复
    const redo = s.mutationSafety.reapply(item.changeSetId!)
    expect(redo.revertable).toBe(true)
    const restored = s.presentation.get(s.projectId, presentationId)!
    expect(restored.state.memberViewIds).toContain(viewId)
    expect(restored.state.positions[viewId]).toEqual({ x: 100, y: 200 })
  })

  it('already-member + placement：纯位置更新，不产生新 semantic ChangeSet（分层）', async () => {
    const s = setup()
    const viewId = await freshViewId(s)
    const presentationId = `presentation:context:${s.rootScopeId}`
    await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'main' },
      placementBySource: { [viewId]: { x: 1, y: 1 } },
    })
    const moved = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'main' },
      placementBySource: { [viewId]: { x: 55, y: 66 } },
    })
    const item = moved.results[0]!
    expect(item.status).toBe('skipped')
    expect(item.channel).toBe('already-member')
    expect(item.placementApplied).toBe(true)
    expect(item.changeSetId).toBeUndefined()
    const presentation = s.presentation.get(s.projectId, presentationId)!
    expect(presentation.state.positions[viewId]).toEqual({ x: 55, y: 66 })
  })
})

describe('F6 B5: Context / Workflow membership', () => {
  it('artifactView → context：scaffold + membership；revert 移除成员', async () => {
    const s = setup()
    const viewId = await freshViewId(s)
    const presentationId = `presentation:context:${s.contextScopeId}`
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'context', id: s.contextScopeId },
    })
    const item = result.results[0]!
    expect(item.status).toBe('applied')
    expect(item.presentationId).toBe(presentationId)
    const presentation = s.presentation.get(s.projectId, presentationId)!
    expect(presentation.state.memberViewIds).toContain(viewId)
    expect(s.mutationSafety.revert(item.changeSetId!).revertable).toBe(true)
    expect(s.presentation.get(s.projectId, presentationId)!.state.memberViewIds).not.toContain(viewId)
  })

  it('artifactView → workflow blank：material/reference membership；绝不自动创建 Action/Step', async () => {
    const s = setup()
    const viewId = await freshViewId(s)
    const relationsBefore = s.repository.getRelations(s.projectId).length
    const presentationId = `presentation:workflow:${s.workflowScopeId}`
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'workflow', id: s.workflowScopeId },
    })
    const item = result.results[0]!
    expect(item.status).toBe('applied')
    expect(item.presentationId).toBe(presentationId)
    const state = s.presentation.get(s.projectId, presentationId)!.state
    expect(state.memberViewIds).toContain(viewId)
    expect(state.workflowActions ?? []).toHaveLength(0)
    expect(state.workflowActionEdges ?? []).toHaveLength(0)
    expect(s.repository.getRelations(s.projectId).length).toBe(relationsBefore)
  })

  it('cross-project context target is rejected（fail-close）', async () => {
    const s = setup()
    const viewId = await freshViewId(s)
    // 第二个项目 + 其私有 context scope
    const otherRoot = mkdtempSync(join(tmpdir(), 'lcos-f6-b5-other-'))
    roots.push(otherRoot)
    const other = createMvpSampleSnapshot(otherRoot, AT)
    const otherRootScopeId = String(other.scopes.find((scope) => scope.kind === 'root')!.id)
    const otherContextId = 'scope-b5-other-context'
    s.repository.save({
      ...other,
      scopes: [...other.scopes, makeScope(other.project.id, otherContextId, otherRootScopeId, 'context', 'Other Context')] as never,
    })
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'context', id: otherContextId },
    })
    expect(result.results[0]!.status).toBe('failed')
    expect(result.allApplied).toBe(false)
  })
})

describe('F6 B5: Scene（workspace working-set membership，ChangeSet）', () => {
  it('artifactView → scene：membership 进 ChangeSet；restart 持久；revert 移除', async () => {
    const s = setup()
    const viewId = await freshViewId(s)
    const before = s.repository.listWorkspaceMembers(s.workspaceId as never).length
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'artifactView', id: viewId }],
      targetRef: { kind: 'scene', id: s.workspaceId },
    })
    const item = result.results[0]!
    expect(item.status).toBe('applied')
    expect(item.channel).toBe('workspace-membership')
    expect(item.changeSetId).toBeTruthy()
    expect(s.repository.listWorkspaceMembers(s.workspaceId as never).length).toBe(before + 1)

    // restart evidence：close → reopen，membership + ChangeSet 均持久
    s.repository.close()
    repositories.pop()
    const reopened = new SqliteMetadataRepository(s.dbPath)
    repositories.push(reopened)
    expect(reopened.listWorkspaceMembers(s.workspaceId as never).some((member) => String(member.artifactViewId) === viewId)).toBe(true)
    const reopenedPresentation = new PresentationApplicationService(reopened, reopened)
    const reopenedSafety = new MutationSafetyService(reopened, reopenedPresentation)
    const revert = reopenedSafety.revert(item.changeSetId!)
    expect(revert.revertable).toBe(true)
    expect(reopened.listWorkspaceMembers(s.workspaceId as never).some((member) => String(member.artifactViewId) === viewId)).toBe(false)
  })
})

describe('F6 B5: capture → surface 幂等重试', () => {
  it('capture → main：materialize once + membership；re-apply 复用产物不重复物化', async () => {
    const s = setup()
    const staged = await s.staging.enqueue({
      operationId: 'f6-b5-capture-1',
      kind: 'text',
      payloadBytes: new TextEncoder().encode('b5 capture to main surface'),
      source: { title: 'B5 Capture' },
      suggestedProjects: [],
    })
    const artifactsBefore = s.repository.getArtifacts(s.projectId).length
    const first = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'capture', id: staged.id }],
      targetRef: { kind: 'main' },
      placementBySource: { [staged.id]: { x: 7, y: 8 } },
    })
    const item = first.results[0]!
    expect(item.status).toBe('applied')
    expect(item.channel).toBe('presentation-membership')
    expect(item.memberViewId).toBeTruthy()
    expect(s.repository.getArtifacts(s.projectId).length).toBe(artifactsBefore + 1)
    const presentation = s.presentation.get(s.projectId, `presentation:context:${s.rootScopeId}`)!
    expect(presentation.state.memberViewIds).toContain(item.memberViewId)

    // 重试：materialize 复用既有产物（artifact 不 +1）+ membership already-member
    const second = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'capture', id: staged.id }],
      targetRef: { kind: 'main' },
    })
    expect(second.results[0]!.status).toBe('skipped')
    expect(second.results[0]!.channel).toBe('already-member')
    expect(s.repository.getArtifacts(s.projectId).length).toBe(artifactsBefore + 1)
  })
})

describe('F6 B5: 边界（aggregate source / skill）', () => {
  it('aggregate source（context）→ main：B6 已接 memberEntityRefs 通道（升级后的语义）', async () => {
    const s = setup()
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'context', id: s.contextScopeId }],
      targetRef: { kind: 'main' },
    })
    // B5 时该组合 unsupported（待冻结）；B6 补洞单 P0-A/P0-E 落地后为 entity 成员入会。
    expect(result.results[0]!.status).toBe('applied')
    expect(result.results[0]!.channel).toBe('presentation-membership')
    const state = s.presentation.get(s.projectId, `presentation:context:${s.rootScopeId}`)!.state
    expect((state.memberEntityRefs ?? []).some((ref) => ref.type === 'scope' && ref.id === s.contextScopeId)).toBe(true)
  })

  it('skill source → main stays unsupported（v0.15 只读裁定）', async () => {
    const s = setup()
    const result = await s.apply.apply({
      schemaVersion: 1,
      projectId: s.projectId,
      sourceRefs: [{ kind: 'skill', id: 'some-skill', source: 'system' }],
      targetRef: { kind: 'main' },
    })
    expect(result.results[0]!.status).toBe('skipped')
    expect(result.results[0]!.channel).toBe('unsupported')
  })
})