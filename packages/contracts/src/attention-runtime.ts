/**
 * B4 Attention + Intent Runtime contracts.
 *
 * These values are current-work projections over Project Truth. They are NOT
 * Project entities and must never become a second source of truth.
 */

export type IntentTypeV0 =
  | 'continue_work'
  | 'understand'
  | 'compare'
  | 'revise'
  | 'review'
  | 'extract_actions'
  | 'create_brief'
  | 'organize'
  | 'research'
  | 'execute_skill'
  | 'unknown'

export type IntentSourceV0 = 'explicit' | 'rule' | 'model' | 'fallback'

export interface RecentDeltaV0 {
  readonly id: string
  readonly kind: string
  readonly summary: string
  readonly viewIds: readonly string[]
  readonly occurredAt: string
  readonly source: 'web' | 'codex' | 'core'
}

export interface OpenLoopV0 {
  readonly key: string
  readonly title: string
  readonly status: 'open' | 'in_progress' | 'review'
  readonly relatedViewIds: readonly string[]
  readonly source: 'workspace' | 'runtime' | 'artifact-return' | 'context'
  readonly updatedAt: string
}

export interface ExplicitIntentV0 {
  readonly type: IntentTypeV0
  readonly goal?: string
}

export interface WorkStateSnapshotV0 {
  readonly schemaVersion: 0
  readonly projectId: string
  readonly workspaceId: string | null
  readonly scopeId: string | null
  readonly currentSurface?: string
  readonly currentHarness?: string
  readonly selectedViewIds: readonly string[]
  readonly pinnedViewIds: readonly string[]
  readonly excludedViewIds: readonly string[]
  readonly lockedViewIds: readonly string[]
  readonly activeContextRef?: string
  readonly activeWorkflowRef?: string
  readonly explicitIntent?: ExplicitIntentV0
  readonly recentDelta: readonly RecentDeltaV0[]
  readonly openLoops: readonly OpenLoopV0[]
  /** Stable over viewport-only movement and candidate suppression. */
  readonly semanticFingerprint: string
  readonly updatedAt: string
}

export interface IntentCandidateV0 {
  readonly type: IntentTypeV0
  readonly objectViewIds: readonly string[]
  readonly goal: string
  readonly constraints: readonly string[]
  readonly expectedOutput?: string
  readonly evidenceKeys: readonly string[]
  readonly suggestedSkillIds: readonly string[]
  readonly confidence: number
  readonly confidenceBand: 'low' | 'medium' | 'high'
  readonly source: IntentSourceV0
  readonly modelProviderId?: string
  readonly modelId?: string
  readonly createdAt: string
}

export type AttentionEvidenceSourceV0 =
  | 'selected'
  | 'pinned'
  | 'locked'
  | 'explicit_relation'
  | 'workflow_requirement'
  | 'same_context'
  | 'same_collection'
  | 'same_scene'
  | 'recent_delta'
  | 'spatial_neighbourhood'
  | 'semantic_retrieval'
  | 'agent_requested'

export type AttentionBucketV0 = 'selected' | 'pinned' | 'related' | 'retrieved'

export interface AttentionSpatialEvidenceV0 {
  readonly edgeDistance?: number
  readonly relativeDirection?: 'above' | 'below' | 'left' | 'right' | 'overlap'
  readonly clusterId?: string
  readonly arrangement?: 'row' | 'column' | 'cluster' | 'freeform'
}

export interface AttentionEvidenceV0 {
  readonly key: string
  readonly viewId: string
  readonly artifactId?: string
  readonly title: string
  readonly bucket: AttentionBucketV0
  readonly source: AttentionEvidenceSourceV0
  readonly strength: number
  readonly reason: string
  readonly relationPath?: readonly string[]
  readonly spatial?: AttentionSpatialEvidenceV0
  readonly freshness?: number
  readonly provenance: string
}

export interface AttentionProjectionV0 {
  readonly selected: readonly AttentionEvidenceV0[]
  readonly pinned: readonly AttentionEvidenceV0[]
  readonly related: readonly AttentionEvidenceV0[]
  readonly retrieved: readonly AttentionEvidenceV0[]
}

export type ContinuityCandidateTypeV0 = 'resume' | 'resolve' | 'review' | 'explore'

export interface ContinuityCandidateV0 {
  readonly key: string
  readonly validityHash: string
  readonly type: ContinuityCandidateTypeV0
  readonly projectId: string
  readonly workspaceId: string | null
  readonly title: string
  readonly subtitle?: string
  readonly intent: IntentCandidateV0
  readonly evidenceKeys: readonly string[]
  readonly attentionPreview: {
    readonly selected: number
    readonly pinned: number
    readonly related: number
    readonly retrieved: number
  }
  readonly requiredViewIds: readonly string[]
  readonly suggestedSkillIds: readonly string[]
  readonly confidence: number
  readonly createdAt: string
}

export type ContextContentLevelV0 = 'L0' | 'L1' | 'L2' | 'L3'

export interface ContextPackItemV0 {
  readonly viewId: string
  readonly artifactId?: string
  readonly title: string
  readonly bucket: AttentionBucketV0
  readonly source: AttentionEvidenceSourceV0
  readonly level: ContextContentLevelV0
  readonly reason: string
  readonly content?: string
  readonly provenance: string
  readonly estimatedTokens: number
}

export interface ContextPackV0 {
  readonly schemaVersion: 0
  readonly projectId: string
  readonly workspaceId: string | null
  readonly intent: IntentCandidateV0
  readonly items: readonly ContextPackItemV0[]
  readonly selectedCount: number
  readonly pinnedCount: number
  readonly relatedCount: number
  readonly retrievedCount: number
  readonly estimatedTokens: number
  readonly tokenBudget: number
  readonly truncated: boolean
  readonly createdAt: string
}

export type SideEffectClassV0 = 'READ_ONLY' | 'PREPARE' | 'LOCAL_MUTATION' | 'EXTERNAL_ACTION' | 'DESTRUCTIVE'

export interface SkillTargetProposalV0 {
  readonly intentType: IntentTypeV0
  readonly primarySkillId?: string
  readonly supportingSkillIds: readonly string[]
  readonly target: string
  readonly sideEffect: SideEffectClassV0
  readonly requiresApproval: boolean
  readonly reason: string
}

export interface AttentionRuntimeSnapshotV0 {
  readonly schemaVersion: 0
  readonly workState: WorkStateSnapshotV0
  readonly intent: IntentCandidateV0
  readonly attention: AttentionProjectionV0
  readonly candidates: readonly ContinuityCandidateV0[]
  readonly contextPack: ContextPackV0
  readonly skillTarget: SkillTargetProposalV0
}
