import { randomUUID } from 'node:crypto'
import type { PresentationViewV0, ReorganizePreviewV0, ReorganizeProposalV0 } from '@local-creative-os/contracts'
import type { MutationChangeItemV1 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import { PresentationApplicationService } from './presentation-application-service.js'
import { MutationSafetyService } from './mutation-safety-service.js'

export interface CreateReorganizeProposalInputV0 {
  readonly projectId: string
  readonly presentationId: string
  readonly baseVersion: number
  readonly mergeCandidates?: ReorganizeProposalV0['mergeCandidates']
  readonly removeMemberViewIds?: readonly string[]
  readonly artifactDeleteCandidates?: ReorganizeProposalV0['artifactDeleteCandidates']
  readonly hierarchyPatch?: ReorganizeProposalV0['hierarchyPatch']
  readonly relationPatch?: ReorganizeProposalV0['relationPatch']
  readonly emphasisPatch?: ReorganizeProposalV0['emphasisPatch']
  readonly layoutIntent?: ReorganizeProposalV0['layoutIntent']
  readonly positionPatch?: ReorganizeProposalV0['positionPatch']
}

/**
 * Phase D：Agent Reorganize。
 * proposal 持久化（重启可恢复）；apply 前可 preview；destructive 删除必须显式确认；
 * rollback 恢复 presentation 快照（已删 artifact 不可恢复 —— 应用前预览已确认）。
 */
export class ReorganizeService {
  readonly #metadata: SqliteMetadataRepository
  readonly #presentation: PresentationApplicationService
  readonly #mutationSafety: MutationSafetyService

  constructor(metadata: SqliteMetadataRepository, presentation: PresentationApplicationService, mutationSafety: MutationSafetyService) {
    this.#metadata = metadata
    this.#presentation = presentation
    this.#mutationSafety = mutationSafety
  }

  create(input: CreateReorganizeProposalInputV0): ReorganizeProposalV0 {
    const presentation = this.#presentation.get(input.projectId, input.presentationId)
    if (presentation === undefined) throw new Error('Presentation not found.')
    const now = new Date().toISOString()
    const proposal: ReorganizeProposalV0 = {
      schemaVersion: 0,
      id: `reorg-${randomUUID()}`,
      projectId: input.projectId,
      presentationId: input.presentationId,
      baseVersion: input.baseVersion,
      status: 'pending',
      mergeCandidates: input.mergeCandidates ?? [],
      removeMemberViewIds: input.removeMemberViewIds ?? [],
      artifactDeleteCandidates: input.artifactDeleteCandidates ?? [],
      ...(input.hierarchyPatch === undefined ? {} : { hierarchyPatch: input.hierarchyPatch }),
      ...(input.relationPatch === undefined ? {} : { relationPatch: input.relationPatch }),
      ...(input.emphasisPatch === undefined ? {} : { emphasisPatch: input.emphasisPatch }),
      ...(input.layoutIntent === undefined ? {} : { layoutIntent: input.layoutIntent }),
      ...(input.positionPatch === undefined ? {} : { positionPatch: input.positionPatch }),
      createdAt: now,
    }
    this.#metadata.createReorganizeProposal(proposal, JSON.stringify(presentation))
    return proposal
  }

  get(id: string): ReorganizeProposalV0 | undefined {
    return this.#metadata.getReorganizeProposal(id)?.proposal
  }

  list(projectId: string): ReorganizeProposalV0[] {
    return this.#metadata.listReorganizeProposals(projectId)
  }

  preview(id: string): ReorganizePreviewV0 {
    const stored = this.#metadata.getReorganizeProposal(id)
    if (stored === undefined) throw new Error('Proposal not found.')
    const proposal = stored.proposal
    const destructive = proposal.artifactDeleteCandidates.length > 0
    return {
      proposalId: proposal.id,
      willRemovePresentationMembers: proposal.removeMemberViewIds,
      willDeleteArtifacts: proposal.artifactDeleteCandidates.map((candidate) => candidate.artifactId),
      willMerge: proposal.mergeCandidates,
      hierarchyChanges: proposal.hierarchyPatch === undefined ? 0 : Object.keys(proposal.hierarchyPatch.parentByViewId).length,
      relationAdds: proposal.relationPatch?.add?.length ?? 0,
      relationRemoves: proposal.relationPatch?.remove?.length ?? 0,
      emphasisChanges: proposal.emphasisPatch === undefined ? 0 : Object.keys(proposal.emphasisPatch).length,
      positionChanges: proposal.positionPatch === undefined ? 0 : Object.keys(proposal.positionPatch).length,
      destructive,
    }
  }

  apply(id: string, options: { readonly confirmDestructive?: boolean } = {}): ReorganizePreviewV0 {
    const stored = this.#metadata.getReorganizeProposal(id)
    if (stored === undefined) throw new Error('Proposal not found.')
    const proposal = stored.proposal
    if (proposal.status === 'applied') return this.preview(id)
    if (proposal.status === 'rolled_back' || proposal.status === 'rejected') throw new Error(`Proposal is ${proposal.status}.`)

    const previewResult = this.preview(id)
    // HU-1B: broad apply 不再执行 Artifact hard delete（artifactDeleteCandidates 仅作 preview 提示）

    // 1. merge：移除被合并的源 view（汇总节点由 Agent 在提交前创建）
    const removeMemberIds = [...proposal.removeMemberViewIds]
    for (const merge of proposal.mergeCandidates) {
      removeMemberIds.push(...merge.sourceViewIds)
    }

    // 2. presentation patch（members/hierarchy/emphasis）
    const presentation = this.#presentation.get(proposal.projectId, proposal.presentationId)
    if (presentation === undefined) throw new Error('Presentation not found.')
    if (presentation.version !== proposal.baseVersion) {
      throw new Error(`STALE_PRESENTATION: expected ${proposal.baseVersion}, current ${presentation.version}`)
    }
    const beforeVersion = presentation.version
    const beforeState = structuredClone(presentation.state)
    const currentVersion = presentation.version
    const state = structuredClone(presentation.state)
    const memberSet = new Set(state.memberViewIds)
    for (const viewId of removeMemberIds) memberSet.delete(viewId)
    state.memberViewIds = [...memberSet]
    if (proposal.hierarchyPatch !== undefined) {
      state.hierarchy = state.hierarchy ?? { parentByViewId: {}, orderByParent: {} }
      for (const [viewId, parentId] of Object.entries(proposal.hierarchyPatch.parentByViewId)) {
        state.hierarchy.parentByViewId[viewId] = parentId
      }
      for (const [parentId, order] of Object.entries(proposal.hierarchyPatch.orderByParent)) {
        state.hierarchy.orderByParent[parentId] = [...order]
      }
    }
    if (proposal.emphasisPatch !== undefined) {
      state.emphasisByViewId = { ...state.emphasisByViewId, ...proposal.emphasisPatch }
    }
    if (proposal.positionPatch !== undefined) {
      const memberIds = new Set(state.memberViewIds)
      const pinned = new Set(state.pinnedViewIds)
      for (const [viewId, position] of Object.entries(proposal.positionPatch)) {
        if (!memberIds.has(viewId)) throw new Error(`Position patch references non-member view: ${viewId}`)
        if (proposal.layoutIntent?.preservePinned && pinned.has(viewId)) continue
        if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error(`Invalid position patch for view: ${viewId}`)
        state.positions[viewId] = { x: position.x, y: position.y }
      }
    }
    this.#presentation.save(proposal.projectId, {
      presentationId: proposal.presentationId,
      scopeId: presentation.scopeId,
      expectedVersion: currentVersion,
      renderer: presentation.renderer,
      capability: presentation.capability,
      state,
      updatedBy: 'agent',
    })
    const afterPresentation = this.#presentation.get(proposal.projectId, proposal.presentationId)
    const afterVersion = afterPresentation?.version ?? currentVersion
    const afterState = structuredClone(afterPresentation?.state ?? state)
    const changes: MutationChangeItemV1[] = [{
      type: 'presentation_state',
      presentationId: proposal.presentationId,
      beforeVersion,
      afterVersion,
      inverse: {
        type: 'restore_presentation_state',
        presentationId: proposal.presentationId,
        targetVersion: beforeVersion,
        stateSnapshot: beforeState,
      },
      forward: {
        type: 'restore_presentation_state',
        presentationId: proposal.presentationId,
        stateSnapshot: afterState,
      },
      touchedKeys: ['memberViewIds', 'positions', 'hierarchy', 'emphasisByViewId', 'pinnedViewIds', 'presentationEdges'],
      appliedFingerprint: `presentation:${afterVersion}`,
    }]

    // 3. relations
    for (const relation of proposal.relationPatch?.add ?? []) {
      const fromId = relation.from.entityId
      const toId = relation.to.entityId
      if (fromId === undefined || toId === undefined) continue
      const relationId = `relation-${randomUUID()}`
      const createdRelation = {
        id: relationId as never,
        projectId: proposal.projectId as never,
        sourceEntityType: (relation.from.entityType ?? 'artifact') as never,
        sourceEntityId: fromId,
        targetEntityType: (relation.to.entityType ?? 'artifact') as never,
        targetEntityId: toId,
        kind: relation.kind ?? 'informs',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(relation.origin === undefined ? {} : { origin: relation.origin as never }),
        ...(relation.createdBy === undefined ? {} : { createdBy: relation.createdBy }),
      }
      this.#metadata.upsertRelation(createdRelation)
      changes.push({
        type: 'relation_upsert',
        relationId,
        inverse: { type: 'delete_relation', relationId },
        forward: {
          type: 'restore_relation',
          relationId,
          relation: {
            sourceEntityType: String(createdRelation.sourceEntityType),
            sourceEntityId: String(createdRelation.sourceEntityId),
            targetEntityType: String(createdRelation.targetEntityType),
            targetEntityId: String(createdRelation.targetEntityId),
            kind: createdRelation.kind,
            ...(createdRelation.origin === undefined ? {} : { origin: String(createdRelation.origin) }),
            ...(createdRelation.createdBy === undefined ? {} : { createdBy: createdRelation.createdBy }),
          },
        },
        appliedFingerprint: `relation:${relationId}:applied`,
      })
    }
    for (const relationId of proposal.relationPatch?.remove ?? []) {
      const existing = this.#metadata.getRelation(relationId)
      if (existing !== undefined) {
        changes.push({
          type: 'relation_delete',
          relationId,
          inverse: {
            type: 'restore_relation',
            relationId,
            relation: {
              sourceEntityType: String(existing.sourceEntityType),
              sourceEntityId: String(existing.sourceEntityId),
              targetEntityType: String(existing.targetEntityType),
              targetEntityId: String(existing.targetEntityId),
              kind: existing.kind,
              ...(existing.origin === undefined ? {} : { origin: existing.origin }),
              ...(existing.createdBy === undefined ? {} : { createdBy: existing.createdBy }),
              ...(existing.confidence === undefined ? {} : { confidence: existing.confidence }),
            },
          },
          forward: { type: 'delete_relation', relationId },
          appliedFingerprint: `relation:${relationId}:deleted`,
        })
      }
      this.#metadata.deleteRelation(relationId)
    }

    // 4. HU-1B: broad Reorganize 不再执行 Artifact hard delete（仅 preview 提示，需用户显式 endpoint 单独确认）

    const changeSet = this.#mutationSafety.record({
      projectId: proposal.projectId,
      operationId: proposal.id,
      actorKind: 'agent',
      actorId: 'codex-reorganize',
      changes,
    })
    this.#metadata.updateReorganizeProposalChangeSet(proposal.id, changeSet.id)
    this.#metadata.updateReorganizeProposalStatus(proposal.id, 'applied')
    return previewResult
  }

  accept(id: string): ReorganizeProposalV0 {
    const stored = this.#metadata.getReorganizeProposal(id)
    if (stored === undefined) throw new Error('Proposal not found.')
    if (stored.proposal.status !== 'applied') throw new Error('Only applied proposals can be accepted.')
    this.#metadata.updateReorganizeProposalStatus(id, 'accepted')
    return this.get(id)!
  }

  rollback(id: string): ReorganizeProposalV0 {
    const stored = this.#metadata.getReorganizeProposal(id)
    if (stored === undefined) throw new Error('Proposal not found.')
    if (stored.proposal.status !== 'applied') throw new Error('Only applied proposals can be rolled back.')
    if (stored.changeSetId === undefined) throw new Error('Proposal has no change set; rollback unavailable.')
    const result = this.#mutationSafety.revert(stored.changeSetId)
    if (!result.revertable) {
      throw new Error(`Revert blocked: ${result.reason ?? 'unknown'}`)
    }
    this.#metadata.updateReorganizeProposalStatus(id, 'rolled_back')
    return this.get(id)!
  }

  reject(id: string): ReorganizeProposalV0 {
    this.#metadata.updateReorganizeProposalStatus(id, 'rejected')
    return this.get(id)!
  }
}
