import type { RunProposalResult } from './index.js'

/** B5：把零散反馈收口为可执行修订请求，不新造 Feedback 数据库。 */
export interface PrepareRevisionRequestV1 {
  readonly targetArtifactId: string
  readonly baseRevisionId?: string
  readonly feedbackArtifactIds: readonly string[]
  readonly decision: string
  readonly changeItems: readonly string[]
  readonly preserveItems: readonly string[]
  readonly scopeId: string
  readonly workspaceId?: string
  readonly requestedProvider?: string
}

export interface PreparedRevisionWorkflowV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly targetArtifactId: string
  readonly baseRevisionId: string
  readonly feedbackArtifactIds: readonly string[]
  readonly decisionArtifactId: string
  readonly decisionViewId: string
  readonly changeRequestArtifactId: string
  readonly changeRequestViewId: string
  readonly relationIds: readonly string[]
  readonly changeSetId: string
  readonly proposal: RunProposalResult
  readonly createdAt: string
}
