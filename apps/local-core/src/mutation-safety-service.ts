import { createHash, randomUUID } from 'node:crypto'
import type {
  RailwayReceiveRequestV1, RailwayReceiveOutcomeV1, RailwayDestinationV1, AssemblyApplyItemResultV1,
  MutationChangeItemV1,
  MutationChangeSetV1,
  MutationRelationSnapshotV1,
  ProjectEventOrigin,
  ColorPinDefinitionV0,
  ColorPinMembershipV0,
  SpatialMarkerIntentV0,
  CollectionMembershipReceipt,
} from '@local-creative-os/contracts'
import type { Collection, CollectionMembership, Relation } from '@local-creative-os/domain'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import { PresentationApplicationService } from './presentation-application-service.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'

export interface RevertResultV1 {
  readonly revertable: boolean
  readonly reason?: 'TOUCHED_STATE_CHANGED_AFTER_APPLY' | 'FORWARD_STATE_UNAVAILABLE'
  readonly changeSetId: string
}

function relationSnapshot(relation: Relation): MutationRelationSnapshotV1 {
  return {
    sourceEntityType: String(relation.sourceEntityType),
    sourceEntityId: String(relation.sourceEntityId),
    targetEntityType: String(relation.targetEntityType),
    targetEntityId: String(relation.targetEntityId),
    kind: relation.kind,
    ...(relation.origin === undefined ? {} : { origin: relation.origin }),
    ...(relation.createdBy === undefined ? {} : { createdBy: relation.createdBy }),
    ...(relation.evidenceRefs === undefined ? {} : { evidenceRefs: relation.evidenceRefs }),
    ...(relation.confidence === undefined ? {} : { confidence: relation.confidence }),
  }
}

function relationFingerprint(value: MutationRelationSnapshotV1): string {
  return `relation:${createHash('sha256').update(JSON.stringify({
    sourceEntityType: value.sourceEntityType,
    sourceEntityId: value.sourceEntityId,
    targetEntityType: value.targetEntityType,
    targetEntityId: value.targetEntityId,
    kind: value.kind,
    origin: value.origin ?? null,
    createdBy: value.createdBy ?? null,
    evidenceRefs: value.evidenceRefs ?? null,
    confidence: value.confidence ?? null,
  })).digest('hex')}`
}

function stateFingerprint(value: unknown): string {
  return `state:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}

/**
 * B5 Mutation Safety：统一 ChangeSet + Safe Undo/Redo。
 *
 * 纪律：
 * - ChangeSet 是 technical audit，不是 Project Domain Entity。
 * - Undo/Redo 只在 touched state 仍与预期一致时执行，绝不覆盖用户后续修改。
 * - 新 Relation mutation 与 ChangeSet 尽量在同一 SQLite transaction 内完成。
 * - ProjectEventHub 只广播已提交结果，不成为第二份 Truth。
 */
export class MutationSafetyService {
  readonly #metadata: SqliteMetadataRepository
  readonly #presentations: PresentationApplicationService
  readonly #events: ProjectEventHub | undefined

  constructor(metadata: SqliteMetadataRepository, presentations: PresentationApplicationService, events?: ProjectEventHub) {
    this.#metadata = metadata
    this.#presentations = presentations
    this.#events = events
  }

  record(input: {
    readonly projectId: string
    readonly operationId: string
    readonly actorKind: MutationChangeSetV1['actorKind']
    readonly actorId?: string
    readonly changes: readonly MutationChangeItemV1[]
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 {
    const value = this.#buildChangeSet(input)
    this.#metadata.createMutationChangeSet(value)
    this.#publishChangeSet(value, input.origin)
    return value
  }

  get(changeSetId: string): MutationChangeSetV1 | undefined {
    return this.#metadata.getMutationChangeSet(changeSetId)
  }

  list(projectId: string, limit = 50): readonly MutationChangeSetV1[] {
    return this.#metadata.listMutationChangeSets(projectId, limit)
  }

  createCollection(input: { readonly projectId: string; readonly title: string; readonly members?: readonly CollectionMembership['memberRef'][]; readonly actorKind?: MutationChangeSetV1['actorKind']; readonly origin?: ProjectEventOrigin }): { readonly collection: Collection; readonly changeSet: MutationChangeSetV1 } {
    const title = input.title.trim()
    if (!title || title.length > 200) throw new Error('Collection title must contain 1–200 characters.')
    const now = new Date().toISOString()
    const collection: Collection = { id: `collection-${randomUUID()}` as never, projectId: input.projectId as never, title, createdAt: now, updatedAt: now }
    const change: MutationChangeItemV1 = {
      type: 'collection_identity_add', collection,
      inverse: { type: 'collection_identity_remove', collectionId: String(collection.id) },
      forward: { type: 'collection_identity_add', collection },
      appliedFingerprint: `collection:${collection.id}:present`,
    }
    // Creation with an initial selection is one reversible mutation. Validate
    // every real identity first; never leave a partly-filled container behind.
    const members = [...new Map((input.members ?? []).map((ref) => [JSON.stringify([ref.type, ref.id]), ref])).values()]
    const memberships: CollectionMembership[] = members.map((ref) => {
      this.#assertCollectionMemberExists(input.projectId, ref)
      if (ref.type === 'collection') this.#assertCollectionNesting(input.projectId, String(collection.id), ref.id)
      return { collectionId: collection.id, memberRef: ref, relationId: `collection-member-${randomUUID()}` as never, addedAt: now }
    })
    const changes: MutationChangeItemV1[] = [change, ...memberships.map((membership): MutationChangeItemV1 => ({
      type: 'collection_membership_add', membership,
      inverse: { type: 'collection_membership_remove', membership },
      forward: { type: 'collection_membership_add', membership },
      appliedFingerprint: `collection-membership:${membership.relationId}:present`,
    }))]
    const changeSet = this.#buildChangeSet({ projectId: input.projectId, operationId: input.origin?.operationId ?? `collection-create-${randomUUID()}`, actorKind: input.actorKind ?? 'web', changes })
    this.#metadata.runCurationMutation({ projectId: input.projectId, collectionAdds: [collection], collectionMembershipAdds: memberships, changeSet })
    this.#publishChangeSet(changeSet, input.origin)
    return { collection, changeSet }
  }

  addCollectionMember(input: { readonly projectId: string; readonly collectionId: string; readonly memberRef: CollectionMembership['memberRef']; readonly actorKind?: MutationChangeSetV1['actorKind']; readonly origin?: ProjectEventOrigin }): CollectionMembershipReceipt {
    const collection = this.#metadata.getCollection(input.collectionId)
    if (collection === undefined || String(collection.projectId) !== input.projectId) throw new Error('Collection does not belong to project.')
    this.#assertCollectionMemberExists(input.projectId, input.memberRef)
    const existing = this.#metadata.getCollectionMembership(input.projectId, input.collectionId, input.memberRef.type, input.memberRef.id)
    if (existing !== undefined) return { status: 'already-member', collectionId: input.collectionId, memberRef: input.memberRef, relationId: String(existing.relationId) }
    if (input.memberRef.type === 'collection') this.#assertCollectionNesting(input.projectId, input.collectionId, input.memberRef.id)
    const now = new Date().toISOString()
    const membership: CollectionMembership = { collectionId: collection.id, memberRef: input.memberRef, relationId: `collection-member-${randomUUID()}` as never, addedAt: now }
    const change: MutationChangeItemV1 = {
      type: 'collection_membership_add', membership,
      inverse: { type: 'collection_membership_remove', membership },
      forward: { type: 'collection_membership_add', membership },
      appliedFingerprint: `collection-membership:${membership.relationId}:present`,
    }
    const changeSet = this.#buildChangeSet({ projectId: input.projectId, operationId: input.origin?.operationId ?? `collection-member-add-${randomUUID()}`, actorKind: input.actorKind ?? 'web', changes: [change] })
    try {
      this.#metadata.runCurationMutation({ projectId: input.projectId, collectionMembershipAdds: [membership], changeSet })
    } catch (error) {
      const raced = this.#metadata.getCollectionMembership(input.projectId, input.collectionId, input.memberRef.type, input.memberRef.id)
      if (raced !== undefined) return { status: 'already-member', collectionId: input.collectionId, memberRef: input.memberRef, relationId: String(raced.relationId) }
      throw error
    }
    this.#publishChangeSet(changeSet, input.origin)
    return { status: 'applied', collectionId: input.collectionId, memberRef: input.memberRef, relationId: String(membership.relationId), changeSetId: changeSet.id }
  }

  removeCollectionMember(input: { readonly projectId: string; readonly collectionId: string; readonly memberRef: CollectionMembership['memberRef']; readonly actorKind?: MutationChangeSetV1['actorKind']; readonly origin?: ProjectEventOrigin }): CollectionMembershipReceipt {
    const membership = this.#metadata.getCollectionMembership(input.projectId, input.collectionId, input.memberRef.type, input.memberRef.id)
    if (membership === undefined) return { status: 'not-member', collectionId: input.collectionId, memberRef: input.memberRef }
    const change: MutationChangeItemV1 = {
      type: 'collection_membership_remove', membership,
      inverse: { type: 'collection_membership_add', membership },
      forward: { type: 'collection_membership_remove', membership },
      appliedFingerprint: `collection-membership:${membership.relationId}:absent`,
    }
    const changeSet = this.#buildChangeSet({ projectId: input.projectId, operationId: input.origin?.operationId ?? `collection-member-remove-${randomUUID()}`, actorKind: input.actorKind ?? 'web', changes: [change] })
    this.#metadata.runCurationMutation({ projectId: input.projectId, collectionMembershipDeletes: [membership], changeSet })
    this.#publishChangeSet(changeSet, input.origin)
    return { status: 'removed', collectionId: input.collectionId, memberRef: input.memberRef, relationId: String(membership.relationId), changeSetId: changeSet.id }
  }

  #assertCollectionMemberExists(projectId: string, ref: CollectionMembership['memberRef']): void {
    const exists = ref.type === 'artifact' ? String(this.#metadata.getArtifact(ref.id)?.projectId ?? '') === projectId
      : ref.type === 'note' ? String(this.#metadata.getNote(ref.id)?.projectId ?? '') === projectId
        : ref.type === 'collection' ? String(this.#metadata.getCollection(ref.id)?.projectId ?? '') === projectId
          : ref.type === 'scope' ? (this.#metadata.get(projectId)?.scopes.some((scope) => String(scope.id) === ref.id && scope.kind !== 'collection' && scope.kind !== 'workflow') ?? false)
            : ref.type === 'workspace' ? String(this.#metadata.getWorkspace(ref.id)?.projectId ?? '') === projectId
              : ref.type === 'conversation' ? this.#metadata.getConnectedConversation(projectId, ref.id) !== undefined
                : String(this.#metadata.getRun(ref.id as never)?.projectId ?? '') === projectId
    if (!exists) throw new Error('Collection member must be a canonical entity in the same project.')
  }

  #assertCollectionNesting(projectId: string, parentId: string, childId: string): void {
    if (parentId === childId) throw new Error('A Collection cannot contain itself.')
    const edges = this.#metadata.listCollectionMemberships(projectId).filter((m) => m.memberRef.type === 'collection')
    const graph = new Map<string, string[]>()
    for (const m of edges) graph.set(String(m.collectionId), [...(graph.get(String(m.collectionId)) ?? []), m.memberRef.id])
    graph.set(parentId, [...(graph.get(parentId) ?? []), childId])
    const visit = (id: string, depth: number, stack: Set<string>): void => {
      if (stack.has(id)) throw new Error('Collection nesting would create a cycle.')
      if (depth > 2) throw new Error('Collection nesting exceeds the supported depth of 2.')
      const next = new Set(stack).add(id)
      for (const child of graph.get(id) ?? []) visit(child, depth + 1, next)
    }
    // Validate the whole changed component: path depth is bounded in both directions.
    for (const id of new Set([parentId, ...graph.keys()])) visit(id, 0, new Set())
  }


  /** A25-6: assign one Color Pin identity to one canonical target. */
  assignColorPin(input: {
    readonly projectId: string
    readonly targetRef: ColorPinMembershipV0['targetRef']
    readonly colorPinId?: string
    readonly color?: string
    readonly label?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): { readonly definition: ColorPinDefinitionV0; readonly membership: ColorPinMembershipV0; readonly changeSet?: MutationChangeSetV1 } {
    if (String(input.targetRef.projectId) !== String(input.projectId)) throw new Error('Cross-project Color Pin target is forbidden.')
    const projectId = input.projectId as never
    let definition = input.colorPinId ? this.#metadata.getColorPinDefinition(input.colorPinId) : undefined
    if (definition !== undefined && String(definition.projectId) !== String(input.projectId)) throw new Error('Cross-project Color Pin identity is forbidden.')
    if (definition === undefined && input.color !== undefined) definition = this.#metadata.getColorPinDefinitionByColor(projectId, input.color)
    const now = new Date().toISOString()
    const createdDefinition = definition === undefined
    if (definition === undefined) {
      if (!input.color) throw new Error('Color Pin assignment requires an existing colorPinId or a color value.')
      definition = { id: `color-pin-${randomUUID()}`, projectId: input.projectId, color: input.color, ...(input.label?.trim() ? { label: input.label.trim() } : {}), createdAt: now, updatedAt: now }
    }
    const existing = this.#metadata.findColorPinMembership(projectId, definition.id, input.targetRef)
    if (existing !== undefined) return { definition, membership: existing }
    const membership: ColorPinMembershipV0 = {
      id: `color-pin-membership-${randomUUID()}`, projectId: input.projectId, colorPinId: definition.id, targetRef: input.targetRef, createdAt: now, updatedAt: now,
    }
    const changes: MutationChangeItemV1[] = []
    if (createdDefinition) changes.push({
      type: 'color_pin_definition_add', colorPinId: definition.id, definition,
      inverse: { type: 'color_pin_definition_remove', colorPinId: definition.id },
      forward: { type: 'color_pin_definition_add', colorPinId: definition.id },
      appliedFingerprint: `color-pin-definition:${definition.id}:present`,
    })
    changes.push({
      type: 'color_pin_membership_add', membershipId: membership.id, membership,
      inverse: { type: 'color_pin_membership_remove', membershipId: membership.id },
      forward: { type: 'color_pin_membership_add', membershipId: membership.id },
      appliedFingerprint: `color-pin-membership:${membership.id}:present`,
    })
    const changeSet = this.#buildChangeSet({ projectId: input.projectId, operationId: `color-pin-assign-${randomUUID()}`, actorKind: input.actorKind ?? 'web', changes })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      ...(createdDefinition ? { colorPinDefinitionAdds: [definition] } : {}),
      colorPinMembershipAdds: [membership], changeSet,
    })
    this.#publishChangeSet(changeSet, input.origin)
    return { definition, membership, changeSet }
  }

  removeColorPinMembership(input: { readonly projectId: string; readonly membershipId: string; readonly actorKind?: MutationChangeSetV1['actorKind']; readonly origin?: ProjectEventOrigin }): MutationChangeSetV1 | undefined {
    const membership = this.#metadata.getColorPinMembership(input.membershipId)
    if (membership === undefined || String(membership.projectId) !== String(input.projectId)) return undefined
    const change: MutationChangeItemV1 = {
      type: 'color_pin_membership_remove', membershipId: membership.id, membership,
      inverse: { type: 'color_pin_membership_add', membershipId: membership.id },
      forward: { type: 'color_pin_membership_remove', membershipId: membership.id },
      appliedFingerprint: `color-pin-membership:${membership.id}:absent`,
    }
    const changeSet = this.#buildChangeSet({ projectId: input.projectId, operationId: `color-pin-remove-${randomUUID()}`, actorKind: input.actorKind ?? 'web', changes: [change] })
    this.#metadata.runCurationMutation({ projectId: input.projectId, colorPinMembershipDeletes: [membership.id], changeSet })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /** Direct Relation create/update. Produces one atomic ChangeSet. */
  upsertRelation(input: {
    readonly projectId: string
    readonly relation: Relation
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly actorId?: string
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 {
    const existing = this.#metadata.getRelation(String(input.relation.id))
    const after = relationSnapshot(input.relation)
    const operationId = input.operationId ?? input.origin?.operationId ?? `relation-${randomUUID()}`
    const change: MutationChangeItemV1 = existing === undefined
      ? {
          type: 'relation_upsert',
          relationId: String(input.relation.id),
          inverse: { type: 'delete_relation', relationId: String(input.relation.id) },
          forward: { type: 'restore_relation', relationId: String(input.relation.id), relation: after },
          appliedFingerprint: relationFingerprint(after),
        }
      : {
          type: 'relation_update',
          relationId: String(input.relation.id),
          inverse: { type: 'restore_relation', relationId: String(input.relation.id), relation: relationSnapshot(existing) },
          forward: { type: 'restore_relation', relationId: String(input.relation.id), relation: after },
          beforeFingerprint: relationFingerprint(relationSnapshot(existing)),
          appliedFingerprint: relationFingerprint(after),
        }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId,
      actorKind: input.actorKind ?? 'web',
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      changes: [change],
    })
    this.#metadata.runCurationMutation({ projectId: input.projectId, relationUpserts: [input.relation], changeSet })
    this.#publishRelation(input.projectId, String(input.relation.id), 'upserted', input.origin)
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /** Direct Relation delete. Produces one atomic ChangeSet. */
  deleteRelation(input: {
    readonly projectId: string
    readonly relationId: string
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly actorId?: string
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 {
    const existing = this.#metadata.getRelation(input.relationId)
    if (existing === undefined || String(existing.projectId) !== input.projectId) throw new Error('Relation not found.')
    const before = relationSnapshot(existing)
    const operationId = input.operationId ?? input.origin?.operationId ?? `relation-${randomUUID()}`
    const change: MutationChangeItemV1 = {
      type: 'relation_delete',
      relationId: input.relationId,
      inverse: { type: 'restore_relation', relationId: input.relationId, relation: before },
      forward: { type: 'delete_relation', relationId: input.relationId },
      appliedFingerprint: 'relation:absent',
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId,
      actorKind: input.actorKind ?? 'web',
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      changes: [change],
    })
    this.#metadata.runCurationMutation({ projectId: input.projectId, relationDeletes: [input.relationId], changeSet })
    this.#publishRelation(input.projectId, input.relationId, 'deleted', input.origin)
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /**
   * F6 follow-up（20260828 补充冻结 §7）：Scene working-set membership 进 semantic ChangeSet。
   * 原子复合事务（membership 写 + ChangeSet 同事务）；已成员 → 无 mutation、返回 undefined（调用方报 already-member）。
   * 存量 POST /workspaces/{id}/members 路由维持原状（ChangeSet 覆盖 census 是 F7A 范围）。
   */
  /** A Railway selection is one reversible mutation, including its durable receipt.
   * Resolution and source checks run under the existing SQLite write transaction. */
  receiveWorkspaceBatch(request: RailwayReceiveRequestV1 | import('@local-creative-os/contracts').PortalReceiveRequestV1, resolve: () => RailwayDestinationV1): RailwayReceiveOutcomeV1 {
    let outcome: RailwayReceiveOutcomeV1 | undefined
    let committed: MutationChangeSetV1 | undefined
    this.#metadata.runCurationMutation(() => {
      const previous = this.#metadata.getCurationReceipt(request.operationId)
      if (previous) {
        if (!previous.railway || JSON.stringify(previous.railway.request) !== JSON.stringify(request))
          throw new Error('同一操作编号不能改投另一目标或另一组选中材料。')
        if (previous.changeSetId && this.#metadata.getMutationChangeSet(previous.changeSetId)?.status !== 'applied')
          throw new Error('原操作已撤销，请重新确认后发起新的投递。')
        outcome = previous.railway.outcome
        return {projectId: request.projectId}
      }
      const destination = resolve()
      if (!destination.available || destination.ref.kind !== 'worksite' || !destination.workspaceId)
        throw new Error(destination.reason ?? '当前目的地不接收材料。')
      const workspaceId = destination.workspaceId
      const members = new Set(this.#metadata.listWorkspaceMembers(workspaceId as never).map((m) => String(m.artifactViewId)))
      const notes = new Set(this.#metadata.listWorkspaceEntityMembers(workspaceId as never).filter((m) => m.entityType === 'note').map((m) => m.entityId))
      const changes: MutationChangeItemV1[] = []
      const results: AssemblyApplyItemResultV1[] = []
      const now = new Date().toISOString()
      const viewsToAdd: {workspaceId: never; viewId: never; addedBy: 'user'; addedAt: string}[] = []
      const notesToAdd: {workspaceId: never; entityType: 'note'; entityId: string; addedBy: 'user'; addedAt: string}[] = []
      for (const sourceRef of request.sourceRefs) {
        if (sourceRef.kind === 'artifactView') {
          const view = this.#metadata.getArtifactView(sourceRef.id)
          const artifact = view && this.#metadata.getArtifact(String(view.artifactId))
          if (!view || !artifact || String(artifact.projectId) !== request.projectId) throw new Error('材料视图不存在或属于另一个项目；本批未写入。')
          const revision = this.#metadata.getArtifactRevision(String(view.revisionId ?? artifact.currentRevisionId ?? ''))
          if (!revision || String(revision.artifactId) !== String(view.artifactId)) throw new Error('材料版本不存在或身份错配；本批未写入。')
          const existing = members.has(sourceRef.id)
          results.push({sourceRef, status:existing ? 'skipped' : 'applied', channel:existing ? 'already-member' : 'workspace-membership', memberViewId:sourceRef.id})
          if (existing) continue
          viewsToAdd.push({workspaceId:workspaceId as never,viewId:sourceRef.id as never,addedBy:'user',addedAt:now})
          changes.push({type:'workspace_membership_add',workspaceId,viewId:sourceRef.id,
            inverse:{type:'workspace_membership_remove',workspaceId,viewId:sourceRef.id},
            forward:{type:'workspace_membership_add',workspaceId,viewId:sourceRef.id},
            appliedFingerprint:`workspace:${workspaceId}:member:${sourceRef.id}:present`})
        } else if (sourceRef.kind === 'note') {
          if (String(this.#metadata.getNote(sourceRef.id)?.projectId ?? '') !== request.projectId)
            throw new Error('笔记不存在或属于另一个项目；本批未写入。')
          const existing = notes.has(sourceRef.id)
          results.push({sourceRef,status:existing ? 'skipped' : 'applied',channel:existing ? 'already-member' : 'workspace-membership'})
          if (existing) continue
          notesToAdd.push({workspaceId:workspaceId as never,entityType:'note',entityId:sourceRef.id,addedBy:'user',addedAt:now})
          changes.push({type:'workspace_entity_membership_add',workspaceId,entityType:'note',entityId:sourceRef.id,
            inverse:{type:'workspace_entity_membership_remove',workspaceId,entityType:'note',entityId:sourceRef.id},
            forward:{type:'workspace_entity_membership_add',workspaceId,entityType:'note',entityId:sourceRef.id},
            appliedFingerprint:`workspace:${workspaceId}:entity:note:${sourceRef.id}:present`})
        } else throw new Error('该材料类型尚无原子接收能力；整组选中材料均未投递。')
      }
      committed = changes.length ? this.#buildChangeSet({projectId:request.projectId,operationId:request.operationId,actorKind:'web',changes}) : undefined
      outcome = {status:'committed',operationId:request.operationId,destination,spatial:{status:'not_required'},
        result:{schemaVersion:1,projectId:request.projectId,allApplied:true,
          results:results.map((r) => r.status === 'applied' && committed ? {...r,changeSetId:committed.id} : r),
          ...(committed ? {changeSetId:committed.id} : {})}}
      return {projectId:request.projectId,workspaceMembershipAdds:viewsToAdd,workspaceEntityMembershipAdds:notesToAdd,
        ...(committed ? {changeSet:committed} : {}),
        receipt:{schemaVersion:0,operationId:request.operationId,applied:true,completedSteps:[],createdAt:now,
          ...(committed ? {changeSetId:committed.id} : {}),railway:{request,outcome}}}
    })
    if (!outcome) throw new Error('未取得已提交回执。')
    if (committed) this.#publishChangeSet(committed)
    return outcome
  }

  addWorkspaceMember(input: {
    readonly projectId: string
    readonly workspaceId: string
    readonly viewId: string
    readonly addedBy?: 'user' | 'agent' | 'run' | 'import'
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 | undefined {
    const workspace = this.#metadata.getWorkspace(input.workspaceId)
    if (workspace === undefined || String(workspace.projectId) !== input.projectId) throw new Error('Workspace not found.')
    const alreadyMember = this.#metadata.listWorkspaceMembers(input.workspaceId as never)
      .some((member) => String(member.artifactViewId) === input.viewId)
    if (alreadyMember) return undefined
    const change: MutationChangeItemV1 = {
      type: 'workspace_membership_add',
      workspaceId: input.workspaceId,
      viewId: input.viewId,
      inverse: { type: 'workspace_membership_remove', workspaceId: input.workspaceId, viewId: input.viewId },
      forward: { type: 'workspace_membership_add', workspaceId: input.workspaceId, viewId: input.viewId },
      appliedFingerprint: `workspace:${input.workspaceId}:member:${input.viewId}:present`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `workspace-membership-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes: [change],
    })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      workspaceMembershipAdds: [{
        workspaceId: input.workspaceId as never,
        viewId: input.viewId as never,
        addedBy: input.addedBy ?? 'user',
        addedAt: new Date().toISOString(),
      }],
      changeSet,
    })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /** F6 B6（P1-B census）：working-set membership 移除进 ChangeSet（与 add 对称）。非成员 → undefined。 */
  removeWorkspaceMember(input: {
    readonly projectId: string
    readonly workspaceId: string
    readonly viewId: string
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 | undefined {
    const workspace = this.#metadata.getWorkspace(input.workspaceId)
    if (workspace === undefined || String(workspace.projectId) !== input.projectId) throw new Error('Workspace not found.')
    if (!this.#hasWorkspaceMember(input.workspaceId, input.viewId)) return undefined
    const change: MutationChangeItemV1 = {
      type: 'workspace_membership_remove',
      workspaceId: input.workspaceId,
      viewId: input.viewId,
      inverse: { type: 'workspace_membership_add', workspaceId: input.workspaceId, viewId: input.viewId },
      forward: { type: 'workspace_membership_remove', workspaceId: input.workspaceId, viewId: input.viewId },
      appliedFingerprint: `workspace:${input.workspaceId}:member:${input.viewId}:absent`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `workspace-membership-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes: [change],
    })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      workspaceMembershipRemoves: [{ workspaceId: input.workspaceId as never, viewId: input.viewId as never }],
      changeSet,
    })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /** F6 B6：成员移动 = remove + add 同一 ChangeSet（一个语义决策一次撤销）。from 非成员 = fail-close。 */
  moveWorkspaceMember(input: {
    readonly projectId: string
    readonly fromWorkspaceId: string
    readonly toWorkspaceId: string
    readonly viewId: string
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 {
    for (const workspaceId of [input.fromWorkspaceId, input.toWorkspaceId]) {
      const workspace = this.#metadata.getWorkspace(workspaceId)
      if (workspace === undefined || String(workspace.projectId) !== input.projectId) throw new Error('Workspace not found.')
    }
    if (!this.#hasWorkspaceMember(input.fromWorkspaceId, input.viewId)) throw new Error('View is not a member of the source workspace.')
    const changes: MutationChangeItemV1[] = [{
      type: 'workspace_membership_remove',
      workspaceId: input.fromWorkspaceId,
      viewId: input.viewId,
      inverse: { type: 'workspace_membership_add', workspaceId: input.fromWorkspaceId, viewId: input.viewId },
      forward: { type: 'workspace_membership_remove', workspaceId: input.fromWorkspaceId, viewId: input.viewId },
      appliedFingerprint: `workspace:${input.fromWorkspaceId}:member:${input.viewId}:absent`,
    }]
    const targetHasMember = this.#hasWorkspaceMember(input.toWorkspaceId, input.viewId)
    if (!targetHasMember) {
      changes.push({
        type: 'workspace_membership_add',
        workspaceId: input.toWorkspaceId,
        viewId: input.viewId,
        inverse: { type: 'workspace_membership_remove', workspaceId: input.toWorkspaceId, viewId: input.viewId },
        forward: { type: 'workspace_membership_add', workspaceId: input.toWorkspaceId, viewId: input.viewId },
        appliedFingerprint: `workspace:${input.toWorkspaceId}:member:${input.viewId}:present`,
      })
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `workspace-membership-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes,
    })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      workspaceMembershipRemoves: [{ workspaceId: input.fromWorkspaceId as never, viewId: input.viewId as never }],
      // INSERT OR IGNORE：目标已含成员时 add 幂等（changes 已如实省略 add 项）。
      workspaceMembershipAdds: [{ workspaceId: input.toWorkspaceId as never, viewId: input.viewId as never, addedBy: 'user', addedAt: new Date().toISOString() }],
      changeSet,
    })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /** F6 B6：破坏性删除 ArtifactView 进 ChangeSet（snapshot inverse 可 restore）。 */
  deleteArtifactView(input: {
    readonly projectId: string
    readonly viewId: string
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 {
    const view = this.#metadata.getArtifactView(input.viewId)
    if (view === undefined) throw new Error('Artifact view not found.')
    if (String(this.#metadata.getArtifact(String(view.artifactId))?.projectId ?? '') !== input.projectId) {
      throw new Error('Artifact view belongs to another project.')
    }
    const change: MutationChangeItemV1 = {
      type: 'artifact_view_delete',
      viewId: input.viewId,
      artifactId: String(view.artifactId),
      inverse: { type: 'restore_artifact_view', view },
      forward: { type: 'delete_artifact_view', viewId: input.viewId },
      appliedFingerprint: `artifact-view:${input.viewId}:absent`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `artifact-view-delete-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes: [change],
    })
    this.#metadata.runCurationMutation({ projectId: input.projectId, artifactViewDeletes: [input.viewId as never], changeSet })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /** F6 B6：破坏性删除 Note 进 ChangeSet（snapshot inverse 可 restore）。 */
  deleteNote(input: {
    readonly projectId: string
    readonly noteId: string
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 {
    const note = this.#metadata.getNote(input.noteId)
    if (note === undefined) throw new Error('Note not found.')
    if (String(note.projectId) !== input.projectId) throw new Error('Note belongs to another project.')
    const change: MutationChangeItemV1 = {
      type: 'note_delete',
      noteId: input.noteId,
      inverse: { type: 'restore_note', note },
      forward: { type: 'delete_note', noteId: input.noteId },
      appliedFingerprint: `note:${input.noteId}:absent`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `note-delete-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes: [change],
    })
    this.#metadata.runCurationMutation({ projectId: input.projectId, noteDeletes: [input.noteId as never], changeSet })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /**
   * 裁决 1（20260828）：Note 等无 view 实体进 Scene working-set——entity 成员 envelope
   * （与 view 成员同一 ChangeSet 模式：原子复合事务 + revert/reapply）。
   * 已成员 → 无 mutation、返回 undefined（调用方报 already-member）。
   */
  addWorkspaceEntityMember(input: {
    readonly projectId: string
    readonly workspaceId: string
    readonly entityType: 'note' | 'scope' | 'workspace' | 'conversation'
    readonly entityId: string
    readonly addedBy?: 'user' | 'agent' | 'run' | 'import'
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 | undefined {
    const workspace = this.#metadata.getWorkspace(input.workspaceId)
    if (workspace === undefined || String(workspace.projectId) !== input.projectId) throw new Error('Workspace not found.')
    if (this.#hasWorkspaceEntityMember(input.workspaceId, input.entityType, input.entityId)) return undefined
    const change: MutationChangeItemV1 = {
      type: 'workspace_entity_membership_add',
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      inverse: { type: 'workspace_entity_membership_remove', workspaceId: input.workspaceId, entityType: input.entityType, entityId: input.entityId },
      forward: { type: 'workspace_entity_membership_add', workspaceId: input.workspaceId, entityType: input.entityType, entityId: input.entityId },
      appliedFingerprint: `workspace:${input.workspaceId}:entity:${input.entityType}:${input.entityId}:present`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `workspace-entity-membership-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes: [change],
    })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      workspaceEntityMembershipAdds: [{
        workspaceId: input.workspaceId as never,
        entityType: input.entityType,
        entityId: input.entityId,
        addedBy: input.addedBy ?? 'user',
        addedAt: new Date().toISOString(),
      }],
      changeSet,
    })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /** 裁决 1：entity 成员移除进 ChangeSet（与 view 成员对称）。非成员 → undefined。 */
  removeWorkspaceEntityMember(input: {
    readonly projectId: string
    readonly workspaceId: string
    readonly entityType: 'note' | 'scope' | 'workspace' | 'conversation'
    readonly entityId: string
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 | undefined {
    const workspace = this.#metadata.getWorkspace(input.workspaceId)
    if (workspace === undefined || String(workspace.projectId) !== input.projectId) throw new Error('Workspace not found.')
    if (!this.#hasWorkspaceEntityMember(input.workspaceId, input.entityType, input.entityId)) return undefined
    const change: MutationChangeItemV1 = {
      type: 'workspace_entity_membership_remove',
      workspaceId: input.workspaceId,
      entityType: input.entityType,
      entityId: input.entityId,
      inverse: { type: 'workspace_entity_membership_add', workspaceId: input.workspaceId, entityType: input.entityType, entityId: input.entityId },
      forward: { type: 'workspace_entity_membership_remove', workspaceId: input.workspaceId, entityType: input.entityType, entityId: input.entityId },
      appliedFingerprint: `workspace:${input.workspaceId}:entity:${input.entityType}:${input.entityId}:absent`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `workspace-entity-membership-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes: [change],
    })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      workspaceEntityMembershipRemoves: [{ workspaceId: input.workspaceId as never, entityType: input.entityType, entityId: input.entityId }],
      changeSet,
    })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  /** Canonical Artifact lifecycle. Repeated archive/restore is an idempotent no-op. */
  archiveArtifact(input: {
    readonly projectId: string
    readonly artifactId: string
    readonly operationId?: string
    readonly origin?: ProjectEventOrigin
  }): { readonly artifact: NonNullable<ReturnType<SqliteMetadataRepository['getArtifact']>>; readonly changeSet?: MutationChangeSetV1 } {
    return this.#setArtifactArchiveState(input, true)
  }

  restoreArtifact(input: {
    readonly projectId: string
    readonly artifactId: string
    readonly operationId?: string
    readonly origin?: ProjectEventOrigin
  }): { readonly artifact: NonNullable<ReturnType<SqliteMetadataRepository['getArtifact']>>; readonly changeSet?: MutationChangeSetV1 } {
    return this.#setArtifactArchiveState(input, false)
  }

  #setArtifactArchiveState(input: {
    readonly projectId: string
    readonly artifactId: string
    readonly operationId?: string
    readonly origin?: ProjectEventOrigin
  }, archived: boolean): { readonly artifact: NonNullable<ReturnType<SqliteMetadataRepository['getArtifact']>>; readonly changeSet?: MutationChangeSetV1 } {
    const artifact = this.#metadata.getArtifact(input.artifactId)
    if (artifact === undefined || String(artifact.projectId) !== input.projectId) throw new Error('Artifact not found in route project.')
    if ((artifact.archivedAt !== undefined) === archived) return { artifact }
    const now = new Date().toISOString()
    const afterArchivedAt = archived ? now : undefined
    const change: MutationChangeItemV1 = {
      type: 'artifact_archive_state', artifactId: input.artifactId,
      ...(artifact.archivedAt === undefined ? {} : { beforeArchivedAt: artifact.archivedAt }),
      ...(afterArchivedAt === undefined ? {} : { afterArchivedAt }),
      inverse: { type: 'restore_artifact_archive_state', artifactId: input.artifactId, ...(artifact.archivedAt === undefined ? {} : { archivedAt: artifact.archivedAt }) },
      forward: { type: 'restore_artifact_archive_state', artifactId: input.artifactId, ...(afterArchivedAt === undefined ? {} : { archivedAt: afterArchivedAt }) },
      appliedFingerprint: `artifact:${input.artifactId}:archived:${afterArchivedAt ?? 'active'}`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `artifact-${archived ? 'archive' : 'restore'}-${randomUUID()}`,
      actorKind: 'web', changes: [change],
    })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      artifactArchiveStates: [{ artifactId: input.artifactId, ...(afterArchivedAt === undefined ? {} : { archivedAt: afterArchivedAt }), updatedAt: now }],
      changeSet,
    })
    this.#publishArtifact(input.projectId, input.artifactId, archived ? 'archived' : 'restored', input.origin)
    this.#publishChangeSet(changeSet, input.origin)
    return { artifact: this.#metadata.getArtifact(input.artifactId)!, changeSet }
  }

  revert(changeSetId: string, origin?: ProjectEventOrigin): RevertResultV1 {
    const changeSet = this.#metadata.getMutationChangeSet(changeSetId)
    if (changeSet === undefined) throw new Error('Change set not found.')
    if (changeSet.status !== 'applied') return { revertable: false, changeSetId }
    if (changeSet.changes.some((change) => change.type === 'collection_identity_add')
      && changeSet.changes.some((change) => change.type === 'collection_membership_add')) {
      const changed = this.#metadata.transitionCollectionCreation(changeSetId, 'undo')
      if (!changed) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      this.#publishChangeSet(this.#metadata.getMutationChangeSet(changeSetId)!, origin)
      return { revertable: true, changeSetId }
    }

    // 1. 全部 touched state 必须仍等于本 ChangeSet apply 后的状态。
    for (const change of changeSet.changes) {
      if (change.type === 'presentation_state') {
        const current = this.#presentations.get(changeSet.projectId, change.presentationId)
        if (current === undefined || current.version !== change.afterVersion) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'artifact_archive_state') {
        const current = this.#metadata.getArtifact(change.artifactId)
        if (current === undefined || current.archivedAt !== change.afterArchivedAt) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'relation_upsert' || change.type === 'relation_update') {
        const current = this.#metadata.getRelation(change.relationId)
        if (current === undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        // 旧 HU-1B ChangeSet 使用 relation:<id>:applied，仅能做到 existence guard。
        if (!change.appliedFingerprint.endsWith(':applied') && relationFingerprint(relationSnapshot(current)) !== change.appliedFingerprint) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'relation_delete') {
        if (this.#metadata.getRelation(change.relationId) !== undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'artifact_text_update') {
        // 撤销修订：current 必须仍指向 agent 写入的 after 修订（之后有人写过则阻断，绝不覆盖新工作）。
        const current = this.#metadata.getArtifact(change.artifactId)
        if (current === undefined || current.currentRevisionId === undefined || String(current.currentRevisionId) !== change.afterRevisionId) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'artifact_text_create') {
        // 撤销创建：节点还在 AND 正文仍是创建时那版（被人编辑过则阻断——防误删用户后续工作）。
        const current = this.#metadata.getArtifact(change.artifactId)
        if (current === undefined || current.currentRevisionId === undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
        const revision = this.#metadata.getArtifactRevision(String(current.currentRevisionId))
        if (revision === undefined || String(revision.contentHash) !== change.createdContentHash) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'workspace_membership_add') {
        if (!this.#hasWorkspaceMember(change.workspaceId, change.viewId)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'workspace_membership_remove') {
        if (this.#hasWorkspaceMember(change.workspaceId, change.viewId)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'artifact_view_delete') {
        if (this.#metadata.getArtifactView(change.viewId) !== undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'note_delete') {
        if (this.#metadata.getNote(change.noteId) !== undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'result_slot_materialize') {
        const slot = this.#metadata.getResultSlot(change.slotId)
        if (slot === undefined || slot.status !== 'materialized' || String(slot.artifactViewId ?? '') !== String(change.artifactViewId ?? '')) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'workspace_entity_membership_add') {
        if (!this.#hasWorkspaceEntityMember(change.workspaceId, change.entityType, change.entityId)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'workspace_entity_membership_remove') {
        if (this.#hasWorkspaceEntityMember(change.workspaceId, change.entityType, change.entityId)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'spatial_marker_add') {
        if (this.#metadata.getSpatialMarkerIntent(change.markerId) === undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'spatial_marker_remove') {
        if (this.#metadata.getSpatialMarkerIntent(change.markerId) !== undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      }
      else if (change.type === 'color_pin_definition_add') {
        if (this.#metadata.getColorPinDefinition(change.colorPinId) === undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'color_pin_membership_add') {
        if (this.#metadata.getColorPinMembership(change.membershipId) === undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'color_pin_membership_remove') {
        if (this.#metadata.getColorPinMembership(change.membershipId) !== undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'collection_identity_add') {
        if (this.#metadata.getCollection(String(change.collection.id)) === undefined || this.#metadata.hasCollectionMemberships(String(change.collection.id))) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'collection_identity_remove') {
        if (this.#metadata.getCollection(change.collection.id) !== undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'collection_membership_add') {
        const m = change.membership
        if (this.#metadata.getCollectionMembership(changeSet.projectId, String(m.collectionId), m.memberRef.type, m.memberRef.id) === undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'collection_membership_remove') {
        const m = change.membership
        if (this.#metadata.getCollectionMembership(changeSet.projectId, String(m.collectionId), m.memberRef.type, m.memberRef.id) !== undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      }
    }

    // 2. 全部安全后才执行 inverse。
    for (const change of changeSet.changes) {
      if (change.type === 'presentation_state') {
        const current = this.#presentations.get(changeSet.projectId, change.presentationId)
        if (current !== undefined) {
          this.#presentations.save(changeSet.projectId, {
            presentationId: change.presentationId,
            scopeId: current.scopeId,
            capability: current.capability,
            renderer: current.renderer,
            state: change.inverse.stateSnapshot as never,
            expectedVersion: current.version,
            updatedBy: changeSet.actorKind === 'web' ? 'web' : 'agent',
          })
        }
      } else if (change.type === 'artifact_archive_state') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, artifactArchiveStates: [{ artifactId: change.artifactId, ...(change.beforeArchivedAt === undefined ? {} : { archivedAt: change.beforeArchivedAt }), updatedAt: new Date().toISOString() }] })
        this.#publishArtifact(changeSet.projectId, change.artifactId, change.beforeArchivedAt === undefined ? 'restored' : 'archived', origin)
      } else if (change.type === 'relation_upsert') {
        this.#metadata.deleteRelation(change.relationId)
        this.#publishRelation(changeSet.projectId, change.relationId, 'deleted', origin)
      } else if (change.type === 'relation_update' || change.type === 'relation_delete') {
        this.#restoreRelation(changeSet.projectId, change.relationId, change.inverse.relation)
        this.#publishRelation(changeSet.projectId, change.relationId, 'restored', origin)
      } else if (change.type === 'artifact_text_update') {
        this.#metadata.restoreArtifactCurrentRevision({
          artifactId: change.artifactId,
          targetRevisionId: change.inverse.targetRevisionId,
          expectedCurrentRevisionId: change.afterRevisionId,
        })
        this.#publishArtifact(changeSet.projectId, change.artifactId, 'restored', origin)
      } else if (change.type === 'artifact_text_create') {
        this.#metadata.deleteArtifact(change.artifactId)
        this.#publishArtifact(changeSet.projectId, change.artifactId, 'deleted', origin)
      } else if (change.type === 'workspace_membership_add') {
        this.#metadata.runCurationMutation({
          projectId: changeSet.projectId,
          workspaceMembershipRemoves: [{ workspaceId: change.workspaceId as never, viewId: change.viewId as never }],
        })
      } else if (change.type === 'workspace_membership_remove') {
        this.#metadata.runCurationMutation({
          projectId: changeSet.projectId,
          workspaceMembershipAdds: [{ workspaceId: change.workspaceId as never, viewId: change.viewId as never, addedBy: 'user', addedAt: new Date().toISOString() }],
        })
      } else if (change.type === 'artifact_view_delete') {
        this.#metadata.upsertArtifactView(change.inverse.view as never)
      } else if (change.type === 'note_delete') {
        this.#metadata.upsertNote(change.inverse.note as never)
      } else if (change.type === 'result_slot_materialize') {
        this.#metadata.updateResultSlot(change.slotId, { status: 'review', artifactId: undefined, artifactViewId: undefined })
      } else if (change.type === 'workspace_entity_membership_add') {
        this.#metadata.runCurationMutation({
          projectId: changeSet.projectId,
          workspaceEntityMembershipRemoves: [{ workspaceId: change.workspaceId as never, entityType: change.entityType, entityId: change.entityId }],
        })
      } else if (change.type === 'workspace_entity_membership_remove') {
        this.#metadata.runCurationMutation({
          projectId: changeSet.projectId,
          workspaceEntityMembershipAdds: [{ workspaceId: change.workspaceId as never, entityType: change.entityType, entityId: change.entityId, addedBy: 'user', addedAt: new Date().toISOString() }],
        })
      } else if (change.type === 'spatial_marker_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, spatialMarkerDeletes: [change.markerId] })
      } else if (change.type === 'spatial_marker_remove') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, spatialMarkerAdds: [change.marker] })
      }
      else if (change.type === 'color_pin_definition_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, colorPinDefinitionDeletes: [change.colorPinId] })
      } else if (change.type === 'color_pin_membership_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, colorPinMembershipDeletes: [change.membershipId] })
      } else if (change.type === 'color_pin_membership_remove') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, colorPinMembershipAdds: [change.membership] })
      } else if (change.type === 'collection_identity_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, collectionDeletes: [String(change.collection.id)] })
      } else if (change.type === 'collection_identity_remove') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, collectionAdds: [change.collection] })
      } else if (change.type === 'collection_membership_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, collectionMembershipDeletes: [change.membership] })
      } else if (change.type === 'collection_membership_remove') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, collectionMembershipAdds: [change.membership] })
      }
    }

    this.#metadata.markChangeSetReverted(changeSetId, new Date().toISOString())
    const updated = this.#metadata.getMutationChangeSet(changeSetId) ?? changeSet
    this.#publishChangeSet(updated, origin)
    return { revertable: true, changeSetId }
  }

  /** Safe redo. Legacy ChangeSets without forward snapshots remain undo-only. */
  reapply(changeSetId: string, origin?: ProjectEventOrigin): RevertResultV1 {
    const changeSet = this.#metadata.getMutationChangeSet(changeSetId)
    if (changeSet === undefined) throw new Error('Change set not found.')
    if (changeSet.status !== 'reverted') return { revertable: false, changeSetId }
    if (changeSet.changes.some((change) => change.type === 'collection_identity_add')
      && changeSet.changes.some((change) => change.type === 'collection_membership_add')) {
      const changed = this.#metadata.transitionCollectionCreation(changeSetId, 'redo')
      if (!changed) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      this.#publishChangeSet(this.#metadata.getMutationChangeSet(changeSetId)!, origin)
      return { revertable: true, changeSetId }
    }

    for (const change of changeSet.changes) {
      if (change.type === 'presentation_state') {
        if (change.forward === undefined) return { revertable: false, reason: 'FORWARD_STATE_UNAVAILABLE', changeSetId }
        const current = this.#presentations.get(changeSet.projectId, change.presentationId)
        if (current === undefined || stateFingerprint(current.state) !== stateFingerprint(change.inverse.stateSnapshot)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'artifact_archive_state') {
        const current = this.#metadata.getArtifact(change.artifactId)
        if (current === undefined || current.archivedAt !== change.beforeArchivedAt) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'relation_upsert') {
        if (change.forward === undefined) return { revertable: false, reason: 'FORWARD_STATE_UNAVAILABLE', changeSetId }
        if (this.#metadata.getRelation(change.relationId) !== undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'relation_update') {
        const current = this.#metadata.getRelation(change.relationId)
        if (current === undefined || relationFingerprint(relationSnapshot(current)) !== change.beforeFingerprint) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'relation_delete') {
        const current = this.#metadata.getRelation(change.relationId)
        if (current === undefined || relationFingerprint(relationSnapshot(current)) !== relationFingerprint(change.inverse.relation)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'artifact_text_update') {
        // 重做修订：current 必须仍停在撤销后的 before 修订（期间有人写过则阻断）。
        const current = this.#metadata.getArtifact(change.artifactId)
        if (current === undefined || current.currentRevisionId === undefined || String(current.currentRevisionId) !== change.beforeRevisionId) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'artifact_text_create') {
        // undo-only：创建的重做需全量复合重建，V0 不承诺。
        return { revertable: false, reason: 'FORWARD_STATE_UNAVAILABLE', changeSetId }
      } else if (change.type === 'workspace_membership_add') {
        if (this.#hasWorkspaceMember(change.workspaceId, change.viewId)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'workspace_membership_remove') {
        if (!this.#hasWorkspaceMember(change.workspaceId, change.viewId)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'artifact_view_delete') {
        if (this.#metadata.getArtifactView(change.viewId) === undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'note_delete') {
        if (this.#metadata.getNote(change.noteId) === undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'result_slot_materialize') {
        const slot = this.#metadata.getResultSlot(change.slotId)
        if (slot === undefined || slot.status !== 'review') {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'workspace_entity_membership_add') {
        if (this.#hasWorkspaceEntityMember(change.workspaceId, change.entityType, change.entityId)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'workspace_entity_membership_remove') {
        if (!this.#hasWorkspaceEntityMember(change.workspaceId, change.entityType, change.entityId)) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'spatial_marker_add') {
        if (this.#metadata.getSpatialMarkerIntent(change.markerId) !== undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      } else if (change.type === 'spatial_marker_remove') {
        if (this.#metadata.getSpatialMarkerIntent(change.markerId) === undefined) {
          return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
        }
      }
      else if (change.type === 'color_pin_definition_add') {
        if (this.#metadata.getColorPinDefinition(change.colorPinId) !== undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'color_pin_membership_add') {
        if (this.#metadata.getColorPinMembership(change.membershipId) !== undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'color_pin_membership_remove') {
        if (this.#metadata.getColorPinMembership(change.membershipId) === undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'collection_identity_add') {
        if (this.#metadata.getCollection(String(change.collection.id)) !== undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'collection_identity_remove') {
        if (this.#metadata.getCollection(change.collection.id) === undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'collection_membership_add') {
        const m = change.membership
        if (this.#metadata.getCollectionMembership(changeSet.projectId, String(m.collectionId), m.memberRef.type, m.memberRef.id) !== undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      } else if (change.type === 'collection_membership_remove') {
        const m = change.membership
        if (this.#metadata.getCollectionMembership(changeSet.projectId, String(m.collectionId), m.memberRef.type, m.memberRef.id) === undefined) return { revertable: false, reason: 'TOUCHED_STATE_CHANGED_AFTER_APPLY', changeSetId }
      }
    }

    for (const change of changeSet.changes) {
      if (change.type === 'presentation_state') {
        const current = this.#presentations.get(changeSet.projectId, change.presentationId)!
        this.#presentations.save(changeSet.projectId, {
          presentationId: change.presentationId,
          scopeId: current.scopeId,
          capability: current.capability,
          renderer: current.renderer,
          state: change.forward!.stateSnapshot as never,
          expectedVersion: current.version,
          updatedBy: changeSet.actorKind === 'web' ? 'web' : 'agent',
        })
      } else if (change.type === 'artifact_archive_state') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, artifactArchiveStates: [{ artifactId: change.artifactId, ...(change.afterArchivedAt === undefined ? {} : { archivedAt: change.afterArchivedAt }), updatedAt: new Date().toISOString() }] })
        this.#publishArtifact(changeSet.projectId, change.artifactId, change.afterArchivedAt === undefined ? 'restored' : 'archived', origin)
      } else if (change.type === 'relation_upsert') {
        this.#restoreRelation(changeSet.projectId, change.relationId, change.forward!.relation)
        this.#publishRelation(changeSet.projectId, change.relationId, 'upserted', origin)
      } else if (change.type === 'relation_update') {
        this.#restoreRelation(changeSet.projectId, change.relationId, change.forward.relation)
        this.#publishRelation(changeSet.projectId, change.relationId, 'upserted', origin)
      } else if (change.type === 'relation_delete') {
        this.#metadata.deleteRelation(change.relationId)
        this.#publishRelation(changeSet.projectId, change.relationId, 'deleted', origin)
      } else if (change.type === 'artifact_text_update') {
        this.#metadata.restoreArtifactCurrentRevision({
          artifactId: change.artifactId,
          targetRevisionId: change.forward.targetRevisionId,
          expectedCurrentRevisionId: change.beforeRevisionId,
        })
        this.#publishArtifact(changeSet.projectId, change.artifactId, 'restored', origin)
      } else if (change.type === 'workspace_membership_add') {
        this.#metadata.runCurationMutation({
          projectId: changeSet.projectId,
          workspaceMembershipAdds: [{ workspaceId: change.workspaceId as never, viewId: change.viewId as never, addedBy: 'user', addedAt: new Date().toISOString() }],
        })
      } else if (change.type === 'workspace_membership_remove') {
        this.#metadata.runCurationMutation({
          projectId: changeSet.projectId,
          workspaceMembershipRemoves: [{ workspaceId: change.workspaceId as never, viewId: change.viewId as never }],
        })
      } else if (change.type === 'artifact_view_delete') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, artifactViewDeletes: [change.viewId as never] })
      } else if (change.type === 'note_delete') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, noteDeletes: [change.noteId as never] })
      } else if (change.type === 'result_slot_materialize') {
        this.#metadata.updateResultSlot(change.slotId, {
          status: 'materialized',
          ...(change.artifactId === undefined ? {} : { artifactId: change.artifactId }),
          ...(change.artifactViewId === undefined ? {} : { artifactViewId: change.artifactViewId }),
          runId: change.runId,
        })
      } else if (change.type === 'workspace_entity_membership_add') {
        this.#metadata.runCurationMutation({
          projectId: changeSet.projectId,
          workspaceEntityMembershipAdds: [{ workspaceId: change.workspaceId as never, entityType: change.entityType, entityId: change.entityId, addedBy: 'user', addedAt: new Date().toISOString() }],
        })
      } else if (change.type === 'workspace_entity_membership_remove') {
        this.#metadata.runCurationMutation({
          projectId: changeSet.projectId,
          workspaceEntityMembershipRemoves: [{ workspaceId: change.workspaceId as never, entityType: change.entityType, entityId: change.entityId }],
        })
      } else if (change.type === 'spatial_marker_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, spatialMarkerAdds: [change.marker] })
      } else if (change.type === 'spatial_marker_remove') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, spatialMarkerDeletes: [change.markerId] })
      }
      else if (change.type === 'color_pin_definition_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, colorPinDefinitionAdds: [change.definition] })
      } else if (change.type === 'color_pin_membership_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, colorPinMembershipAdds: [change.membership] })
      } else if (change.type === 'color_pin_membership_remove') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, colorPinMembershipDeletes: [change.membershipId] })
      } else if (change.type === 'collection_identity_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, collectionAdds: [change.collection] })
      } else if (change.type === 'collection_identity_remove') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, collectionDeletes: [change.collection.id] })
      } else if (change.type === 'collection_membership_add') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, collectionMembershipAdds: [change.membership] })
      } else if (change.type === 'collection_membership_remove') {
        this.#metadata.runCurationMutation({ projectId: changeSet.projectId, collectionMembershipDeletes: [change.membership] })
      }
    }

    this.#metadata.markChangeSetApplied(changeSetId)
    const updated = this.#metadata.getMutationChangeSet(changeSetId) ?? changeSet
    this.#publishChangeSet(updated, origin)
    return { revertable: true, changeSetId }
  }

  /**
   * F6A2（20260829）：Spatial Marker 意图创建——用户持久导航意图进 semantic
   * ChangeSet（envelope 同事务；revert 删除 / reapply 用完整 snapshot 恢复）。
   * 跨 Project target fail-close（throw；路由层另有 422 前置校验）。
   */
  addSpatialMarker(input: {
    readonly projectId: string
    readonly targetRef: SpatialMarkerIntentV0['targetRef']
    readonly scope: SpatialMarkerIntentV0['scope']
    readonly sourceSurfaceRef?: SpatialMarkerIntentV0['sourceSurfaceRef']
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): { readonly marker: SpatialMarkerIntentV0; readonly changeSet: MutationChangeSetV1 } {
    if (String(input.targetRef.projectId) !== String(input.projectId)) {
      throw new Error('Cross-project spatial marker target is forbidden.')
    }
    const now = new Date().toISOString()
    const marker: SpatialMarkerIntentV0 = {
      id: `marker-${randomUUID()}`,
      projectId: input.projectId,
      targetRef: input.targetRef,
      scope: input.scope,
      ...(input.sourceSurfaceRef === undefined ? {} : { sourceSurfaceRef: input.sourceSurfaceRef }),
      createdAt: now,
      updatedAt: now,
    }
    const change: MutationChangeItemV1 = {
      type: 'spatial_marker_add',
      markerId: marker.id,
      marker,
      inverse: { type: 'spatial_marker_remove', markerId: marker.id },
      forward: { type: 'spatial_marker_add', markerId: marker.id },
      appliedFingerprint: `spatial-marker:${marker.id}:present`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `spatial-marker-add-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes: [change],
    })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      spatialMarkerAdds: [marker],
      changeSet,
    })
    this.#publishChangeSet(changeSet, input.origin)
    return { marker, changeSet }
  }

  /** F6A2：marker 删除进 ChangeSet（非存在/跨 Project → undefined，幂等诚实）。 */
  removeSpatialMarker(input: {
    readonly projectId: string
    readonly markerId: string
    readonly operationId?: string
    readonly actorKind?: MutationChangeSetV1['actorKind']
    readonly origin?: ProjectEventOrigin
  }): MutationChangeSetV1 | undefined {
    const marker = this.#metadata.getSpatialMarkerIntent(input.markerId)
    if (marker === undefined || String(marker.projectId) !== String(input.projectId)) return undefined
    const change: MutationChangeItemV1 = {
      type: 'spatial_marker_remove',
      markerId: input.markerId,
      marker,
      inverse: { type: 'spatial_marker_add', markerId: input.markerId },
      forward: { type: 'spatial_marker_remove', markerId: input.markerId },
      appliedFingerprint: `spatial-marker:${input.markerId}:absent`,
    }
    const changeSet = this.#buildChangeSet({
      projectId: input.projectId,
      operationId: input.operationId ?? input.origin?.operationId ?? `spatial-marker-remove-${randomUUID()}`,
      actorKind: input.actorKind ?? 'web',
      changes: [change],
    })
    this.#metadata.runCurationMutation({
      projectId: input.projectId,
      spatialMarkerDeletes: [input.markerId],
      changeSet,
    })
    this.#publishChangeSet(changeSet, input.origin)
    return changeSet
  }

  #hasWorkspaceMember(workspaceId: string, viewId: string): boolean {
    return this.#metadata.listWorkspaceMembers(workspaceId as never).some((member) => String(member.artifactViewId) === viewId)
  }

  #hasWorkspaceEntityMember(workspaceId: string, entityType: string, entityId: string): boolean {
    return this.#metadata.listWorkspaceEntityMembers(workspaceId as never).some((member) => member.entityType === entityType && member.entityId === entityId)
  }

  #buildChangeSet(input: {
    readonly projectId: string
    readonly operationId: string
    readonly actorKind: MutationChangeSetV1['actorKind']
    readonly actorId?: string
    readonly changes: readonly MutationChangeItemV1[]
  }): MutationChangeSetV1 {
    const now = new Date().toISOString()
    return {
      schemaVersion: 1,
      id: `changeset-${randomUUID()}`,
      projectId: input.projectId,
      operationId: input.operationId,
      actorKind: input.actorKind,
      ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
      changes: input.changes,
      status: 'applied',
      createdAt: now,
    }
  }

  #restoreRelation(projectId: string, relationId: string, value: MutationRelationSnapshotV1): void {
    const now = new Date().toISOString()
    this.#metadata.upsertRelation({
      id: relationId as never,
      projectId: projectId as never,
      sourceEntityType: value.sourceEntityType as never,
      sourceEntityId: value.sourceEntityId,
      targetEntityType: value.targetEntityType as never,
      targetEntityId: value.targetEntityId,
      kind: value.kind,
      createdAt: now,
      updatedAt: now,
      ...(value.origin === undefined ? {} : { origin: value.origin as never }),
      ...(value.createdBy === undefined ? {} : { createdBy: value.createdBy }),
      ...(value.evidenceRefs === undefined ? {} : { evidenceRefs: value.evidenceRefs }),
      ...(value.confidence === undefined ? {} : { confidence: value.confidence }),
    })
  }

  #publishChangeSet(changeSet: MutationChangeSetV1, origin?: ProjectEventOrigin): void {
    this.#events?.publish(changeSet.projectId, {
      channel: 'mutation',
      type: 'change_set.changed',
      ...(origin === undefined ? {} : { origin }),
      payload: { changeSetId: changeSet.id, status: changeSet.status, operationId: changeSet.operationId },
    })
  }

  #publishRelation(projectId: string, relationId: string, action: 'upserted' | 'deleted' | 'restored', origin?: ProjectEventOrigin): void {
    this.#events?.publish(projectId, {
      channel: 'mutation',
      type: 'relation.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [`relation:${relationId}`],
      payload: { relationId, action },
    })
  }
  #publishArtifact(projectId: string, artifactId: string, action: 'archived' | 'restored' | 'deleted', origin?: ProjectEventOrigin): void {
    this.#events?.publish(projectId, {
      channel: 'artifact',
      type: 'artifact.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [`artifact:${artifactId}`],
      payload: { artifactId, action },
    })
  }
}
