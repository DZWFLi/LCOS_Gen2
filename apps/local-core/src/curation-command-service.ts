import { createHash, randomUUID } from 'node:crypto'

import type {
  CurationPatchReceiptV0,
  CurationPatchStepReceiptV0,
  CurationPatchV0,
  CurationTextUpdateOutcomeV1,
  CurationWriteConflictV1,
  MutationChangeItemV1,
  MutationChangeSetV1,
  PresentationEntityRefV0,
  PresentationStateV0,
} from '@local-creative-os/contracts'
import { buildCurationConflictHintV1 } from '@local-creative-os/contracts'
import type { ProjectId, Relation, RelationId } from '@local-creative-os/domain'

import { PresentationApplicationService } from './presentation-application-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { SessionReadSet } from './session-read-set.js'
import type { MutationSafetyService } from './mutation-safety-service.js'
import type { SemanticIndexService } from './semantic-index-service.js'
import { buildTextArtifactDraft, createTextArtifact, reviseManagedTextArtifact } from './text-artifact-service.js'
import { dirname } from 'node:path'
import { mkdir, rename, rm } from 'node:fs/promises'

export interface CurationCommandServiceDeps {
  readonly repository: SqliteMetadataRepository
  readonly presentations: PresentationApplicationService
  /** HU-2b（任务三第二刀）：agent 写 guard 的 lease 源；缺省则 updateText 不设防（向后兼容）。 */
  readonly sessionReadSet?: SessionReadSet  /** 任务四 P1：change-review 记账（agent 文本写产生 ChangeSet）；缺省不记账。 */
  readonly mutationSafety?: MutationSafetyService
  /** F6 P0-A2（20260828）：mutation-driven 索引挂点；缺省不 reindex（search-time repair 兜底）。 */
  readonly semantic?: SemanticIndexService
}

/**
 * Phase E: Agent write commands with stable receipts and clientRef mapping.
 * Owns project/scope validation and calls existing services; never writes SQL.
 */
export class CurationCommandService {
  readonly #receipts = new Map<string, CurationPatchReceiptV0>()

  constructor(private readonly deps: CurationCommandServiceDeps) {}

  async createText(projectId: string, input: { readonly scopeId: string; readonly title?: string; readonly body: string; readonly x?: number; readonly y?: number; readonly sessionId?: string }) {
    const result = await createTextArtifact(this.deps.repository, projectId as ProjectId, input)
    // F6 P0-A2：文本创建即索引（mutation-driven，不等 search-time repair）。
    if (this.deps.semantic !== undefined) await this.deps.semantic.reindexArtifact(projectId, String(result.artifactId))
    // 任务四 P1：agent 创建也进 change-review（撤销 = 删 artifact；正文被人改过则阻断）。GUI 直建不记账。
    if (typeof input.sessionId === 'string' && input.sessionId !== '' && this.deps.mutationSafety !== undefined) {
      try {
        this.deps.mutationSafety.record({
          projectId,
          operationId: `curation-text-${randomUUID()}`,
          actorKind: 'agent',
          actorId: input.sessionId,
          changes: [{
            type: 'artifact_text_create',
            artifactId: result.artifactId,
            viewId: result.viewId,
            revisionId: result.revisionId,
            createdContentHash: createHash('sha256').update(input.body, 'utf8').digest('hex'),
            inverse: { type: 'delete_artifact', artifactId: result.artifactId },
            appliedFingerprint: `artifact:${result.artifactId}:created`,
          }],
        })
      } catch (error: unknown) {
        console.warn(`[curation] change-set record failed for text create: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return result
  }

  /**
   * HU-2b / 任务三第二刀（20260826）：CAS guard 下沉 mutation 层。
   * sessionId 存在 = agent 写：必须持有该 session 的 full-read lease（not-read/stale 两态拒绝）；
   * 无 sessionId（GUI 直编）不设防。拒绝时返回结构化 conflicts + conflictHint（huabu ExecuteConflict 同构）。
   */
  async updateText(
    projectId: string,
    target: { readonly viewId?: string; readonly artifactId?: string },
    body: string,
    options: { readonly sessionId?: string } = {},
  ): Promise<CurationTextUpdateOutcomeV1> {
    if (typeof options.sessionId === 'string' && this.deps.sessionReadSet !== undefined) {
      const artifactId = target.artifactId
        ?? (target.viewId === undefined ? undefined : this.deps.repository.getArtifactView(target.viewId)?.artifactId)
      if (artifactId !== undefined) {
        const artifact = this.deps.repository.getArtifact(String(artifactId))
        if (artifact !== undefined) {
          const lease = this.deps.sessionReadSet.getLease(options.sessionId, String(artifactId))
          if (lease === undefined) {
            const conflicts: CurationWriteConflictV1[] = [{
              artifactId: String(artifactId),
              ...(target.viewId === undefined ? {} : { viewId: target.viewId }),
              reason: 'not-read',
              ...(artifact.currentRevisionId === undefined ? {} : { currentRevisionId: String(artifact.currentRevisionId) }),
              hint: 'Read before write: read the conflicted node(s) first, then re-issue. Retrying as-is fails again.',
            }]
            return { outcome: 'rejected', conflicts, conflictHint: buildCurationConflictHintV1(conflicts) }
          }
          if (artifact.currentRevisionId !== undefined && lease.revisionId !== String(artifact.currentRevisionId)) {
            const conflicts: CurationWriteConflictV1[] = [{
              artifactId: String(artifactId),
              ...(target.viewId === undefined ? {} : { viewId: target.viewId }),
              reason: 'stale',
              expectedRevisionId: lease.revisionId,
              currentRevisionId: String(artifact.currentRevisionId),
              hint: 'Node(s) changed since your last read — re-read, reconcile, then re-issue.',
            }]
            return { outcome: 'rejected', conflicts, conflictHint: buildCurationConflictHintV1(conflicts) }
          }
        }
      }
    }
    // 任务四 P1：记账前先冻结 before 指针（revise 之后 current 即前进）。
    const targetArtifactId = target.artifactId
      ?? (target.viewId === undefined ? undefined : this.deps.repository.getArtifactView(target.viewId)?.artifactId)
    const beforeRevisionId = targetArtifactId === undefined
      ? undefined
      : this.deps.repository.getArtifact(String(targetArtifactId))?.currentRevisionId
    const result = await reviseManagedTextArtifact(this.deps.repository, projectId as ProjectId, target, body)
    // 任务四 P1 change-review：agent 修订产生可撤销 ChangeSet（inverse = current 指回 before）。
    // 记账与修订是两个事务：记账失败只丢审计卡不丢写（warn 吞掉）；revert 侧另有指针陈旧校验兜底。
    if (typeof options.sessionId === 'string' && options.sessionId !== '' && this.deps.mutationSafety !== undefined
      && targetArtifactId !== undefined && beforeRevisionId !== undefined) {
      try {
        this.deps.mutationSafety.record({
          projectId,
          operationId: `curation-text-${randomUUID()}`,
          actorKind: 'agent',
          actorId: options.sessionId,
          changes: [{
            type: 'artifact_text_update',
            artifactId: String(targetArtifactId),
            ...(result.viewId === '' ? {} : { viewId: result.viewId }),
            beforeRevisionId: String(beforeRevisionId),
            afterRevisionId: result.revisionId,
            inverse: { type: 'restore_artifact_text', artifactId: String(targetArtifactId), targetRevisionId: String(beforeRevisionId) },
            forward: { type: 'restore_artifact_text', artifactId: String(targetArtifactId), targetRevisionId: result.revisionId },
            appliedFingerprint: `artifact:${String(targetArtifactId)}:${createHash('sha256').update(body, 'utf8').digest('hex')}`,
          }],
        })
      } catch (error: unknown) {
        console.warn(`[curation] change-set record failed for text update: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // F6 P0-A2：文本修订即重索引（contentHash 未变时幂等跳过）。
    if (this.deps.semantic !== undefined && targetArtifactId !== undefined) {
      await this.deps.semantic.reindexArtifact(projectId, String(targetArtifactId))
    }
    return { outcome: 'applied', ...result }
  }

  async applyPatch(projectId: string, patch: CurationPatchV0): Promise<CurationPatchReceiptV0> {
    const operationId = patch.operationId ?? `curation-${randomUUID()}`
    // HU-1A: 幂等以 SQLite 为准（热缓存仅作提速），跨重启重试返回同一 receipt。
    const existing = this.deps.repository.getCurationReceipt(operationId) ?? this.#receipts.get(operationId)
    if (existing !== undefined) return existing
    const createdAt = new Date().toISOString()
    const completedSteps: CurationPatchStepReceiptV0[] = []
    const refToId = new Map<string, string>()

    const fail = (step: string, error: string): CurationPatchReceiptV0 => {
      const receipt = { schemaVersion: 0 as const, operationId, applied: false, completedSteps, failedStep: { step, error }, createdAt }
      this.deps.repository.saveCurationReceipt(receipt, projectId)
      this.#receipts.set(operationId, receipt)
      return receipt
    }

    // ---- HU-1A prevalidation：任何 mutation 之前验证全部输入，失败 = 0 mutation ----
    if (this.deps.repository.getProject(projectId) === undefined) return fail('validate', 'Project not found.')
    const scopeValid = this.deps.repository.get(projectId)?.scopes.some((scope) => String(scope.id) === patch.scopeId) ?? false
    if (!scopeValid) return fail('validate', 'Scope does not belong to the project.')

    // createTexts clientRef 必须唯一
    const createRefs = new Set<string>()
    for (const text of patch.createTexts) {
      if (text.clientRef === undefined || text.clientRef.trim() === '') return fail('validate', `createText clientRef is required: ${text.title ?? 'untitled'}`)
      if (createRefs.has(text.clientRef)) return fail('validate', `Duplicate clientRef: ${text.clientRef}`)
      createRefs.add(text.clientRef)
    }

    // relations 端点必须可解析（clientRef 已声明 或 entityId 真实存在）
    const viewExists = (id: string): boolean => {
      if (this.deps.repository.getArtifactView(id) !== undefined) return true
      return this.deps.repository.getArtifact(id) !== undefined
    }
    for (const relation of patch.relations) {
      for (const [side, target] of [['from', relation.from], ['to', relation.to]] as const) {
        if (target.clientRef !== undefined) {
          if (!createRefs.has(target.clientRef)) return fail('validate', `Relation ${side} clientRef not declared in createTexts: ${target.clientRef}`)
        } else if (target.entityId !== undefined) {
          if (!viewExists(target.entityId)) return fail('validate', `Relation ${side} entity not found: ${target.entityId}`)
        } else {
          return fail('validate', `Relation ${side} requires clientRef or entityId.`)
        }
      }
    }

    // presentation 必须先存在且版本匹配；成员/边引用预解析
    if (patch.presentation !== undefined) {
      const current = this.deps.presentations.get(projectId, patch.presentation.presentationId)
      if (current === undefined) return fail('validate', 'Presentation not found.')
      if (current.version !== patch.presentation.expectedVersion) {
        return fail('validate', `STALE_PRESENTATION_VERSION current=${current.version}`)
      }
      for (const member of patch.presentation.addMembers ?? []) {
        const declared = member.clientRef !== undefined && createRefs.has(member.clientRef)
        const exists = member.entityId !== undefined && viewExists(member.entityId)
        if (!declared && !exists) {
          return fail('validate', `Presentation member not resolvable: ${JSON.stringify(member)}`)
        }
      }
      // F6 B6：entity 成员（scope/workspace/conversation/note）必须解析到本 project 实体。
      for (const entityRef of patch.presentation.addEntityMembers ?? []) {
        if (!this.#entityRefBelongsToProject(projectId, entityRef)) {
          return fail('validate', `Presentation entity member not resolvable: ${JSON.stringify(entityRef)}`)
        }
      }      for (const edge of patch.presentation.addPresentationEdges ?? []) {
        const fromOk = edge.from.clientRef !== undefined ? createRefs.has(edge.from.clientRef) : edge.from.entityId !== undefined && viewExists(edge.from.entityId)
        const toOk = edge.to.clientRef !== undefined ? createRefs.has(edge.to.clientRef) : edge.to.entityId !== undefined && viewExists(edge.to.entityId)
        if (!fromOk || !toOk) {
          return fail('validate', `Presentation edge endpoint not resolvable: ${JSON.stringify(edge)}`)
        }
      }
    }

    // 1. 构造 drafts（写 staged 文件，DB 未动）
    const drafts = await Promise.all(patch.createTexts.map((text) => buildTextArtifactDraft(this.deps.repository, projectId as ProjectId, {
      ...(text.title === undefined ? {} : { title: text.title }),
      body: text.body,
      scopeId: patch.scopeId,
    })))
    drafts.forEach((draft, index) => refToId.set(patch.createTexts[index]!.clientRef, draft.viewId))

    // 2. 构造 relations（含 inverse 供 change set）
    const relationUpserts: Relation[] = []
    const changes: MutationChangeItemV1[] = []
    for (const relation of patch.relations) {
      const fromId = this.#resolveTarget(projectId, relation.from, refToId)
      const toId = this.#resolveTarget(projectId, relation.to, refToId)
      const value: Relation = {
        id: `relation-curation-${randomUUID()}` as RelationId,
        projectId: projectId as ProjectId,
        sourceEntityType: 'view',
        sourceEntityId: fromId,
        targetEntityType: 'view',
        targetEntityId: toId,
        kind: relation.kind ?? relation.label ?? 'reference',
        ...(relation.origin === undefined ? {} : { origin: relation.origin }),
        ...(relation.createdBy === undefined ? {} : { createdBy: relation.createdBy }),
        ...(relation.confidence === undefined ? {} : { confidence: relation.confidence }),
        createdAt,
        updatedAt: createdAt,
      }
      relationUpserts.push(value)
      changes.push({ type: 'relation_upsert', relationId: value.id, inverse: { type: 'delete_relation', relationId: value.id }, appliedFingerprint: `relation:${value.id}:applied` })
    }

    // 任务四 P1：batch 内的 text 创建同样进 change-review（与 relation/presentation 同一复合事务，原子）。
    for (const draft of drafts) {
      changes.push({
        type: 'artifact_text_create',
        artifactId: String(draft.artifact.id),
        viewId: draft.viewId,
        revisionId: String(draft.revision.id),
        createdContentHash: String(draft.revision.contentHash),
        inverse: { type: 'delete_artifact', artifactId: String(draft.artifact.id) },
        appliedFingerprint: `artifact:${String(draft.artifact.id)}:created`,
      })
    }

    // 3. presentation（CAS 在复合事务内）
    let presentationPlan: { readonly value: import('@local-creative-os/contracts').PresentationViewV0; readonly expectedVersion: number } | undefined
    if (patch.presentation !== undefined) {
      const current = this.deps.presentations.get(projectId, patch.presentation.presentationId)
      if (current === undefined) return fail('validate', 'Presentation not found.')
      const next = this.#applyPresentationPatch(current.state, patch.presentation, refToId)
      presentationPlan = {
        value: {
          schemaVersion: 0,
          id: current.id,
          projectId: current.projectId,
          scopeId: current.scopeId,
          capability: current.capability,
          renderer: patch.presentation.setRenderer ?? current.renderer,
          state: next,
          version: current.version + 1,
          updatedBy: patch.actorKind ?? 'agent',
          createdAt: current.createdAt,
          updatedAt: createdAt,
        },
        expectedVersion: current.version,
      }
      changes.unshift({
        type: 'presentation_state',
        presentationId: current.id,
        beforeVersion: current.version,
        afterVersion: current.version + 1,
        inverse: { type: 'restore_presentation_state', presentationId: current.id, targetVersion: current.version, stateSnapshot: current.state },
        forward: { type: 'restore_presentation_state', presentationId: current.id, stateSnapshot: next },
        touchedKeys: ['memberViewIds', 'hierarchy', 'emphasisByViewId', 'pinnedViewIds', 'presentationEdges', ...(patch.presentation.setPositions === undefined ? [] : ['positions' as const]), ...((patch.presentation.addEntityMembers ?? []).length === 0 ? [] : ['memberEntityRefs' as const])],
        appliedFingerprint: `presentation:${current.version + 1}`,
      })
    }

    // 4. 复合提交：text DB + relations + presentation + change set + receipt 单事务
    const changeSet: MutationChangeSetV1 = {
      schemaVersion: 1,
      id: `changeset-${randomUUID()}`,
      projectId,
      operationId,
      actorKind: patch.actorKind ?? 'agent',
      changes,
      status: 'applied',
      createdAt,
    }
    // steps 在事务前组装完整（receipt 以完整状态进入复合事务持久化）
    for (const [index, draft] of drafts.entries()) {
      completedSteps.push({ step: 'createText', clientRef: patch.createTexts[index]!.clientRef, artifactId: String(draft.artifact.id), viewId: draft.viewId, revisionId: String(draft.revision.id) })
    }
    for (const relation of relationUpserts) completedSteps.push({ step: 'relation', relationId: relation.id })
    if (presentationPlan !== undefined) completedSteps.push({ step: 'presentation' })
    const receipt: CurationPatchReceiptV0 = { schemaVersion: 0, operationId, applied: true, completedSteps, createdAt, changeSetId: changeSet.id }
    try {
      this.deps.repository.runCurationMutation({
        projectId,
        textCreates: drafts.map((draft) => ({
          fileRecord: draft.fileRecord,
          artifact: draft.artifact,
          revision: draft.revision,
          view: draft.view,
        })),
        relationUpserts,
        ...(presentationPlan === undefined ? {} : { presentation: presentationPlan }),
        changeSet,
        receipt,
      })
    } catch (error: unknown) {
      await Promise.all(drafts.map((draft) => rm(draft.stagedPath, { force: true }).catch(() => undefined)))
      return fail('composite', error instanceof Error ? error.message : String(error))
    }

    // 5. 提交成功后归位 staged 文件
    for (const draft of drafts) {
      try {
        await mkdir(dirname(draft.finalPath), { recursive: true })
        await rename(draft.stagedPath, draft.finalPath)
      } catch {
        // rename 失败：DB 已提交，启动 sweep 会按 id 归位
      }
    }
    this.#receipts.set(operationId, receipt)
    return receipt
  }

  /** F6 B6：entity 成员的 project 归属校验（scope/workspace/conversation/note 各查 canonical truth）。 */
  #entityRefBelongsToProject(projectId: string, ref: PresentationEntityRefV0): boolean {
    if (ref.type === 'scope') return this.deps.repository.get(projectId)?.scopes.some((scope) => String(scope.id) === ref.id) ?? false
    if (ref.type === 'workspace') return String(this.deps.repository.getWorkspace(ref.id)?.projectId ?? '') === projectId
    if (ref.type === 'conversation') return this.deps.repository.getConnectedConversation(projectId, ref.id) !== undefined
    if (ref.type === 'note') return String(this.deps.repository.getNote(ref.id)?.projectId ?? '') === projectId
    return false
  }
  #resolveTarget(projectId: string, target: { readonly clientRef?: string; readonly entityType?: string; readonly entityId?: string }, refToId: Map<string, string>): string {
    if (target.clientRef !== undefined) {
      const mapped = refToId.get(target.clientRef)
      if (mapped === undefined) throw new Error(`clientRef ${target.clientRef} has no created view yet.`)
      return mapped
    }
    if (target.entityId !== undefined) return target.entityId
    throw new Error('Relation target requires clientRef or entityId.')
  }

  #applyPresentationPatch(
    state: PresentationStateV0,
    patch: CurationPatchV0['presentation'],
    refToId: Map<string, string>,
  ): PresentationStateV0 {
    let memberViewIds = [...state.memberViewIds]
    const resolve = (target: { readonly clientRef?: string; readonly entityType?: string; readonly entityId?: string }): string => {
      if (target.clientRef !== undefined) {
        const mapped = refToId.get(target.clientRef)
        if (mapped === undefined) throw new Error(`clientRef ${target.clientRef} has no created view yet.`)
        return mapped
      }
      if (target.entityId !== undefined) return target.entityId
      throw new Error('Member ref requires clientRef or entityId.')
    }
    for (const member of patch?.addMembers ?? []) {
      const id = resolve(member)
      if (!memberViewIds.includes(id)) memberViewIds.push(id)
    }
    const removed = new Set(patch?.removeMembers ?? [])
    memberViewIds = memberViewIds.filter((id) => !removed.has(id))
    const members = new Set(memberViewIds)
    // F6 B6（P0-A aggregate / P0-E note）：entity 成员并入 memberEntityRefs（type:id 去重；不递归展开）。
    const memberEntityRefs = [...(state.memberEntityRefs ?? [])]
    const entityKeyOf = (ref: PresentationEntityRefV0): string => `${ref.type}:${ref.id}`
    const entityKeys = new Set(memberEntityRefs.map(entityKeyOf))
    for (const entityRef of patch?.addEntityMembers ?? []) {
      if (!entityKeys.has(entityKeyOf(entityRef))) { memberEntityRefs.push(entityRef); entityKeys.add(entityKeyOf(entityRef)) }
    }
    const hiddenViewIds = state.hiddenViewIds
    const positions = { ...state.positions, ...(patch?.setPositions ?? {}) }
    let hierarchy = state.hierarchy
    if (patch?.setHierarchy !== undefined) {
      hierarchy = {
        parentByViewId: Object.fromEntries(Object.entries(patch.setHierarchy.parentByViewId).filter(([id]) => members.has(id))),
        orderByParent: Object.fromEntries(Object.entries(patch.setHierarchy.orderByParent).map(([parent, children]) => [parent, children.filter((id) => members.has(id))])),
      }
    }
    let presentationEdges = [...state.presentationEdges]
    for (const edge of patch?.addPresentationEdges ?? []) {
      const from = resolve(edge.from)
      const to = resolve(edge.to)
      if (!members.has(from) || !members.has(to)) throw new Error('Presentation edge endpoints must be members.')
      presentationEdges = [...presentationEdges.filter((item) => item.id !== edge.id), { id: edge.id, fromViewId: from, toViewId: to, ...(edge.label === undefined ? {} : { label: edge.label }) }]
    }
    const removedEdges = new Set(patch?.removePresentationEdges ?? [])
    presentationEdges = presentationEdges.filter((edge) => !removedEdges.has(edge.id))
    let pinnedViewIds = [...state.pinnedViewIds]
    for (const id of patch?.pin ?? []) if (!pinnedViewIds.includes(id)) pinnedViewIds.push(id)
    const unpinned = new Set(patch?.unpin ?? [])
    pinnedViewIds = pinnedViewIds.filter((id) => !unpinned.has(id))
    return {
      ...state,
      memberViewIds,
      ...(memberEntityRefs.length > 0 ? { memberEntityRefs } : {}),
      hiddenViewIds,
      positions,
      hierarchy,
      presentationEdges,
      pinnedViewIds,
      emphasisByViewId: { ...state.emphasisByViewId, ...(patch?.setEmphasis ?? {}) },
    }
  }
}
