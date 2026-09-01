export type ProjectEventChannel = 'presentation' | 'work_state' | 'run' | 'proposal' | 'artifact' | 'mutation' | 'continuity'

export type ProjectEventType =
  | 'presentation.changed'
  | 'work_state.changed'
  | 'run.changed'
  | 'proposal.changed'
  | 'artifact.changed'
  | 'change_set.changed'
  | 'relation.changed'
  | 'feedback_revision.changed'
  | 'continuity.changed'
  | 'snapshot.required'

export interface ProjectEventOrigin {
  readonly clientId: string
  readonly sessionId: string
  readonly clientSeq: number
  readonly operationId: string
  readonly sourceSurface?: string
}

/** Transport envelope only. Project Truth remains in authoritative repositories. */
export interface ProjectEventEnvelope<Payload = unknown> {
  readonly runtimeId: string
  readonly projectId: string
  readonly projectSeq: number
  readonly channel: ProjectEventChannel
  readonly type: ProjectEventType
  readonly origin?: ProjectEventOrigin
  readonly entityRefs?: readonly string[]
  readonly timestamp: string
  readonly payload: Payload
  readonly rejectionReason?: string
}

export interface ProjectEventSnapshotV1 {
  readonly runtimeId: string
  readonly projectId: string
  readonly currentSeq: number
  readonly presentations: readonly {
    readonly presentationId: string
    readonly version: number
    readonly updatedAt: string
    readonly updatedBy: string
  }[]
  readonly workStates: readonly {
    readonly workspaceId: string | null
    readonly version: number
  }[]
}

export type ProjectEventReconnectV1 =
  | { readonly kind: 'replay'; readonly runtimeId: string; readonly currentSeq: number; readonly events: readonly ProjectEventEnvelope[] }
  | { readonly kind: 'snapshot_required'; readonly runtimeId: string; readonly currentSeq: number }

export interface MutationReceipt<Response = unknown> {
  readonly runtimeId: string
  readonly projectId: string
  readonly operationId: string
  readonly origin: ProjectEventOrigin
  readonly resultingVersion?: number
  readonly projectSeq: number
  readonly response: Response
  readonly committedAt: string
}
