import type { CurationPatchRelationV0 } from './curation-patch.js'

/**
 * Phase D：Agent Reorganize Proposal。
 * Ghost preview → Apply / Reject；删除两级（Presentation 移除 vs Artifact 删除）。
 */
export interface ReorganizeProposalV0 {
  readonly schemaVersion: 0
  readonly id: string
  readonly projectId: string
  readonly presentationId: string
  readonly baseVersion: number
  readonly status: 'pending' | 'previewed' | 'applied' | 'accepted' | 'rejected' | 'rolled_back'
  readonly mergeCandidates: readonly {
    readonly sourceViewIds: readonly string[]
    readonly targetViewId?: string
    readonly reason: string
  }[]
  readonly removeMemberViewIds: readonly string[]
  readonly artifactDeleteCandidates: readonly {
    readonly artifactId: string
    readonly reason: string
  }[]
  readonly hierarchyPatch?: {
    readonly parentByViewId: Readonly<Record<string, string | null>>
    readonly orderByParent: Readonly<Record<string, readonly string[]>>
  }
  readonly relationPatch?: {
    readonly add?: readonly CurationPatchRelationV0[]
    readonly remove?: readonly string[]
  }
  readonly emphasisPatch?: Readonly<Record<string, 'primary' | 'normal' | 'secondary' | 'muted'>>
  readonly layoutIntent?: {
    readonly engine: 'elk' | 'fcose' | 'manual'
    readonly preservePinned: boolean
  }
  /** Presentation-only position patch. Never changes Project Entity identity or membership. */
  readonly positionPatch?: Readonly<Record<string, { readonly x: number; readonly y: number }>>
  readonly createdAt: string
  readonly appliedAt?: string
  readonly changeSetId?: string
}

export interface ReorganizePreviewV0 {
  readonly proposalId: string
  readonly willRemovePresentationMembers: readonly string[]
  readonly willDeleteArtifacts: readonly string[]
  readonly willMerge: readonly { readonly sourceViewIds: readonly string[]; readonly targetViewId?: string; readonly reason: string }[]
  readonly hierarchyChanges: number
  readonly relationAdds: number
  readonly relationRemoves: number
  readonly emphasisChanges: number
  readonly positionChanges: number
  readonly destructive: boolean
}
