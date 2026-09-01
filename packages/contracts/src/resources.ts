/**
 * Universal Resource Import contracts (U0).
 *
 * Reference: CODEX_UNIVERSAL_RESOURCE_IMPORT_CODE_LEVEL_PLAN.md
 * Principles:
 * - Import is not classification; classification is not execution.
 * - ResourceDescriptor is a derived, rebuildable understanding record,
 *   never a replacement for Project Truth (Artifact / Revision / FileRecord).
 * - Browser never submits absolute paths, root paths, shell commands or secrets.
 * - Import must never fail because understanding failed.
 */

export type ResourceId = string
export type ResourceDescriptorId = string

export type ResourceSourceV0 =
  | {
      readonly kind: 'uploaded_file'
      readonly uploadId: string
      readonly originalName: string
      readonly mediaType?: string
    }
  | {
      readonly kind: 'uploaded_directory'
      readonly uploadId: string
      readonly rootName: string
    }
  | {
      readonly kind: 'uploaded_archive'
      readonly uploadId: string
      readonly originalName: string
    }
  | {
      readonly kind: 'trusted_selection'
      readonly selectionId: string
    }
  | {
      readonly kind: 'url'
      readonly url: string
    }

export type ResourcePlacementV0 = {
  readonly scopeId?: string
  readonly workspaceId?: string
  readonly x?: number
  readonly y?: number
}

export type ImportResourceRequestV1 = {
  readonly importRequestId: string
  readonly projectId: string
  readonly source: ResourceSourceV0
  readonly placement?: ResourcePlacementV0
  readonly userNote?: string
}

export type ResourceImportSourceKind =
  | 'file_copy'
  | 'directory_copy'
  | 'archive_copy'
  | 'external_binding'
  | 'link'

export type ResourceUnderstandingStatus =
  | 'pending'
  | 'ready'
  | 'partial'
  | 'failed'

/**
 * S6 — durable provenance for one user-visible import action.
 * This is not a Collection or classification. It only lets Agent/GUI resolve
 * phrases such as “刚导入这一批” after reload without guessing from timestamps.
 */
export type ImportBatchSourceKindV1 =
  | 'file_drop'
  | 'directory_drop'
  | 'archive_drop'
  | 'capture'
  | 'other'

export type ImportBatchStatusV1 = 'completed' | 'partial' | 'failed'

export interface ImportBatchRefV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly projectId: string
  readonly sourceKind: ImportBatchSourceKindV1
  readonly status: ImportBatchStatusV1
  readonly scopeId?: string
  readonly importRequestIds: readonly string[]
  readonly artifactIds: readonly string[]
  readonly revisionIds: readonly string[]
  readonly viewIds: readonly string[]
  readonly createdAt: string
  readonly completedAt: string
}

export interface RecordImportBatchRequestV1 {
  readonly batchId: string
  readonly sourceKind: ImportBatchSourceKindV1
  readonly status: ImportBatchStatusV1
  readonly scopeId?: string
  readonly importRequestIds: readonly string[]
  readonly artifactIds: readonly string[]
  readonly revisionIds: readonly string[]
  readonly viewIds: readonly string[]
  readonly createdAt?: string
}

export type ImportResourceResultV1 = {
  readonly resourceId: ResourceId
  readonly artifactId: string
  readonly revisionId: string
  readonly viewId?: string
  readonly sourceKind: ResourceImportSourceKind
  readonly understandingStatus: ResourceUnderstandingStatus
  readonly descriptor?: ResourceDescriptorV0
}

export type ResourceDescriptorV0 = {
  readonly schemaVersion: '0'
  readonly id: ResourceDescriptorId
  readonly projectId: string
  readonly resourceId: ResourceId
  readonly artifactId: string
  readonly sourceRevisionId: string

  readonly source: {
    readonly kind: 'file' | 'directory' | 'archive' | 'external' | 'url'
    readonly originalName?: string
    readonly mediaType?: string
    readonly extension?: string
    readonly normalizedUrl?: string
    readonly domain?: string
    readonly contentHash?: string
  }

  readonly display: {
    readonly title: string
    readonly subtitle?: string
    readonly iconHint?: string
  }

  readonly detectedKinds: readonly {
    readonly kind: string
    readonly confidence: number
    readonly evidence: readonly {
      readonly source: 'filename' | 'content' | 'manifest' | 'structure' | 'metadata'
      readonly value: string
    }[]
  }[]

  readonly capabilities: readonly {
    readonly name: string
    readonly confidence: number
    readonly evidence: readonly string[]
  }[]

  readonly inputs: readonly string[]
  readonly outputs: readonly string[]
  readonly constraints: readonly string[]
  readonly entrypoints: readonly {
    readonly kind: 'file' | 'command' | 'mcp' | 'url'
    readonly value: string
  }[]
  readonly readFirst: readonly string[]

  readonly understanding: {
    readonly status: ResourceUnderstandingStatus
    readonly summary?: string
    readonly warnings: readonly string[]
    readonly analyzerVersion: string
    readonly analyzedAt?: string
  }

  readonly trust: {
    readonly level: 'untrusted' | 'reviewed' | 'trusted'
    readonly readable: boolean
    readonly executable: boolean
    readonly requiresApproval: boolean
  }

  readonly userAnnotation?: {
    readonly note?: string
    readonly pinnedLabels?: readonly string[]
  }
}

export type ResourceMatchQueryV0 = {
  readonly projectId: string
  readonly instruction: string
  readonly outputIntent?: 'create' | 'revise' | 'analyze'
  readonly activeContextId?: string
  readonly mediaTypes?: readonly string[]
  readonly limit?: number
}

export type ResourceMatchV0 = {
  readonly resourceId: ResourceId
  readonly artifactId: string
  readonly score: number
  readonly role:
    | 'context'
    | 'candidate_skill'
    | 'tool_config'
    | 'reference'
  readonly reasons: readonly string[]
  readonly warnings: readonly string[]
  readonly requiresApproval: boolean
  /** suggestion is informational; approved is context-safe; executable is explicitly authorized. */
  readonly layer: 'suggested' | 'approved' | 'executable'
}

export type ManifestResourceRefV0 = {
  readonly resourceId: ResourceId
  readonly artifactId: string
  readonly sourceRevisionId: string
  readonly descriptorHash: string
  readonly role:
    | 'context'
    | 'candidate_skill'
    | 'reference'
    | 'tool_config'
  readonly matchReasons: readonly string[]
  readonly requiresApproval: boolean
}
