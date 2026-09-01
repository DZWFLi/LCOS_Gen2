/**
 * Curation read contract — frozen at Phase A (Contract Freeze & Detox).
 *
 * These are the future Agent-facing query results for lcos-project-curator.
 * They intentionally expose stable refs and bounded text, NOT repository
 * table shapes (storage tables are implementation details).
 *
 * Phase A only freezes the interface; CLI commands are Phase D.
 */

export type CurationContentKindV0 =
  | 'text'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'presentation'
  | 'link'
  | 'conversation-section'
  | 'other'

export interface CurationSourceRefV0 {
  readonly kind: 'artifact' | 'resource' | 'conversation' | 'file'
  readonly id: string
  readonly label?: string
  readonly revisionId?: string
  readonly contentHash?: string
}

export interface CurationNodeV0 {
  readonly stableRef: string
  readonly viewId?: string
  readonly title: string
  readonly contentKind: CurationContentKindV0
  readonly boundedText: string
  readonly fileHints?: readonly string[]
  readonly urlHints?: readonly string[]
  readonly resourceHints?: readonly string[]
  readonly sourceRefs: readonly CurationSourceRefV0[]
  readonly currentRevisionId?: string
  readonly updatedAt?: string
  readonly truncated: boolean
}

export interface CurationReadResultV0 {
  readonly query: string
  readonly nodes: readonly CurationNodeV0[]
  readonly totalMatches: number
  readonly truncated: boolean
  readonly budget?: CurationReadBudgetV0
  readonly generatedAt: string
}

export interface CurationReadBudgetV0 {
  readonly maxItems?: number
  readonly maxCharsPerItem?: number
  readonly maxTotalChars?: number
}
