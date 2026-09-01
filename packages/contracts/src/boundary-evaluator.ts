export type BoundaryEvaluationKindV1 = 'context' | 'workflow'

export interface BoundaryEvaluationEvidenceV1 {
  readonly id: string
  readonly label: string
  readonly source: string
}

export interface BoundaryEvaluationRequestV1 {
  readonly kind: BoundaryEvaluationKindV1
  readonly evidenceKey: string
  readonly evidence: readonly BoundaryEvaluationEvidenceV1[]
  readonly reflection?: string
  readonly workspaceId?: string
}

/** Low-frequency presentation decision. This is not Project Truth and is not persisted. */
export interface BoundaryEvaluationResultV1 {
  readonly schemaVersion: 1
  readonly kind: BoundaryEvaluationKindV1
  readonly shouldShow: boolean
  readonly confidence: number
  readonly reason: string
  readonly providerId?: string
  readonly model?: string
}
