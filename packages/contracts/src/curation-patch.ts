import type { PresentationEntityRefV0 } from './presentations.js'
import type { SpatialMarkerIntentV0 } from './navigation-marker.js'
import type { ColorPinDefinitionV0, ColorPinMembershipV0 } from './color-pin.js'

/**
 * CurationPatch V0 — Phase E. A minimal batch write for the Curator skill:
 * create texts, add relations with provenance, patch one Presentation with CAS.
 * clientRef lets one patch reference newly created objects.
 * V0 does not promise FS+SQLite global ACID; each step returns a receipt.
 */

export interface CurationPatchTargetRefV0 {
  readonly clientRef?: string
  readonly entityType?: 'artifact' | 'view' | 'workspace'
  readonly entityId?: string
}

export interface CurationPatchCreateTextV0 {
  readonly clientRef: string
  readonly title?: string
  readonly body: string
}

export interface CurationPatchRelationV0 {
  readonly from: CurationPatchTargetRefV0
  readonly to: CurationPatchTargetRefV0
  readonly label?: string
  readonly kind?: string
  readonly origin?: 'user' | 'agent' | 'system'
  readonly createdBy?: string
  readonly evidenceRefs?: readonly { readonly kind: 'artifact' | 'resource' | 'conversation' | 'file'; readonly id: string; readonly label?: string; readonly revisionId?: string; readonly sourceAnchor?: string }[]
  readonly confidence?: number
}

export interface CurationPatchPresentationV0 {
  readonly presentationId: string
  readonly expectedVersion: number
  readonly addMembers?: readonly CurationPatchTargetRefV0[]
  readonly removeMembers?: readonly string[]
  readonly setRenderer?: string
  readonly setHierarchy?: { readonly parentByViewId: Record<string, string | null>; readonly orderByParent: Record<string, string[]> }
  readonly addPresentationEdges?: readonly { readonly id: string; readonly from: CurationPatchTargetRefV0; readonly to: CurationPatchTargetRefV0; readonly label?: string }[]
  readonly removePresentationEdges?: readonly string[]
  /**
   * F6 follow-up（20260828 补充冻结）：Drop 落点与 membership 同 patch 提交——
   * 纯位置微调仍走前端 presentation save（非 semantic）；此处只用于"新成员的初始投影"。
   */
  readonly setPositions?: Readonly<Record<string, { readonly x: number; readonly y: number }>>
  /** F6 B6（P0-A aggregate / P0-E note）：无 view 的聚合实体成员（memberEntityRefs 通道）；不递归展开 children。 */
  readonly addEntityMembers?: readonly PresentationEntityRefV0[]
  readonly setEmphasis?: Readonly<Record<string, 'primary' | 'normal' | 'secondary' | 'muted'>>
  readonly pin?: readonly string[]
  readonly unpin?: readonly string[]
}

export interface CurationPatchV0 {
  readonly schemaVersion: 0
  readonly operationId?: string
  readonly projectId: string
  readonly scopeId: string
  readonly createTexts: readonly CurationPatchCreateTextV0[]
  readonly relations: readonly CurationPatchRelationV0[]
  readonly presentation?: CurationPatchPresentationV0
  /** F6 follow-up：apply 通道的用户 drop 写入时如实记 actor（默认 'agent' 兼容既有调用）。 */
  readonly actorKind?: 'web' | 'agent' | 'core'
}

export interface CurationPatchStepReceiptV0 {
  readonly step: 'createText' | 'relation' | 'presentation'
  readonly clientRef?: string
  readonly artifactId?: string
  readonly viewId?: string
  readonly revisionId?: string
  readonly relationId?: string
}

export interface CurationPatchReceiptV0 {
  readonly schemaVersion: 0
  readonly operationId: string
  readonly applied: boolean
  readonly completedSteps: readonly CurationPatchStepReceiptV0[]
  readonly failedStep?: { readonly step: string; readonly error: string }
  readonly createdAt: string
  /** F6 follow-up：apply 成功时带回 ChangeSet id（前端 undo 入口）。 */
  readonly changeSetId?: string
}

/** B5：Change Set 是 technical audit / undo contract，不是新的 Project Domain Entity。 */
export interface MutationRelationSnapshotV1 {
  readonly sourceEntityType: string
  readonly sourceEntityId: string
  readonly targetEntityType: string
  readonly targetEntityId: string
  readonly kind: string
  readonly origin?: string
  readonly createdBy?: string
  readonly evidenceRefs?: readonly { readonly kind: 'artifact' | 'resource' | 'conversation' | 'file'; readonly id: string; readonly label?: string; readonly revisionId?: string; readonly sourceAnchor?: string }[]
  readonly confidence?: number
}

export type MutationChangeItemV1 =
  | {
      readonly type: 'presentation_state'
      readonly presentationId: string
      readonly beforeVersion: number
      readonly afterVersion: number
      readonly inverse: {
        readonly type: 'restore_presentation_state'
        readonly presentationId: string
        readonly targetVersion: number
        readonly stateSnapshot: unknown
      }
      /** 新 ChangeSet 会保存 forward snapshot，旧 ChangeSet 缺失时只支持安全撤销、不承诺重做。 */
      readonly forward?: {
        readonly type: 'restore_presentation_state'
        readonly presentationId: string
        readonly stateSnapshot: unknown
      }
      readonly touchedKeys: readonly string[]
      readonly appliedFingerprint: string
    }
  | {
      /** Relation 原先不存在，本次创建。 */
      readonly type: 'relation_upsert'
      readonly relationId: string
      readonly inverse: { readonly type: 'delete_relation'; readonly relationId: string }
      readonly forward?: { readonly type: 'restore_relation'; readonly relationId: string; readonly relation: MutationRelationSnapshotV1 }
      readonly appliedFingerprint: string
    }
  | {
      /** Relation 原先存在，本次修改。 */
      readonly type: 'relation_update'
      readonly relationId: string
      readonly inverse: { readonly type: 'restore_relation'; readonly relationId: string; readonly relation: MutationRelationSnapshotV1 }
      readonly forward: { readonly type: 'restore_relation'; readonly relationId: string; readonly relation: MutationRelationSnapshotV1 }
      readonly beforeFingerprint: string
      readonly appliedFingerprint: string
    }
  | {
      readonly type: 'relation_delete'
      readonly relationId: string
      readonly inverse: {
        readonly type: 'restore_relation'
        readonly relationId: string
        readonly relation: MutationRelationSnapshotV1
      }
      readonly forward?: { readonly type: 'delete_relation'; readonly relationId: string }
      readonly appliedFingerprint: string
    }

  | {
      /** F6 follow-up（20260828 补充冻结 §7）：Scene working-set membership 进 semantic ChangeSet。 */
      readonly type: 'workspace_membership_add'
      readonly workspaceId: string
      readonly viewId: string
      readonly inverse: { readonly type: 'workspace_membership_remove'; readonly workspaceId: string; readonly viewId: string }
      readonly forward?: { readonly type: 'workspace_membership_add'; readonly workspaceId: string; readonly viewId: string }
      readonly appliedFingerprint: string
    }
  | {
      readonly type: 'workspace_membership_remove'
      readonly workspaceId: string
      readonly viewId: string
      readonly inverse: { readonly type: 'workspace_membership_add'; readonly workspaceId: string; readonly viewId: string }
      readonly forward?: { readonly type: 'workspace_membership_remove'; readonly workspaceId: string; readonly viewId: string }
      readonly appliedFingerprint: string
    }
  | {
      /** F6 B6（P1-B census）：破坏性删除进 semantic ChangeSet——ArtifactView（snapshot 供 restore）。 */
      readonly type: 'artifact_view_delete'
      readonly viewId: string
      readonly artifactId: string
      readonly inverse: { readonly type: 'restore_artifact_view'; readonly view: unknown }
      readonly forward?: { readonly type: 'delete_artifact_view'; readonly viewId: string }
      readonly appliedFingerprint: string
    }
  | {
      readonly type: 'note_delete'
      readonly noteId: string
      readonly inverse: { readonly type: 'restore_note'; readonly note: unknown }
      readonly forward?: { readonly type: 'delete_note'; readonly noteId: string }
      readonly appliedFingerprint: string
    }
  | {
      /** F6 B6：ResultSlot materialize 挂 parent Run 的 ChangeSet（accept 时记录；inverse 回 review）。 */
      readonly type: 'result_slot_materialize'
      readonly slotId: string
      readonly runId: string
      readonly artifactId?: string
      readonly artifactViewId?: string
      readonly inverse: { readonly type: 'result_slot_restore'; readonly slotId: string; readonly status: 'review' }
      readonly forward?: { readonly type: 'result_slot_materialize'; readonly slotId: string; readonly runId: string; readonly artifactId?: string; readonly artifactViewId?: string }
      readonly appliedFingerprint: string
    }
  | {
      /** 裁决 1（20260828）：Scene working-set 的 entity 成员（Note 等无 view 实体）进 semantic ChangeSet。 */
      readonly type: 'workspace_entity_membership_add'
      readonly workspaceId: string
      readonly entityType: 'note' | 'scope' | 'workspace' | 'conversation'
      readonly entityId: string
      readonly inverse: { readonly type: 'workspace_entity_membership_remove'; readonly workspaceId: string; readonly entityType: 'note' | 'scope' | 'workspace' | 'conversation'; readonly entityId: string }
      readonly forward?: { readonly type: 'workspace_entity_membership_add'; readonly workspaceId: string; readonly entityType: 'note' | 'scope' | 'workspace' | 'conversation'; readonly entityId: string }
      readonly appliedFingerprint: string
    }
  | {
      readonly type: 'workspace_entity_membership_remove'
      readonly workspaceId: string
      readonly entityType: 'note' | 'scope' | 'workspace' | 'conversation'
      readonly entityId: string
      readonly inverse: { readonly type: 'workspace_entity_membership_add'; readonly workspaceId: string; readonly entityType: 'note' | 'scope' | 'workspace' | 'conversation'; readonly entityId: string }
      readonly forward?: { readonly type: 'workspace_entity_membership_remove'; readonly workspaceId: string; readonly entityType: 'note' | 'scope' | 'workspace' | 'conversation'; readonly entityId: string }
      readonly appliedFingerprint: string
    }
  | {
      /** F6A2（20260829）：Spatial Marker 意图（用户持久导航意图）进 semantic ChangeSet。 */
      readonly type: 'spatial_marker_add'
      readonly markerId: string
      readonly marker: SpatialMarkerIntentV0
      readonly inverse: { readonly type: 'spatial_marker_remove'; readonly markerId: string }
      readonly forward?: { readonly type: 'spatial_marker_add'; readonly markerId: string }
      readonly appliedFingerprint: string
    }
  | {
      readonly type: 'spatial_marker_remove'
      readonly markerId: string
      readonly marker: SpatialMarkerIntentV0
      readonly inverse: { readonly type: 'spatial_marker_add'; readonly markerId: string }
      readonly forward?: { readonly type: 'spatial_marker_remove'; readonly markerId: string }
      readonly appliedFingerprint: string
    }
  | {
      /** A25-6: user-authored Color Pin identity creation. */
      readonly type: 'color_pin_definition_add'
      readonly colorPinId: string
      readonly definition: ColorPinDefinitionV0
      readonly inverse: { readonly type: 'color_pin_definition_remove'; readonly colorPinId: string }
      readonly forward?: { readonly type: 'color_pin_definition_add'; readonly colorPinId: string }
      readonly appliedFingerprint: string
    }
  | {
      readonly type: 'color_pin_membership_add'
      readonly membershipId: string
      readonly membership: ColorPinMembershipV0
      readonly inverse: { readonly type: 'color_pin_membership_remove'; readonly membershipId: string }
      readonly forward?: { readonly type: 'color_pin_membership_add'; readonly membershipId: string }
      readonly appliedFingerprint: string
    }
  | {
      readonly type: 'color_pin_membership_remove'
      readonly membershipId: string
      readonly membership: ColorPinMembershipV0
      readonly inverse: { readonly type: 'color_pin_membership_add'; readonly membershipId: string }
      readonly forward?: { readonly type: 'color_pin_membership_remove'; readonly membershipId: string }
      readonly appliedFingerprint: string
    }
  | {
      /** 任务四 P1 change-review：agent 经 CAS 通道修订受管 text（updateText）。撤销 = current 指回 before 修订。 */
      readonly type: 'artifact_text_update'
      readonly artifactId: string
      readonly viewId?: string
      readonly beforeRevisionId: string
      readonly afterRevisionId: string
      readonly inverse: { readonly type: 'restore_artifact_text'; readonly artifactId: string; readonly targetRevisionId: string }
      readonly forward: { readonly type: 'restore_artifact_text'; readonly artifactId: string; readonly targetRevisionId: string }
      /** 新正文 contentHash（hex）。撤销陈旧校验以 currentRevisionId 指针为准，此指纹供审计展示。 */
      readonly appliedFingerprint: string
    }
  | {
      /** 任务四 P1 change-review：agent 创建受管 text。撤销 = 删除该 artifact；正文被后人改过则阻断（防误删用户后续编辑）。 */
      readonly type: 'artifact_text_create'
      readonly artifactId: string
      readonly viewId: string
      readonly revisionId: string
      /** 创建时正文 contentHash（hex）；撤销前与当前 current revision 的 hash 比对。 */
      readonly createdContentHash: string
      readonly inverse: { readonly type: 'delete_artifact'; readonly artifactId: string }
      /** undo-only：重做需全量复合重建，V0 不承诺（对齐旧 presentation ChangeSet 的诚实降级）。 */
      readonly appliedFingerprint: string
    }
export interface MutationChangeSetV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly projectId: string
  readonly operationId: string
  readonly actorKind: 'agent' | 'web' | 'core'
  readonly actorId?: string
  readonly changes: readonly MutationChangeItemV1[]
  readonly status: 'applied' | 'reverted'
  readonly createdAt: string
  readonly revertedAt?: string
  readonly reappliedAt?: string
}

/**
 * 任务三第二刀（20260826，huabu ExecuteConflict 同构）：
 * Agent 写已有 text content 时的 CAS 拒绝两态。
 * - `not-read`：本次 session 从未 full-read 过该 artifact——必须先 read 再写，
 *   原样重试恒失败（write guard 只认 server 侧 readSet lease，模型不能手带）。
 * - `stale`：读到过的 revision 已被并发写更新——重读、reconcile、再发。
 */
export type CurationWriteConflictReasonV1 = 'not-read' | 'stale'

export interface CurationWriteConflictV1 {
  readonly artifactId: string
  readonly viewId?: string
  readonly reason: CurationWriteConflictReasonV1
  /** Agent 读到过的 revision；`not-read` 时缺失。 */
  readonly expectedRevisionId?: string
  /** 仓库当前 revision；artifact 无 current revision 时缺失。 */
  readonly currentRevisionId?: string
  /** 给模型的下一步指令（huabu buildConflictHint 直译）。 */
  readonly hint: string
}

/** huabu canvas-write.ts buildConflictHint 同构：拼一句模型可执行的指令。 */
export function buildCurationConflictHintV1(conflicts: readonly CurationWriteConflictV1[]): string {
  const parts: string[] = []
  if (conflicts.some((conflict) => conflict.reason === 'not-read')) {
    parts.push('Read before write: read the conflicted node(s) first, then re-issue. Retrying as-is fails again.')
  }
  if (conflicts.some((conflict) => conflict.reason === 'stale')) {
    parts.push('Node(s) changed since your last read — re-read, reconcile, then re-issue.')
  }
  return parts.join(' ')
}

/**
 * updateText（修订已有受管 text）的结果：成功 or 被 CAS guard 拒绝。
 * 拒绝时永远带结构化 conflicts + conflictHint；无 sessionId（GUI 直编）不设防，恒 applied。
 */
export type CurationTextUpdateOutcomeV1 =
  | {
      readonly outcome: 'applied'
      readonly artifactId: string
      readonly viewId: string
      readonly revisionId: string
      readonly legacyMigrated: boolean
    }
  | {
      readonly outcome: 'rejected'
      readonly conflicts: readonly CurationWriteConflictV1[]
      readonly conflictHint: string
    }
