/**
 * Phase 2.5 Data Spine Cleanup — Domain Rewrite
 *
 * Key changes:
 * - Scope is now a formal domain entity (was implicit/absent)
 * - Relation references entities, not ArtifactViews
 * - Workspace has scopeId + contextPolicy (formalized)
 * - ArtifactView belongs to Scope, not Workspace
 * - Project has graphVersion for optimistic concurrency
 * - Checkpoint is immutable snapshot only (no junction tables)
 */

export type Brand<Value, Name extends string> = Value & { readonly __brand: Name }

export type ProjectId = Brand<string, 'ProjectId'>
export type WorkspaceId = Brand<string, 'WorkspaceId'>
export type ScopeId = Brand<string, 'ScopeId'>
export type ArtifactId = Brand<string, 'ArtifactId'>
export type ArtifactViewId = Brand<string, 'ArtifactViewId'>
export type RelationId = Brand<string, 'RelationId'>
export type ArtifactRevisionId = Brand<string, 'ArtifactRevisionId'>
export type FileRecordId = Brand<string, 'FileRecordId'>
export type NoteId = Brand<string, 'NoteId'>
export type ContextSnapshotId = Brand<string, 'ContextSnapshotId'>
export type CommandId = Brand<string, 'CommandId'>
export type ConversationId = Brand<string, 'ConversationId'>
export type RunId = Brand<string, 'RunId'>
export type RunEventId = Brand<string, 'RunEventId'>
export type ArtifactReturnId = Brand<string, 'ArtifactReturnId'>
export type ContextManifestId = Brand<string, 'ContextManifestId'>
export type RuntimeDispatchId = Brand<string, 'RuntimeDispatchId'>
export type RuntimeBindingId = Brand<string, 'RuntimeBindingId'>
export type CheckpointId = Brand<string, 'CheckpointId'>
export type PreviewRecordId = Brand<string, 'PreviewRecordId'>
export type ContentHash = Brand<string, 'ContentHash'>

export type IsoDateTime = string
export type GraphVersion = Brand<number, 'GraphVersion'>

export type JsonPrimitive = boolean | number | string | null
export type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue }

// ==================== Project ====================

export interface Project {
  readonly id: ProjectId
  readonly name: string
  readonly rootPath: string
  readonly graphVersion: GraphVersion
  readonly lastOpenedAt?: IsoDateTime
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

// ==================== Scope ====================

export type ScopeKind = 'root' | 'collection' | 'context' | 'workflow' | 'delivery' | 'temporary-workbench'

export interface Scope {
  readonly id: ScopeId
  readonly projectId: ProjectId
  readonly parentScopeId: ScopeId | null
  readonly containerViewId: ArtifactViewId | null
  readonly kind: ScopeKind
  readonly name: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

// B3R5: only Collection containment contributes structural depth. Context,
// Workflow and Scene membership are references/presentation, never ownership.
export const MAX_STRUCTURAL_CONTAINER_DEPTH = 2
export const MAX_INLINE_EXPANSION_DEPTH = 1
export const DEFAULT_GRAPH_HOPS = 1
export const MAX_GRAPH_HOPS = 2
export const DEFAULT_RETRIEVED_ENTITY_BUDGET = 24
export const MAX_AI_NEW_CONTAINER_DEPTH_PER_ACTION = 1

export type ContainmentWriteActor = 'user' | 'agent' | 'import' | 'migration'

export interface ContainmentValidationIssue {
  readonly code: 'STRUCTURAL_CYCLE' | 'STRUCTURAL_DEPTH_EXCEEDED' | 'CROSS_TYPE_CONTAINMENT' | 'AI_CONTAINER_DEPTH_EXCEEDED'
  readonly scopeId: string
  readonly legacy: boolean
}

/**
 * Shared Core/GUI/CLI/MCP guard. Existing invalid legacy links remain readable,
 * but any new or changed structural link must satisfy the frozen B3R5 rules.
 */
export function validateContainmentWrite(input: {
  readonly previousScopes?: readonly Scope[]
  readonly nextScopes: readonly Scope[]
  readonly actor?: ContainmentWriteActor
}): { readonly ok: boolean; readonly issues: readonly ContainmentValidationIssue[]; readonly legacyOverDepthScopeIds: readonly string[] } {
  const previous = new Map((input.previousScopes ?? []).map((scope) => [String(scope.id), scope]))
  const next = new Map(input.nextScopes.map((scope) => [String(scope.id), scope]))
  const issues: ContainmentValidationIssue[] = []
  const legacyOverDepth = new Set<string>()
  const structuralChanged = (scope: Scope) => {
    const before = previous.get(String(scope.id))
    return !before || String(before.parentScopeId ?? '') !== String(scope.parentScopeId ?? '') || before.kind !== scope.kind
  }
  const addIssue = (scope: Scope, code: ContainmentValidationIssue['code']) => {
    const legacy = !structuralChanged(scope)
    issues.push({ code, scopeId: String(scope.id), legacy })
    if (legacy && code === 'STRUCTURAL_DEPTH_EXCEEDED') legacyOverDepth.add(String(scope.id))
  }

  for (const scope of input.nextScopes) {
    if (scope.kind === 'root') continue
    const parent = scope.parentScopeId ? next.get(String(scope.parentScopeId)) : undefined
    if (!parent) continue
    if (parent.kind !== 'root' && (parent.kind !== 'collection' || scope.kind !== 'collection')) addIssue(scope, 'CROSS_TYPE_CONTAINMENT')

    let depth = 0
    let cursor: Scope | undefined = scope
    const visited = new Set<string>()
    while (cursor && cursor.kind !== 'root') {
      const id = String(cursor.id)
      if (visited.has(id)) { addIssue(scope, 'STRUCTURAL_CYCLE'); break }
      visited.add(id)
      if (cursor.kind === 'collection') depth += 1
      cursor = cursor.parentScopeId ? next.get(String(cursor.parentScopeId)) : undefined
    }
    if (depth > MAX_STRUCTURAL_CONTAINER_DEPTH) addIssue(scope, 'STRUCTURAL_DEPTH_EXCEEDED')
  }

  if (input.actor === 'agent') {
    const created = new Set(input.nextScopes.filter((scope) => !previous.has(String(scope.id))).map((scope) => String(scope.id)))
    for (const scope of input.nextScopes) {
      if (!created.has(String(scope.id)) || scope.kind !== 'collection') continue
      const parent = scope.parentScopeId ? next.get(String(scope.parentScopeId)) : undefined
      if (parent?.kind === 'collection' && created.has(String(parent.id))) addIssue(scope, 'AI_CONTAINER_DEPTH_EXCEEDED')
    }
  }

  return { ok: issues.every((issue) => issue.legacy), issues, legacyOverDepthScopeIds: [...legacyOverDepth] }
}

export function assertContainmentWrite(input: Parameters<typeof validateContainmentWrite>[0]): void {
  const result = validateContainmentWrite(input)
  const rejected = result.issues.filter((issue) => !issue.legacy)
  if (!rejected.length) return
  const error = new Error(`CONTAINMENT_WRITE_REJECTED: ${rejected.map((issue) => `${issue.code}:${issue.scopeId}`).join(', ')}`) as Error & { code?: string; issues?: readonly ContainmentValidationIssue[] }
  error.code = 'CONTAINMENT_WRITE_REJECTED'
  error.issues = rejected
  throw error
}

// ==================== Workspace ====================

export type WorkspaceIntent = 'understand' | 'explore' | 'build' | 'decide' | null

export interface WorkspaceViewport {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

/** 独立于成员节点推导的空间框（B1：Frame 拖拽/缩放后持久化恢复）。 */
export interface WorkspaceFrameBounds {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type WorkspaceContextPolicy = 'workspace-related' | 'selection-only'

export interface Workspace {
  readonly id: WorkspaceId
  readonly projectId: ProjectId
  readonly scopeId: ScopeId
  readonly name: string
  readonly intent: WorkspaceIntent
  readonly viewport: WorkspaceViewport
  readonly focusedViewIds: readonly ArtifactViewId[]
  readonly visibleLayers: readonly string[]
  readonly contextPolicy: WorkspaceContextPolicy
  readonly frameBounds?: WorkspaceFrameBounds
  readonly preferredSurface?: string
  readonly version?: number
  readonly updatedAt: IsoDateTime
}

export type WorkspaceMembershipSource = 'user' | 'agent' | 'run' | 'import'
/** 裁决 1（20260828）：Scene working-set 的 entity 成员类型（无 view 的可投影 Project Entity）。 */
export type WorkspaceEntityMemberType = 'note' | 'scope' | 'workspace' | 'conversation'

export interface WorkspaceEntityMembership {
  readonly workspaceId: WorkspaceId
  readonly entityType: WorkspaceEntityMemberType
  readonly entityId: string
  readonly addedAt: IsoDateTime
  readonly addedBy: WorkspaceMembershipSource
}

export interface WorkspaceMembership {
  readonly workspaceId: WorkspaceId
  readonly artifactViewId: ArtifactViewId
  readonly addedAt: IsoDateTime
  readonly addedBy: WorkspaceMembershipSource
  readonly sortOrder?: number
}

// ==================== Artifact ====================

export type ArtifactKind = 'markdown' | 'image' | 'presentation' | 'pdf' | 'other'
export type ArtifactAvailability = 'available' | 'missing' | 'stale'

export interface Artifact {
  readonly id: ArtifactId
  readonly projectId: ProjectId
  readonly title: string
  readonly kind: ArtifactKind
  /** 受管 Artifact 可作 revise Target；外部 Reference/Link 为 false。 */
  readonly managed?: boolean
  readonly availability: ArtifactAvailability
  readonly currentRevisionId?: ArtifactRevisionId
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

// ==================== ArtifactView ====================

// ArtifactView belongs to Scope, not Workspace.
// A single Artifact can have multiple Views across different Scopes.

export type ArtifactViewReferenceKind = 'primary' | 'explicit_additional'

export interface ArtifactView {
  readonly id: ArtifactViewId
  readonly artifactId: ArtifactId
  readonly scopeId: ScopeId
  readonly revisionId?: ArtifactRevisionId
  readonly referenceKind: ArtifactViewReferenceKind
  readonly position: { readonly x: number; readonly y: number }
  readonly size: { readonly width: number; readonly height: number }
  readonly displayMode: 'card' | 'thumbnail' | 'compact'
  readonly collapsed: boolean
}

// ==================== Relation ====================

// Relation connects Domain Entities, not Views.
// Deleting a view does NOT delete the business relationship.

// Relation connects Domain Entities or View/Workspace endpoints.
// View/Workspace endpoints express aggregate relations (e.g. [Feedback] -> Workspace -> [Deliverable Collection])
// and do NOT imply a relation for every member node; the Context Compiler expands them per Workspace Context Policy.
export type RelationEntityType = 'artifact' | 'note' | 'scope' | 'view' | 'workspace'

export interface Relation {
  readonly id: RelationId
  readonly projectId: ProjectId
  readonly sourceEntityType: RelationEntityType
  readonly sourceEntityId: string
  readonly targetEntityType: RelationEntityType
  readonly targetEntityId: string
  readonly kind: string
  /** Phase E: provenance — user / agent / system. */
  readonly origin?: 'user' | 'agent' | 'system'
  readonly createdBy?: string
  readonly evidenceRefs?: readonly { readonly kind: 'artifact' | 'resource' | 'conversation' | 'file'; readonly id: string; readonly label?: string; readonly revisionId?: string; readonly sourceAnchor?: string }[]
  readonly confidence?: number
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

// ==================== ArtifactRevision ====================

export type ArtifactRevisionSource = 'import' | 'run' | 'external'
export type ArtifactRevisionStatus = 'draft' | 'current' | 'superseded'

export interface ArtifactRevision {
  readonly id: ArtifactRevisionId
  readonly artifactId: ArtifactId
  readonly fileRecordId: FileRecordId
  readonly parentRevisionId?: ArtifactRevisionId
  readonly contentHash: ContentHash
  readonly source: ArtifactRevisionSource
  readonly runId?: RunId
  readonly status: ArtifactRevisionStatus
  readonly createdAt: IsoDateTime
}

// ==================== FileRecord ====================

export type FileAvailability = 'current' | 'stale' | 'missing' | 'unreadable'

export interface FileRecord {
  readonly id: FileRecordId
  readonly projectId: ProjectId
  readonly observedPath: string
  readonly observedHash: ContentHash
  readonly size: number
  readonly modifiedAt: IsoDateTime
  readonly mimeType: string
  readonly availability: FileAvailability
  readonly observedAt: IsoDateTime
}

// ==================== Note ====================

export type NoteAnchor =
  | { readonly type: 'project' }
  | { readonly type: 'scope'; readonly scopeId: ScopeId }
  | { readonly type: 'artifact'; readonly artifactId: ArtifactId }
  | { readonly type: 'artifact_view'; readonly viewId: ArtifactViewId }
  | { readonly type: 'page'; readonly revisionId: ArtifactRevisionId; readonly pageIndex: number }

export interface Note {
  readonly id: NoteId
  readonly projectId: ProjectId
  readonly anchor: NoteAnchor
  readonly body: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

// ==================== Checkpoint ====================

// Checkpoint is an immutable historical snapshot.
// It does NOT participate in autosave — the camera lives in Workspace.viewport.

export interface Checkpoint {
  readonly id: CheckpointId
  readonly projectId: ProjectId
  readonly scopeId: ScopeId
  readonly workspaceId?: WorkspaceId
  readonly label: string
  readonly snapshotJson: JsonValue
  readonly createdAt: IsoDateTime
}

export interface SessionSummary {
  readonly id: string
  readonly projectId: ProjectId
  readonly title: string
  readonly summary: string
  readonly runIds: readonly RunId[]
  readonly handoffRef?: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

// ==================== Handoff ====================

export type HandoffResumeMode = 'native-resume' | 'standard-handoff' | 'session-shadow'

export interface HandoffArtifactRef {
  readonly artifactId: ArtifactId
  readonly revisionId?: ArtifactRevisionId
}

/** Provider-neutral Handoff 记录（B6）：跨 Agent 可读的交接语义，不冒充 Native Resume。 */
export interface HandoffRecord {
  readonly id: string
  readonly projectId: ProjectId
  readonly title: string
  readonly resumeMode: HandoffResumeMode
  readonly fromProvider?: string
  readonly toProvider?: string
  readonly sessionSummaryId?: string
  readonly contextSnapshotId?: string
  readonly decisions: readonly string[]
  readonly openQuestions: readonly string[]
  readonly nextActions: readonly string[]
  readonly artifactRefs: readonly HandoffArtifactRef[]
  readonly messageRefs: readonly string[]
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

// ==================== Preview (unchanged) ====================

export type PreviewState = 'idle' | 'loading' | 'ready' | 'error'
export type PreviewKind = 'thumbnail' | 'page' | 'original'
export type PreviewRecordStatus = 'ready' | 'failed' | 'unsupported'

export interface PreviewResult {
  readonly artifactId: ArtifactId
  readonly state: PreviewState
  readonly kind: PreviewKind
  readonly origin: 'fixture' | 'runtime'
  readonly contentUrl?: string
  readonly pageIndex?: number
  readonly pageCount?: number
  readonly errorMessage?: string
}

export interface PreviewRecord {
  readonly id: PreviewRecordId
  readonly projectId: ProjectId
  readonly revisionId: ArtifactRevisionId
  readonly sourceContentHash: ContentHash
  readonly rendererId: string
  readonly rendererVersion: string
  readonly previewProfile: string
  readonly cacheKey: string
  readonly cachePath: string
  readonly mimeType: string
  readonly size: number
  readonly status: PreviewRecordStatus
  readonly errorMessage?: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

// ==================== Run (preserved, Phase 5) ====================

export interface ContextSourceRef {
  readonly artifactId?: ArtifactId
  readonly revisionId?: ArtifactRevisionId
  readonly noteId?: NoteId
  readonly label: string
}

export interface ContextSnapshot {
  readonly id: ContextSnapshotId
  readonly projectId: ProjectId
  readonly commandId: CommandId
  readonly sourceRefs: readonly ContextSourceRef[]
  readonly contentHash: ContentHash
  readonly createdAt: IsoDateTime
}

export type CommandOutputMode = 'modify_in_place' | 'new_revision' | 'new_artifact' | 'note'

export interface Command {
  readonly id: CommandId
  readonly projectId: ProjectId
  readonly workspaceId: WorkspaceId
  readonly instruction: string
  readonly selectedObjectIds: readonly string[]
  readonly targetArtifactId?: ArtifactId
  readonly workingArtifactId?: ArtifactId
  readonly contextSnapshotId?: ContextSnapshotId
  readonly outputMode: CommandOutputMode
  readonly createdAt: IsoDateTime
}

export interface Conversation {
  readonly id: ConversationId
  readonly projectId: ProjectId
  readonly createdAt: IsoDateTime
}

export const LCOS_RUN_STATUSES = [
  'created',
  'queued',
  'running',
  'waiting_input',
  'completed',
  'failed',
  'cancelled',
] as const
export type RunStatus = typeof LCOS_RUN_STATUSES[number]
export type RuntimeProvider = 'workbuddy' | 'codex'
export type RunOutputIntent = 'create' | 'revise' | 'analyze'

export interface Run {
  readonly id: RunId
  readonly projectId: ProjectId
  readonly workspaceId?: WorkspaceId
  readonly targetArtifactId?: ArtifactId
  readonly targetRevisionId?: ArtifactRevisionId
  readonly contextManifestId: ContextManifestId
  readonly retryOfRunId?: RunId
  readonly provider: RuntimeProvider
  readonly requestedProvider: RuntimeProvider
  readonly outputIntent: RunOutputIntent
  readonly returnGroupId: string
  readonly resultPolicy?: RunResultPolicy
  readonly status: RunStatus
  readonly instruction: string
  readonly resultSummary?: string
  readonly shortSummary?: string
  readonly errorCode?: string
  readonly errorMessage?: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
  readonly completedAt?: IsoDateTime
}

export type RunResultPolicy =
  | { readonly type: 'reply_only' }
  | { readonly type: 'create_artifact'; readonly format?: string }
  | { readonly type: 'create_collection' }
  | { readonly type: 'draft_revision_per_target' }

export const RUNTIME_DISPATCH_STATUSES = [
  'planned',
  'dispatching',
  'bound',
  'failed',
  'recovery_required',
] as const
export type RuntimeDispatchStatus = typeof RUNTIME_DISPATCH_STATUSES[number]

export interface RuntimeDispatch {
  readonly id: RuntimeDispatchId
  readonly runId: RunId
  readonly provider: RuntimeProvider
  readonly idempotencyKey: string
  readonly status: RuntimeDispatchStatus
  readonly attemptCount: number
  readonly lastErrorCode?: string
  readonly lastErrorMessage?: string
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export interface RuntimeBinding {
  readonly id: RuntimeBindingId
  readonly runId: RunId
  readonly provider: RuntimeProvider
  readonly externalTaskId?: string
  readonly externalSessionId?: string
  readonly providerStatus?: string
  readonly lastSyncedAt?: IsoDateTime
  readonly finalizePending: boolean
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export type RunEventType =
  | 'run.queued'
  | 'run.started'
  | 'run.waiting_input'
  | 'run.input_resolved'
  | 'run.review_ready'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancel_requested'
  | 'run.cancelled'
  | 'run.retry_queued'

export interface RunEvent {
  readonly id: RunEventId
  readonly runId: RunId
  readonly sequence: number
  readonly type: RunEventType
  readonly occurredAt: IsoDateTime
  readonly payload: JsonValue
}

export interface ChangedFile {
  readonly runId: RunId
  readonly action: 'created' | 'modified' | 'deleted' | 'moved'
  readonly projectRelativePath: string
  readonly beforeHash?: ContentHash
  readonly afterHash?: ContentHash
}

export const ARTIFACT_RETURN_STATUSES = [
  'pending_review',
  'adopted',
  'rejected',
] as const
export type ArtifactReturnStatus = typeof ARTIFACT_RETURN_STATUSES[number]
export type ArtifactReturnAction = 'created'

export interface ArtifactReturn {
  readonly id: ArtifactReturnId
  readonly runId: RunId
  readonly targetArtifactId: ArtifactId
  readonly baseRevisionId: ArtifactRevisionId
  readonly returnedFileId: FileRecordId
  readonly contentHash: ContentHash
  readonly canonicalPath: string
  readonly action: ArtifactReturnAction
  readonly status: ArtifactReturnStatus
  readonly draftRevisionId?: ArtifactRevisionId
  readonly createdAt: IsoDateTime
  readonly updatedAt: IsoDateTime
}

export type ArtifactReturnPlacement =
  | { readonly zone: 'target'; readonly artifactId: ArtifactId }
  | { readonly zone: 'working'; readonly artifactId: ArtifactId }
  | { readonly zone: 'run'; readonly runId: RunId }
  | { readonly zone: 'pending_return'; readonly workspaceId: WorkspaceId }

export function resolveArtifactReturnPlacement(command: Command, run?: Run): ArtifactReturnPlacement {
  if (command.targetArtifactId) return { zone: 'target', artifactId: command.targetArtifactId }
  if (command.workingArtifactId) return { zone: 'working', artifactId: command.workingArtifactId }
  if (run) return { zone: 'run', runId: run.id }
  return { zone: 'pending_return', workspaceId: command.workspaceId }
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}
