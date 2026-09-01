import type { AttentionRuntimeSnapshotV0, ContextPackV0, IntentCandidateV0, SkillTargetProposalV0 } from './attention-runtime.js'
import type { ProjectAffinityInputV0, ProjectAffinityResultV0 } from './project-affinity.js'

export type ContinuityResolveRequestV1 = ProjectAffinityInputV0
export type ContinuityResolveResultV1 = ProjectAffinityResultV0

export interface ContinuitySessionContextV1 {
  readonly sessionId: string
  readonly projectId: string
  readonly selectedViewIds: readonly string[]
  readonly retrievalEntityRefs: readonly string[]
  readonly sourceRefs: readonly { readonly sourceType: string; readonly sourceRef: string; readonly observedAt: string }[]
  readonly status: string
  readonly updatedAt: string
}

export interface ContinuityProviderSessionV1 {
  readonly provider: 'codex' | 'workbuddy'
  readonly externalSessionId: string
  readonly status: 'active' | 'stale' | 'closed'
  readonly lastSeenAt: string
  readonly lastRunId?: string
}

export interface ContinuityResumeSnapshotV1 {
  readonly schemaVersion: 1
  readonly project: { readonly id: string; readonly name: string; readonly rootPath: string }
  readonly workspaceId: string | null
  readonly workspaceCandidates: readonly { readonly id: string; readonly name: string }[]
  readonly attentionRuntime: AttentionRuntimeSnapshotV0
  readonly requestedSession?: ContinuitySessionContextV1
  readonly recentSessions: readonly { readonly sessionId: string; readonly status: string; readonly updatedAt: string }[]
  readonly providerSessions: readonly ContinuityProviderSessionV1[]
  readonly realtime: { readonly runtimeId: string; readonly projectSeq: number }
  readonly generatedAt: string
}

/** C-early：Harness 只消费这个包，不需要理解 LCOS GUI。 */
export interface ContinuityAttachBundleV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly workspaceId: string | null
  readonly sessionId?: string
  readonly provider?: string
  readonly intent: IntentCandidateV0
  readonly contextPack: ContextPackV0
  readonly skillTarget: SkillTargetProposalV0
  readonly selectedViewIds: readonly string[]
  readonly sourceRefs: readonly { readonly sourceType: string; readonly sourceRef: string; readonly observedAt: string }[]
  readonly generatedAt: string
}

export interface BindContinuitySessionV1 {
  readonly sessionId: string
  readonly projectId: string
  readonly workspaceId?: string
  readonly status?: 'idle' | 'working' | 'blocked'
  readonly sourceRefs?: readonly { readonly sourceType: string; readonly sourceRef: string; readonly observedAt: string }[]
}

/** C-early：Provider-neutral 最小结果回流。完整 ArtifactReturn 仍由 Run 生命周期负责。 */
export interface ContinuityReturnIntakeV1 {
  readonly sessionId?: string
  readonly fromProvider?: string
  readonly toProvider?: string
  readonly title: string
  readonly summary: string
  readonly decisions?: readonly string[]
  readonly openQuestions?: readonly string[]
  readonly nextActions?: readonly string[]
  readonly artifactRefs?: readonly { readonly artifactId: string; readonly revisionId?: string }[]
  readonly messageRefs?: readonly string[]
  readonly runIds?: readonly string[]
}

export interface ContinuityReturnReceiptV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly sessionSummaryId: string
  readonly handoffId: string
  readonly sessionId?: string
  readonly createdAt: string
}
