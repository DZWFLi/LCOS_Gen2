import type {
  Artifact,
  ArtifactId,
  ArtifactReturn,
  ArtifactReturnId,
  ArtifactReturnAction,
  ArtifactReturnStatus,
  ArtifactRevision,
  ArtifactRevisionId,
  ArtifactView,
  ArtifactViewId,
  FileRecord,
  FileRecordId,
  Checkpoint,
  CheckpointId,
  Command,
  CommandId,
  ContextSnapshot,
  ContextSnapshotId,
  ContextManifestId,
  GraphVersion,
  HandoffArtifactRef,
  HandoffRecord,
  HandoffResumeMode,
  Note,
  Project,
  ProjectId,
  PreviewResult,
  PreviewRecord,
  PreviewKind,
  Run,
  RunEvent,
  RunId,
  RunResultPolicy,
  RuntimeBinding,
  RuntimeDispatch,
  Relation,
  RelationId,
  Scope,
  Workspace,
  WorkspaceId,
  WorkspaceContextPolicy,
  WorkspaceFrameBounds,
  WorkspaceViewport,
  WorkspaceMembership,
  WorkspaceMembershipSource,
} from '../../domain/src/index.js'
import type { ManifestResourceRefV0 } from './resources.js'
import type { ExplicitIntentV0 } from './attention-runtime.js'
import type { ContextPromptCachePlanV1 } from './context-prompt.js'
export type {
  AffinityReasonV0,
  ProjectAffinityCandidateV0,
  ProjectAffinityInputV0,
  ProjectAffinityResultV0,
} from './project-affinity.js'
export type {
  CaptureKindV0,
  CaptureGatewayResultV1,
  CaptureReceiptV0,
  CaptureRequestV1,
  CaptureRequestV0,
  CaptureStagingItemV0,
  CaptureWatchRuleV0,
  CaptureSpaceViewV1,
  CaptureSpaceRegionV1,
  CaptureSpacePresentationV1,
  CaptureSpaceSnapshotV1,
  CaptureSpaceOrganizeResultV1,
  CaptureMaterializeResultV1,
  CaptureSpacePayloadPreviewV1,
} from './capture.js'
export type { ReorganizePreviewV0, ReorganizeProposalV0 } from './reorganize.js'
export type { CompiledContextPromptV1, ContextCacheTelemetryV1, ContextPromptCachePlanV1 } from './context-prompt.js'
export { CONTEXT_PROMPT_SERIALIZER_V1 } from './context-prompt.js'
export type { MutationChangeItemV1, MutationChangeSetV1, MutationRelationSnapshotV1, CurationWriteConflictReasonV1, CurationWriteConflictV1, CurationTextUpdateOutcomeV1 } from './curation-patch.js'
export { buildCurationConflictHintV1 } from './curation-patch.js'
export type { SpaceListNodeV0, SpaceListResultV0, SpaceReadResultV0, SpaceSearchNodeV0, SpaceSearchResultV0 } from './space-vfs.js'
export type { ConversationIdentityChainV1, ActiveReceiverIdentityV1, ArtifactBirthProvenanceV1 } from './conversation-identity.js'
export type { SessionPhase, SessionTrackPhase, SessionLifecycleStateV1 } from './session-lifecycle.js'
export type { SpatialMarkerIntentV0, SpatialMarkerTargetRefV0, SpatialMarkerScopeV0, NavigationSurfaceKindV0, StableSurfaceRefV0, ResolvedNavigationTargetV0, NavigationResolutionReasonV0, NavigationResolutionV0 } from './navigation-marker.js'
export type { ColorPinDefinitionV0, ColorPinMembershipV0, ColorPinSnapshotV0 } from './color-pin.js'
export type { VoiceTranscriptionSegmentTransportV1, VoiceTranscriptionResponseV1 } from './voice-transcription.js'
export { SESSION_PHASE_TRANSITIONS, RUN_STATUS_TO_SESSION_PHASE, isSessionTransitionAllowed, markSessionStale, markSessionFresh } from './session-lifecycle.js'
export type { MutationRisk, PermissionScope, GateActorRole, OperationScope, ExecutionGateInput, GateDecision } from './execution-gate.js'
export { evaluateExecutionGate, OPERATION_RISK, riskOfOperation } from './execution-gate.js'
export type { ExecutionItemState, ExecutionItemAction, ExecutionItemTargetRef, ExecutionItemV1, ExecutionItemCapabilities } from './execution-item.js'
export { EXECUTION_ITEM_ACTION_STATES, deriveAvailableActions, executionItemNeedsAttention } from './execution-item.js'
export type { SkillPackageOriginV1, SkillPackageProvenanceV1, SkillPackageV1, CreateSkillPackageInputV1, UpdateSkillPackageInputV1, RenameSkillPackageInputV1, SkillPackageValidationV1 } from './skill-package.js'
export { isValidSkillPackageId, validateSkillPackageContent } from './skill-package.js'
export type { SkillSubskillRefV1, SkillCompositionV1, SkillCompositionValidationV1, SkillDependencyNodeV1 } from './skill-composition.js'
export { validateSkillComposition, resolveSkillDependencyOrder, SkillDependencyCycleError } from './skill-composition.js'
export type { SkillProposalStatusV1, SkillProposalSourceV1, SkillProposalDraftV1, SkillProposalV1, SkillProposalAcceptResultV1 } from './skill-proposal.js'
export { skillIdFromPrompt } from './skill-proposal.js'
export type { CompanionPendingReturnV1, CompanionReceiverV1, CompanionRuntimeStatusV1, CompanionProjectionV1 } from './companion-projection.js'
export { COMPANION_ACTION_ORDER, deriveCompanionAvailableActions } from './companion-projection.js'
export { AGENTLET_SCHEMA_V1 } from './agentlet.js'
export type { AgentletSummaryV1, AgentletRunV1, AgentletRunStatusV1 } from './agentlet.js'
export type { SurfaceSelectionV0 } from './selection.js'
export { normalizeSurfaceSelectionV0 } from './selection.js'
export type { DotGlyphCellLevelV0, DotGlyphCellV0, DotGlyphMotionPresetV0, DotGlyphV0 } from './visuals.js'
export { validateDotGlyphV0 } from './visuals.js'

// Re-add types that were removed from domain (keep contracts boundary stable)
export interface WorkspaceQuery {
  readonly projectId: ProjectId
  readonly workspaceId?: WorkspaceId
}
export interface WorkspaceViewportCommand {
  readonly workspaceId: WorkspaceId
  readonly viewport: WorkspaceViewport
}

// ==================== Core types ====================

export type ContractOrigin = 'fixture' | 'runtime'

export interface ContractError {
  readonly code:
    | 'NOT_FOUND'
    | 'CONFLICT'
    | 'STALE_GRAPH_VERSION'
    | 'INPUT_REQUIRED'
    | 'UNAVAILABLE'
    | 'STALE'
    | 'CANCELLED'
    | 'FIXTURE_ONLY'
    | 'VALIDATION'
    | 'INVALID_ARGUMENT'
    | 'PROJECT_ROOT_NOT_FOUND'
    | 'PROJECT_ROOT_NOT_DIRECTORY'
    | 'PROJECT_ROOT_NOT_READABLE'
    | 'PATH_OUTSIDE_ALLOWED_ROOT'
    | 'ACTIVE_CONTEXT_CONFLICT'
    | 'STALE_PRESENTATION_VERSION'
    | 'ABORTED'
    | 'INTERNAL'
  readonly message: string
  readonly retryable: boolean
  readonly origin: ContractOrigin
}

export type Result<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: ContractError }

export type ContractResult<Value> = Result<Value>

// ==================== Health & Metadata ====================

export interface HealthStatus {
  readonly status: 'ok'
  readonly service: 'local-core'
  readonly mode: 'read_only_phase_1a' | 'phase_2_lite' | 'phase_2_5'
  readonly version: string
}

// ==================== Project Graph Snapshot ====================

export interface ProjectGraphSnapshot {
  readonly schemaVersion: number
  readonly graphVersion: GraphVersion
  readonly project: Project
  readonly scopes: readonly Scope[]
  readonly workspaces: readonly Workspace[]
  readonly artifacts: readonly Artifact[]
  readonly artifactViews: readonly ArtifactView[]
  readonly relations: readonly Relation[]
  readonly notes: readonly Note[]
  readonly artifactRevisions: readonly ArtifactRevision[]
  readonly fileRecords: readonly FileRecord[]
  readonly checkpoints: readonly Checkpoint[]
}

// ==================== Context Manifest V0 ====================

export interface ContextManifestArtifactRefV0 {
  readonly artifactId: string
  readonly revisionId: string
  readonly title: string
  readonly kind: Artifact['kind']
  readonly mimeType: string
  readonly contentHash: string
  readonly availability: Artifact['availability']
}

export interface ContextManifestFeedbackV0 {
  readonly sourceArtifactId?: string
  readonly sourceNoteId?: string
  readonly title: string
  readonly body: string
  readonly state: 'open' | 'resolved' | 'ignored'
}

export interface ContextManifestOrderedItemV0 {
  readonly role: 'target' | 'feedback' | 'reference' | 'decision' | 'context'
  readonly identity: string
  readonly title: string
  readonly artifactId?: string
  readonly revisionId?: string
  readonly mimeType?: string
  /** Stable source locator for fragments, e.g. pdf:p3-p5. Never an absolute file path. */
  readonly sourceAnchor?: string
  /**
   * L1 扫描头（huabu node-ref 借鉴，20260826 任务三）：content 先折叠空白再截 120 字的
   * 单行切片。Agent 据此决定是否值得读 content 全文；与 content 独立存在。
   */
  readonly preview?: string
  readonly content?: string
  readonly contentHash?: string
}

export interface ContextManifestStableItemV1 {
  readonly artifactId: string
  /** A pinned Saved Context View freezes this revision; omitted means use Artifact Current. */
  readonly revisionId?: string
  /** Stable logical fragment locator. Physical paths are forbidden here. */
  readonly sourceAnchor?: string
}

export interface ContextManifestV0 {
  readonly id: ContextManifestId
  readonly schemaVersion: 0
  readonly createdAt: string
  readonly manifestHash: string
  readonly builderVersion: string
  readonly project: {
    readonly id: string
    readonly name: string
    readonly graphVersion: number
  }
  readonly target: ContextManifestArtifactRefV0 | null
  readonly currentRevision: ContextManifestArtifactRefV0 | null
  readonly feedback: readonly ContextManifestFeedbackV0[]
  readonly lockedElements: readonly string[]
  readonly references: readonly ContextManifestArtifactRefV0[]
  readonly requestedOutput: string
  readonly orderedItems: readonly ContextManifestOrderedItemV0[]
  readonly truncationMetadata: {
    readonly maxItemCharacters: number
    readonly truncatedItemIds: readonly string[]
  }
  /** Runtime-only cache plan. It partitions Saved Context baseline from ActiveContext/task tail. */
  readonly cachePlan?: ContextPromptCachePlanV1
  readonly resourceRefs?: readonly ManifestResourceRefV0[]
  readonly renderedManifestHash: string
  readonly renderedMarkdown: string
}

export interface BuildContextManifestV0Input {
  readonly targetArtifactId?: string
  readonly targetRevisionId?: string
  /** ActiveContext/current selection. This belongs to the dynamic tail. */
  readonly contextArtifactIds?: readonly string[]
  /** Saved Context membership in frozen user order. This belongs to the stable prefix. */
  readonly stableContextItems?: readonly ContextManifestStableItemV1[]
  readonly savedContextId?: string
  readonly promptRouteId?: string
  readonly promptSkillId?: string
  readonly promptSkillVersion?: string
  readonly capabilityProfileId?: string
  readonly requestedOutput?: string
  readonly resourceRefs?: readonly ManifestResourceRefV0[]
  /** B6 Continuity：run 创建时把 Attach Bundle 的冻结上下文合并进 Manifest。 */
  readonly extraItems?: readonly ContextManifestOrderedItemV0[]
}

export interface PersistedContextManifestV0 {
  readonly id: ContextManifestId
  readonly projectId: ProjectId
  readonly schemaVersion: 0
  readonly targetArtifactId?: ArtifactId
  readonly targetRevisionId?: ArtifactRevisionId
  readonly canonicalJson: string
  readonly manifestHash: string
  readonly createdAt: string
}

export interface RuntimePersistenceContract {
  createContextManifest(manifest: PersistedContextManifestV0): PersistedContextManifestV0
  getContextManifest(manifestId: ContextManifestId): PersistedContextManifestV0 | undefined
  createRunWithDispatch(run: Run, dispatch: RuntimeDispatch): void
  getRun(runId: RunId): Run | undefined
  getProjectRuns(projectId: ProjectId, limit?: number): readonly Run[]
  getRuntimeDispatch(runId: RunId): RuntimeDispatch | undefined
  updateRuntimeDispatch(dispatch: RuntimeDispatch): RuntimeDispatch
  createRuntimeBinding(binding: RuntimeBinding): RuntimeBinding
  getRuntimeBinding(runId: RunId): RuntimeBinding | undefined
  updateRuntimeBinding(binding: RuntimeBinding): RuntimeBinding
  updateRunStatus(runId: RunId, status: Run['status'], updatedAt: string): Run
  createRuntimeDraft(
    fileRecord: FileRecord,
    revision: ArtifactRevision,
    artifactReturn: ArtifactReturn,
  ): ArtifactReturn
  createArtifactReturn(value: ArtifactReturn): ArtifactReturn
  getArtifactReturn(returnId: ArtifactReturnId): ArtifactReturn | undefined
  getArtifactReturnByIdentity(
    runId: RunId,
    canonicalPath: string,
    contentHash: string,
    action: ArtifactReturn['action'],
  ): ArtifactReturn | undefined
  getArtifactReturns(runId: RunId): readonly ArtifactReturn[]
}

export interface RunReview {
  readonly run: Run
  readonly dispatch: RuntimeDispatch
  readonly binding?: RuntimeBinding
  readonly returns: readonly ArtifactReturn[]
  readonly draftRevisions: readonly ArtifactRevision[]
  readonly inputRequest?: RunInputRequestV1
  readonly presentationPhase: 'created' | 'queued' | 'running' | 'waiting_input' | 'review' | 'completed' | 'failed' | 'cancelled'
  readonly capabilities: {
    readonly schemaVersion: 1
    readonly accept: { readonly enabled: boolean; readonly reason?: string }
    readonly reject: { readonly enabled: boolean; readonly reason?: string }
    readonly retry: { readonly enabled: boolean; readonly reason?: string }
  }
}

export interface AcceptArtifactReturnInput {
  readonly expectedBaseRevisionId: ArtifactRevisionId
}

export interface AcceptArtifactReturnResult {
  readonly artifactReturn: ArtifactReturn
  readonly currentRevision: ArtifactRevision
  readonly previousRevision?: ArtifactRevision
  readonly run: Run
}

// ==================== Phase 0 Contracts: Composer Proposal / Membership / Provider ====================

export interface RunProposalContextItem {
  readonly artifactId: string
  readonly revisionId: string
  readonly order: number
}

export interface RunProposalEditTarget {
  readonly artifactId: string
  readonly baseRevisionId: string
}

export interface CreateRunProposal {
  readonly projectId: string
  readonly workspaceId?: string
  readonly prompt: string
  readonly intent: 'analyze' | 'create' | 'revise'
  readonly requestedProvider: string | 'auto'
  readonly contextItems: readonly RunProposalContextItem[]
  readonly editTargets: readonly RunProposalEditTarget[]
  readonly resultPolicy: RunResultPolicy
  /** F6 B6（P0-F）：Proposal 与 Run 同一 Unified Execution Contract——原样保留，不压回 artifact-only。 */
  readonly receiverRef?: import('./run-assembly.js').RunReceiverRefV1
  readonly orderedReferences?: readonly import('./run-assembly.js').OrderedRunReferenceV2[]
  readonly resultSlotId?: string
}

export interface RunProposalResult {
  readonly proposal: CreateRunProposal
  readonly summary: string
  readonly confidence: 'high' | 'low'
  readonly decisionSource?: 'agent' | 'fallback'
  readonly ambiguity?: { readonly question: string }
}

/** 用户界面只提交自然语言、上下文与两个真实决策；语义计划可由 Agent/Skill 覆盖。 */
export interface AgentPlanRequestV1 {
  readonly projectId: string
  readonly workspaceId?: string
  readonly prompt: string
  readonly requestedProvider: string | 'auto'
  readonly createAsNewNode: boolean
  readonly contextItems: readonly RunProposalContextItem[]
  readonly editTargets: readonly RunProposalEditTarget[]
}

export interface AgentExecutionPlanV1 extends CreateRunProposal {
  readonly schemaVersion: 1
  readonly humanSummary: string
  readonly risks: readonly string[]
  readonly requiresConfirmation: boolean
}

export type RuntimeProviderAvailability = 'ready' | 'busy' | 'offline' | 'manual'

export interface RuntimeProviderStatus {
  readonly provider: 'workbuddy' | 'codex' | 'auto'
  readonly availability: RuntimeProviderAvailability
  /** Only automatic providers are shown in the ordinary Composer. */
  readonly executionMode?: 'automatic' | 'manual'
  readonly contractVersion?: string
  readonly outputIntents?: readonly string[]
  readonly reason?: string
}

// ==================== Codex Native Loop (C0 frozen contracts) ====================

/** Agent 可读取的受控上下文项：只含摘要与引用，不泄露任意绝对路径。 */
export interface AgentContextItem {
  readonly viewId: string
  readonly artifactId: string
  readonly revisionId?: string
  readonly title: string
  readonly kind: string
  readonly managed?: boolean
  readonly previewRef?: string
}

export interface CanvasContextViewportV1 {
  readonly x: number
  readonly y: number
  readonly zoom: number
  readonly visibleViewIds: readonly string[]
}

export interface CanvasContextNodeV1 extends AgentContextItem {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly status?: string
  readonly summary?: string
}

export interface CanvasContextRelationV1 {
  readonly id: string
  readonly sourceArtifactId: string
  readonly targetArtifactId: string
  readonly kind: string
}

/** Compact structural summary for nodes outside the current viewport. */
export interface CanvasContextClusterV1 {
  readonly key: string
  readonly scopeId: string
  readonly kind: string
  readonly count: number
  readonly viewIds: readonly string[]
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}


/** Recent local navigation/context change, retained as a bounded projection rather than Project semantic truth. */
export interface CanvasContextRecentChangeV1 {
  readonly version: number
  readonly kind: 'selection' | 'context' | 'target' | 'viewport' | 'lock' | 'surface' | 'harness' | 'intent'
  readonly summary: string
  readonly viewIds?: readonly string[]
  readonly occurredAt: string
  readonly updatedBy: 'web' | 'codex' | 'core'
}

/** On-demand visual supplement derived from the structured Canvas snapshot. */
export interface CanvasObservationV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly workspaceId: string | null
  readonly contextVersion: number
  readonly screenshotRef: string
  readonly contentHash: string
  readonly mimeType: 'image/svg+xml'
  readonly encoding: 'base64'
  readonly data: string
  readonly width: number
  readonly height: number
  readonly generatedAt: string
}

export interface ActiveContextV2 {
  readonly schemaVersion: 2
  readonly projectId: string
  readonly workspaceId: string | null
  readonly scopeId: string | null
  readonly selectedViewIds: readonly string[]
  readonly selectionOrder?: readonly string[]
  readonly viewport?: CanvasContextViewportV1
  readonly nodes?: readonly CanvasContextNodeV1[]
  readonly relations?: readonly CanvasContextRelationV1[]
  readonly offscreenClusters?: readonly CanvasContextClusterV1[]
  readonly recentChanges?: readonly CanvasContextRecentChangeV1[]
  readonly targetArtifactId: string | null
  readonly targetRevisionId: string | null
  readonly pinnedContextIds: readonly string[]
  readonly excludedContextIds: readonly string[]
  /** B4 WorkState: preserve-only attention inputs; not Project Truth. */
  readonly lockedContextIds?: readonly string[]
  readonly currentSurface?: string
  readonly currentHarness?: string
  readonly explicitIntent?: ExplicitIntentV0
  readonly dismissedContinuityKeys?: readonly string[]
  readonly contextItems: readonly AgentContextItem[]
  readonly version: number
  readonly updatedAt: string
  readonly updatedBy: 'web' | 'codex' | 'core'
}

export type ContextChangeProposalStatus = 'pending' | 'accepted' | 'rejected' | 'stale'

export interface ContextChangeProposalV1 {
  readonly proposalId: string
  readonly projectId: string
  readonly workspaceId: string | null
  readonly baseContextVersion: number
  readonly addViewIds: readonly string[]
  readonly removeViewIds: readonly string[]
  readonly targetViewId?: string
  readonly reason: string
  readonly createdBy: 'codex'
  readonly status: ContextChangeProposalStatus
}


export type RunInputRequestStatus = 'pending' | 'answered' | 'cancelled'

export interface RunInputRequestV1 {
  readonly schemaVersion: 1
  readonly requestId: string
  readonly runId: string
  readonly question: string
  readonly options: readonly string[]
  readonly allowFreeText: boolean
  readonly contextVersion?: number
  readonly status: RunInputRequestStatus
  readonly answerText?: string
  readonly selectedOptions: readonly string[]
  readonly createdAt: string
  readonly answeredAt?: string
}

export interface AnswerRunInputRequestV1 {
  readonly requestId: string
  readonly text?: string
  readonly selectedOptions?: readonly string[]
}

export interface CommandDraftV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly workspaceId: string | null
  readonly composerAnchor: string
  readonly surfaceKind: 'main' | 'context' | 'workflow' | 'conversation'
  readonly surfaceId: string | null
  readonly prompt: string
  /** Ordered explicit Reference Set. Legacy field name retained for wire/storage compatibility. */
  readonly contextViewIds: readonly string[]
  readonly selectionViewIds: readonly string[]
  readonly receiverId: string | null
  readonly provider: string
  readonly createAsNewNode: boolean
  readonly intent: 'analyze' | 'create' | 'revise'
  readonly resultPolicy: 'reply_only' | 'create_artifact' | 'create_collection' | 'draft_revision_per_target'
  readonly updatedAt: string
}

export interface ProviderSessionBindingV1 {
  readonly projectId: string
  readonly provider: 'codex' | 'workbuddy'
  readonly externalSessionId: string
  readonly origin: 'manual' | 'watchdog'
  readonly status: 'active' | 'stale' | 'closed'
  readonly lastSeenAt: string
  readonly lastRunId?: string
  readonly leaseOwner?: string
  readonly leaseExpiresAt?: string
  readonly failureCount: number
  readonly updatedAt: string
}

/** Codex Provider Task Profile：Bridge Task 的 Codex 契约面，不内嵌项目真相。 */
export interface CodexTaskV1Profile {
  readonly provider: 'codex'
  readonly projectId: string
  readonly lcosRunId: string
  readonly contextManifestId: string
  readonly taskType: 'creative_run' | 'markdown_script_revision'
  readonly outputIntent: 'analyze' | 'create' | 'revise'
  readonly expectedOutputs: readonly { readonly absolutePath: string; readonly mode: 'create_new_file' }[]
  readonly targetArtifactId?: string
  readonly baseRevisionId?: string
  readonly idempotencyKey: string
}

export interface ProcessProjectionV1Item {
  readonly schemaVersion: 1
  readonly kind: 'run'
  readonly id: string
  readonly runId: string
  readonly title: string
  readonly summary: string
  readonly status: Run['status']
  readonly provider: Run['provider']
  readonly contextViewIds: readonly string[]
  readonly targetViewIds: readonly string[]
  readonly outputViewIds: readonly string[]
  readonly createdAt: string
}

export type {
  WorkspaceMembership,
  WorkspaceMembershipSource,
  RunResultPolicy,
}

export interface RejectArtifactReturnResult {
  readonly artifactReturn: ArtifactReturn
  readonly draftRevision: ArtifactRevision
  readonly run: Run
}

export interface RetryRunInput {
  readonly instruction?: string
}

export interface RetryRunResult {
  readonly previousRun: Run
  readonly previousReturn: ArtifactReturn
  readonly run: Run
  readonly dispatch: RuntimeDispatch
}

// ==================== Mutation ====================

export type MutationOperation =
  | { readonly type: 'bootstrap'; readonly snapshot: ProjectGraphSnapshot }
  | { readonly type: 'move_artifact_view'; readonly viewId: ArtifactViewId; readonly x: number; readonly y: number }
  | { readonly type: 'resize_artifact_view'; readonly viewId: ArtifactViewId; readonly width: number; readonly height: number }
  | { readonly type: 'update_workspace_viewport'; readonly workspaceId: WorkspaceId; readonly viewport: WorkspaceViewport }
  | {
      readonly type: 'update_workspace_frame'
      readonly workspaceId: WorkspaceId
      readonly frameBounds?: WorkspaceFrameBounds
      readonly preferredSurface?: string
      readonly expectedVersion?: number
    }
  | {
      readonly type: 'update_workspace_presentation'
      readonly workspaceId: WorkspaceId
      readonly focusedViewIds: readonly ArtifactViewId[]
      readonly visibleLayers: Workspace['visibleLayers']
    }
  | {
      readonly type: 'update_artifact_view_presentation'
      readonly viewId: ArtifactViewId
      readonly collapsed: ArtifactView['collapsed']
      readonly displayMode: ArtifactView['displayMode']
    }
  | { readonly type: 'upsert_workspace'; readonly workspace: Workspace }
  | { readonly type: 'delete_workspace'; readonly workspaceId: WorkspaceId }
  | { readonly type: 'reorder_workspaces'; readonly workspaceIds: readonly WorkspaceId[] }
  | { readonly type: 'upsert_scope'; readonly scope: Scope }
  | { readonly type: 'upsert_artifact'; readonly artifact: Artifact }
  | { readonly type: 'upsert_artifact_view'; readonly view: ArtifactView }
  | { readonly type: 'delete_artifact_view'; readonly viewId: ArtifactViewId }
  | { readonly type: 'upsert_relation'; readonly relation: Relation }
  | { readonly type: 'delete_relation'; readonly relationId: RelationId }
  | { readonly type: 'upsert_note'; readonly note: Note }

export interface MutationBatch {
  readonly baseVersion: GraphVersion
  readonly ops: readonly MutationOperation[]
  /** B3R5 containment guard applies stricter one-level creation to Agent writes. */
  readonly actorKind?: 'user' | 'agent' | 'import' | 'migration'
}

export interface MutationResult {
  readonly graphVersion: GraphVersion
  readonly appliedOps: number
}

// ==================== Trusted source registration ====================

export type TrustedFileSelectionId = string & { readonly __brand: 'TrustedFileSelectionId' }

export interface TrustedFileSelection {
  readonly id: TrustedFileSelectionId
  readonly displayName: string
}

export interface RegisterTrustedSourceInput {
  readonly selectionId: TrustedFileSelectionId
  readonly title?: string
}

export interface RegisterTrustedSourceResult {
  readonly fileRecord: FileRecord
  readonly artifact: Artifact
  readonly revision: ArtifactRevision
}

export interface FileRecordRepository {
  get(fileRecordId: FileRecordId): Promise<Result<FileRecord>>
}

// ==================== Legacy Save (deprecated, kept for bootstrap/import) ====================

export interface SaveProjectGraphInput {
  readonly snapshot: ProjectGraphSnapshot
}

// ==================== Metadata ====================

export interface MetadataStoreStatus {
  readonly schemaVersion: number
  readonly databasePath: string
  readonly metadataOnly: true
}

export interface ValidateProjectRootInput {
  readonly rootPath: string
}

export interface ValidatedProjectRoot {
  readonly normalizedPath: string
  readonly exists: true
  readonly isDirectory: true
  readonly readable: true
}

// ==================== Catalog ====================

export interface ProjectCatalogEntry {
  readonly id: string
  readonly name: string
  readonly rootPath: string
  readonly graphVersion: GraphVersion
  readonly lastOpenedAt?: string
}

export interface AbortSignal {
  readonly aborted: boolean
}

// ==================== Contracts ====================

export interface ProjectCatalog {
  list(signal?: AbortSignal): Promise<Result<readonly ProjectCatalogEntry[]>>
}

export interface WorkspaceQueryContract {
  getWorkspaces(query: WorkspaceQuery): Promise<Result<readonly Workspace[]>>
  updateViewport(command: WorkspaceViewportCommand): Promise<Result<Workspace>>
}

export interface PreviewContract {
  getPreview(artifactId: ArtifactId, kind: PreviewKind, pageIndex?: number): Promise<Result<PreviewResult>>
}

export interface ProjectContract {
  getProject(projectId: ProjectId): Promise<ContractResult<Project>>
  getWorkspace(workspaceId: WorkspaceId): Promise<ContractResult<Workspace>>
  saveWorkspace(workspace: Workspace): Promise<ContractResult<Workspace>>
  createCheckpoint(checkpoint: Checkpoint): Promise<ContractResult<Checkpoint>>
  getCheckpoint(checkpointId: CheckpointId): Promise<ContractResult<Checkpoint>>
}

export interface ArtifactContract {
  getArtifact(artifactId: ArtifactId): Promise<ContractResult<Artifact>>
  getArtifactView(viewId: ArtifactViewId): Promise<ContractResult<ArtifactView>>
  createView(view: ArtifactView): Promise<ContractResult<ArtifactView>>
  getRevision(revisionId: ArtifactRevisionId): Promise<ContractResult<ArtifactRevision>>
  acceptReturn(returnId: ArtifactReturnId, input: AcceptArtifactReturnInput): Promise<ContractResult<AcceptArtifactReturnResult>>
  rejectReturn(returnId: ArtifactReturnId): Promise<ContractResult<RejectArtifactReturnResult>>
}

export interface ContextContract {
  createSnapshot(command: Command): Promise<ContractResult<ContextSnapshot>>
  getSnapshot(snapshotId: ContextSnapshotId): Promise<ContractResult<ContextSnapshot>>
}

export interface ExecutionRuntimeContract {
  createRun(commandId: CommandId, contextSnapshotId: ContextSnapshotId): Promise<ContractResult<Run>>
  getRun(runId: RunId): Promise<ContractResult<Run>>
  continueRun(runId: RunId, input: string): Promise<ContractResult<Run>>
  cancelRun(runId: RunId): Promise<ContractResult<Run>>
  retryRun(runId: RunId): Promise<ContractResult<Run>>
  getEvents(runId: RunId, afterSequence?: number): Promise<ContractResult<readonly RunEvent[]>>
  getReturns(runId: RunId): Promise<ContractResult<readonly ArtifactReturn[]>>
}

export interface RuntimeReviewContract {
  getRunReview(runId: RunId): Promise<ContractResult<RunReview>>
  acceptReturn(returnId: ArtifactReturnId, input: AcceptArtifactReturnInput): Promise<ContractResult<AcceptArtifactReturnResult>>
  rejectReturn(returnId: ArtifactReturnId): Promise<ContractResult<RejectArtifactReturnResult>>
  retryReturn(returnId: ArtifactReturnId, input?: RetryRunInput): Promise<ContractResult<RetryRunResult>>
}

// Re-exports
export type {
  Artifact,
  ArtifactRevision,
  ArtifactReturnStatus,
  ArtifactReturnAction,
  ArtifactView,
  Checkpoint,
  FileRecord,
  GraphVersion,
  HandoffArtifactRef,
  HandoffRecord,
  HandoffResumeMode,
  Note,
  PreviewRecord,
  Project,
  Relation,
  RunEvent,
  RuntimeBinding,
  RuntimeDispatch,
  Scope,
  Workspace,
  WorkspaceContextPolicy,
}

// B5 ContextSnapshot boundary types (local-core ContextSnapshotService ↔ web client)
export interface ContextSnapshotRefsV1 {
  readonly schemaVersion: 1
  readonly savedAt: string
  readonly workspaceId: string | null
  readonly scopeId: string | null
  readonly focusedViewIds: readonly string[]
  readonly artifactIds: readonly string[]
  readonly relationIds: readonly string[]
  readonly noteIds: readonly string[]
  readonly runIds: readonly string[]
}

export interface SnapshotCompareResultV1 {
  readonly base: string
  readonly other: string
  readonly added: ContextSnapshotRefsV1
  readonly removed: ContextSnapshotRefsV1
  readonly kept: ContextSnapshotRefsV1
}

export interface BranchSnapshotResultV1 {
  readonly scopeId: string
  readonly viewIds: readonly string[]
}

// Universal Resource Import (U0)
export type {
  ImportResourceRequestV1,
  ImportResourceResultV1,
  ManifestResourceRefV0,
  ResourceDescriptorId,
  ResourceDescriptorV0,
  ResourceId,
  ResourceImportSourceKind,
  ResourceMatchQueryV0,
  ResourceMatchV0,
  ResourcePlacementV0,
  ResourceSourceV0,
  ResourceUnderstandingStatus,
} from './resources.js'
export type { DerivedWriteGuardV0, DerivedWriteStatusV0 } from './derived-write.js'

export type {
  ImportObsidianNotesV1,
  ObsidianNoteSummaryV1,
  ObsidianVaultScanV1,
  ResourceConnectorAccessV1,
  ResourceConnectorCapabilityV1,
} from './connectors.js'

export * from './conversations.js'
export * from './resources.js'
export * from './connectors.js'
export * from './presentations.js'
export * from './project-events.js'
export * from './curation.js'
export * from './search.js'
export * from './assembly.js'
export * from './run-assembly.js'
export * from './project-profile.js'
export * from './curation-patch.js'
export * from './curator-dispatch.js'
export * from './skill-author-dispatch.js'
export * from './extension-manifest.js'
export * from './remote-command.js'

// 本地 OCR（RapidOCR）
export interface OcrLineV1 {
  readonly text: string
  readonly score: number | null
  readonly box: readonly (readonly number[])[] | null
}

export interface OcrResultV1 {
  readonly text: string
  readonly lines: readonly OcrLineV1[]
  readonly durationMs: number
  readonly engine: 'rapidocr'
}

// 项目视图栏混合顺序（Project-navigation 契约，非业务本体）
/**
 * Project-navigation projection kind. `scene` is backed by Workspace state;
 * keeping it distinct from Collection prevents the Rail from teaching the
 * wrong product ontology while still avoiding a second business entity.
 */
export type ProjectViewRailKindV0 = 'scene' | 'collection' | 'context' | 'workflow'

export interface ProjectViewRailRefV0 {
  readonly kind: ProjectViewRailKindV0
  readonly viewId: string
}

export interface ProjectViewRailOrderV0 {
  readonly projectId: string
  readonly orderedRefs: readonly ProjectViewRailRefV0[]
  readonly version: number
  readonly updatedAt: string
}
export * from './attention-runtime.js'

export * from './intelligence-provider.js'

export * from './revision-workflow.js'

export * from './continuity.js'

export * from './receiver.js'

export * from './boundary-evaluator.js'