/**
 * PresentationViewV0 contract — frozen at Phase A (Contract Freeze & Detox).
 *
 * Presentation is a re-buildable view over Project Truth. It owns membership,
 * position, hierarchy, display relations, manual anchors, emphasis and
 * renderer choice — NOT business semantics, revisions, runs or file truth.
 *
 * R3.1-A semantic correction: `scopeId` identifies/persists the Presentation
 * owner; it is NOT a membership boundary. `memberViewIds` may reference any
 * ArtifactView in the same Project, regardless of the View's physical Scope.
 * Main Canvas / Context Graph / Workflow are parallel projections over Project Truth.
 * A concrete Context is another Presentation over those same Project Views; its
 * Signal Track and Mind Map are renderers of one exact member set.
 *
 * Deliberately excluded from this contract: business ontology fields and
 * browser ephemeral state (those belong to ActiveContext or the browser).
 *
 * No database migration in Phase A; this file only locks the interface.
 */

export type PresentationCapabilityV0 =
  | 'arrange'
  | 'context'
  | 'workflow'
  | 'custom'

export type PresentationLayoutModeV0 = 'freeform' | 'grid'

export interface PresentationGridLayoutV0 {
  /** Stable semantic-neutral order for Grid mode. */
  order: string[]
  columns?: number
  gap?: number
}

export type PresentationEmphasisV0 =
  | 'primary'
  | 'normal'
  | 'secondary'
  | 'muted'

/**
 * Wave C-2（批八）：'conversation' 为向后兼容超集成员——对话实体以 Presentation ref
 * 身份参与投影（Web 侧派生；Core 侧持久化留 0.2）。既有三成员语义不变。
 */
/** F6 B6（P0-E 方案 A）：Note 是无 view 的独立实体，以 entity ref 身份参与投影。 */
export type PresentationEntityTypeV0 = 'view' | 'scope' | 'workspace' | 'conversation' | 'note'

export interface PresentationEntityRefV0 {
  type: PresentationEntityTypeV0
  id: string
}

export interface PresentationEdgeV0 {
  id: string
  fromViewId: string
  toViewId: string
  label?: string
}

export interface PresentationHierarchyV0 {
  parentByViewId: Record<string, string | null>
  orderByParent: Record<string, string[]>
}

/**
 * Phase 3 §6.3：Signal Track 段（Presentation-only，不落任何 Core 业务实体）。
 * 轴表达理解/顺序，不是时间；成员必须是 Presentation 成员视图。
 */
export interface ContextTrackSegmentV0 {
  id: string
  memberViewIds: string[]
  order: number
  collapsed: boolean
  label?: string
}

/**
 * Phase 4 §7.1-7.3：Workflow operator（authoring metadata，Presentation-only）。
 * Core 不执行语义条件；predicateText 只是创作内容，由 Skill/Agent 在运行时解释。
 */
export type WorkflowOperatorKindV0 = 'condition' | 'parallel-split' | 'parallel-join' | 'reference'

export interface WorkflowConditionBranchV0 {
  id: string
  label: string
  predicateText?: string
  targetViewId?: string
}

export interface WorkflowOperatorV0 {
  kind: WorkflowOperatorKindV0
  label?: string
  branches?: WorkflowConditionBranchV0[]
}


export interface WorkflowActionV0 {
  id: string
  label: string
  description?: string
  /** Existing Project Views used by this action. No Artifact clone is created. */
  attachedViewIds: string[]
  x: number
  y: number
}

export interface WorkflowActionEdgeV0 {
  id: string
  fromActionId: string
  toActionId: string
  label?: string
}

/**
 * Canonical spatial Colony. A Colony is Presentation organization truth:
 * sticky membership + a soft spatial contour. It is not Collection containment
 * and membership is never recomputed merely because an object crosses a line.
 */
export interface PresentationColonyV0 {
  id: string
  label?: string
  surface: 'main' | 'context' | 'workflow'
  memberIds: string[]
  contour: { points: Array<{ x: number; y: number }> }
}

/** @deprecated v0.15 compatibility input only. Migrate to PresentationColonyV0. */
export interface PresentationSpatialRegionV0 {
  id: string
  label?: string
  bounds: { x: number; y: number; width: number; height: number }
}

/**
 * Spatial Surface component contract. Components are Presentation-only
 * projections over Project Truth. Bindings keep identity/locators only; they
 * never embed a copied Project entity.
 */
export type SurfaceKindV0 = 'main' | 'context' | 'workflow'

export type SurfaceComponentTypeV0 =
  | 'fence'
  | 'region'
  | 'portal'
  | 'source-chain'
  | 'structure-map'
  | 'evolution'
  | 'relationship-field'
  | 'context-pack'
  | 'stack'
  | 'compare'
  | 'workflow-step'
  | 'review'
  | 'checkpoint'
  | 'active-path'
  | 'workbench'

export interface SurfaceBoundsV0 {
  x: number
  y: number
  w: number
  h: number
}

export interface SurfaceBindingV0 {
  entityId?: string
  artifactId?: string
  /** 绑定的对话实体（Glyth 投影用）——v0.15 感知层：Conversation 上画布的契约前提；可选，零破坏。 */
  conversationId?: string
  workflowId?: string
  stepId?: string
  contextId?: string
  projectViewId?: string
  /** Stable Project View identity refs used as component seeds. No copied entity payloads. */
  projectViewIds?: string[]
  checkpointId?: string
  runId?: string
}

export interface SurfaceElementPresentationV0 {
  pinned?: boolean
  collapsed?: boolean
  zIndex?: number
  variant?: string
}

export interface SurfaceElementV0 {
  id: string
  projectId: string
  surface: SurfaceKindV0
  type: SurfaceComponentTypeV0
  bounds: SurfaceBoundsV0
  binding?: SurfaceBindingV0
  presentation?: SurfaceElementPresentationV0
}

export interface PresentationStateV0 {
  memberViewIds: string[]
  /** Aggregate Project entities that do not require fake ArtifactViews (e.g. Workspace). */
  memberEntityRefs?: PresentationEntityRefV0[]
  hiddenViewIds: string[]
  /** Freeform positions are preserved even while Grid is active. */
  positions: Record<string, { x: number; y: number }>
  layoutMode?: PresentationLayoutModeV0
  /** Grid never owns membership; it only stores order/slot presentation state. */
  gridLayout?: PresentationGridLayoutV0
  hierarchy: PresentationHierarchyV0
  presentationEdges: PresentationEdgeV0[]
  pinnedViewIds: string[]
  emphasisByViewId: Record<string, PresentationEmphasisV0>
  /** Canonical sticky spatial organization primitive shared by all Surfaces. */
  colonies?: PresentationColonyV0[]
  /** @deprecated read-only compatibility input for pre-R3-A fence/region state. */
  spatialRegions?: PresentationSpatialRegionV0[]
  /** Trusted spatial components. They store Presentation geometry + identity-only binding. */
  surfaceElements?: SurfaceElementV0[]
  /** Marks that the replaceable first-use Surface composition has already run. */
  surfaceBootstrapVersion?: number
  trackSegments?: ContextTrackSegmentV0[]
  workflowOperators?: Record<string, WorkflowOperatorV0>
  /** Workflow-only action skeleton. Materials remain memberViewIds and are attached by reference. */
  workflowActions?: WorkflowActionV0[]
  workflowActionEdges?: WorkflowActionEdgeV0[]
}

export interface PresentationViewV0 {
  schemaVersion: 0
  id: string
  projectId: string
  scopeId: string
  capability: PresentationCapabilityV0
  renderer: string
  state: PresentationStateV0
  version: number
  updatedBy: 'web' | 'agent' | 'core'
  createdAt: string
  updatedAt: string
}
