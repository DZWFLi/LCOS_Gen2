/**
 * Phase B：Project Affinity（确定性归属解析）契约。
 *
 * 只做确定性规则（explicit > session > path > local agent browser > browser tab
 * > pinned > recent focus > semantic hint（Phase F 槽）> recent project）。
 * Agent 不参与解析；semantic_hint 在 Phase F 前不激活。
 */
export interface ProjectAffinityInputV0 {
  readonly explicitProjectId?: string
  readonly sessionId?: string
  readonly localPath?: string
  readonly browser?: {
    readonly profileId?: string
    readonly tabId?: number
    readonly url?: string
  }
  readonly sourceApp?: string
  readonly capturedAt: string
}

export type AffinityReasonV0 =
  | 'explicit'
  | 'session_bound'
  | 'path_inside_root'
  | 'local_agent_browser_bound'
  | 'browser_tab_bound'
  | 'pinned_capture_target'
  | 'recent_focus'
  | 'semantic_hint'
  | 'recent_project'
  | 'unknown'

export interface ProjectAffinityCandidateV0 {
  readonly projectId: string
  readonly score: number
  readonly reason: AffinityReasonV0
}

export interface ProjectAffinityResultV0 {
  readonly projectId?: string
  readonly confidence: number
  readonly reason: AffinityReasonV0
  readonly candidates?: readonly ProjectAffinityCandidateV0[]
}
