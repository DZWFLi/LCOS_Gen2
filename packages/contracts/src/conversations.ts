/**
 * Conversation import and retrieval contracts.
 *
 * The raw timeline is the only conversation truth. Sections, annotations,
 * FTS rows and vectors are rebuildable projections keyed by source hashes.
 */

export type ConversationSourceKind = 'codex' | 'chatgpt' | 'claude' | 'manual'
export type ConversationRole = 'user' | 'assistant' | 'tool' | 'system' | 'event'
export type ConversationSectionKind = 'turn' | 'instruction' | 'tool_cluster' | 'long_message'
export type ConversationImportStatus = 'receiving' | 'parsing' | 'ready' | 'failed'
export type ConversationAnnotationStatus = 'none' | 'ready' | 'failed'


export interface ConversationImportDiagnosticV1 {
  readonly parsedLines: number
  readonly invalidLines: number
  readonly ignoredEvents: number
  readonly duplicateEvents: number
  readonly matchedFileReferences: number
}

export interface ConversationSessionV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly projectId: string
  readonly provider: string
  readonly sourceKind: ConversationSourceKind
  readonly title: string
  readonly messageCount: number
  readonly sectionCount: number
  readonly status: ConversationImportStatus
  readonly sourceContentHash?: string
  readonly sourceFileName?: string
  readonly originMeta: Readonly<Record<string, unknown>>
  readonly diagnostics?: ConversationImportDiagnosticV1
  readonly conversationArtifactId?: string
  readonly conversationViewId?: string
  readonly importedAt?: string
  readonly createdAt: string
  readonly updatedAt: string
  /**
   * 用户最近一次打开/进入该对话现场的时间（ISO 时间字符串）。
   * 纯 Presentation 层活动度数据源（UX 收口 §3.2），不是 Project Truth。
  */
  readonly lastOpenedAt?: string
  /**
   * 该对话最近一次发起 Run 的时间（ISO 时间字符串）。
   * 纯 Presentation 层活动度数据源（UX 收口 §3.2），不是 Project Truth。
  */
  readonly lastRunAt?: string
  /**
   * 最近一次被设为当前控制 Agent 的时间（ISO 时间字符串）。
   * 纯 Presentation 层活动度数据源（UX 收口 §3.2），不是 Project Truth。
  */
  readonly lastSelectedAsControllerAt?: string
}

export interface ConversationFileReferenceV1 {
  readonly raw: string
  readonly normalized?: string
  readonly artifactId?: string
  readonly relationId?: string
  readonly inProject: boolean
}

export interface ConversationMessageV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly sessionId: string
  readonly seq: number
  readonly role: ConversationRole
  readonly eventKind: string
  readonly sourceEventId?: string
  readonly contentText: string
  readonly createdAt: string
  readonly toolName?: string
  readonly toolCall?: Readonly<Record<string, unknown>>
  readonly fileRefs: readonly ConversationFileReferenceV1[]
  readonly parentId?: string
  readonly pinnedAsDecision: boolean
  readonly decisionArtifactId?: string
  readonly contentHash: string
}

export interface ConversationSectionV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly sessionId: string
  readonly seq: number
  readonly kind: ConversationSectionKind
  readonly title: string
  readonly startSeq: number
  readonly endSeq: number
  readonly lockedByUser: boolean
  readonly derivedAt: string
  readonly annotation?: ConversationSectionAnnotationV1
}

export interface ConversationSectionAnnotationV1 {
  readonly schemaVersion: 1
  readonly sectionId: string
  readonly sourceHash: string
  readonly title: string
  readonly decisions: readonly string[]
  readonly todos: readonly string[]
  readonly involvedFiles: readonly string[]
  readonly status: ConversationAnnotationStatus
  readonly annotatedBy: 'agent' | 'user'
  readonly annotatedAt: string
}

export interface ConversationProjectionV1 {
  readonly session: ConversationSessionV1
  readonly sections: readonly ConversationSectionV1[]
  readonly pinnedDecisions: readonly ConversationMessageV1[]
  readonly recentMessages: readonly ConversationMessageV1[]
  readonly semanticIndex: ConversationSemanticIndexStatusV1
}


export interface ConversationExportV1 {
  readonly schemaVersion: 1
  readonly exportedAt: string
  readonly session: ConversationSessionV1
  readonly sections: readonly ConversationSectionV1[]
  readonly pinnedDecisions: readonly ConversationMessageV1[]
  readonly messages?: readonly ConversationMessageV1[]
  readonly source: {
    readonly kind: ConversationSourceKind
    readonly contentHash?: string
    readonly fileName?: string
    readonly rawTimelineIncluded: boolean
  }
}

export interface ConversationSearchHitV1 {
  readonly message: ConversationMessageV1
  readonly sessionTitle: string
  readonly sectionId?: string
  readonly sectionTitle?: string
  readonly lexicalRank?: number
  readonly vectorDistance?: number
  readonly hybridScore: number
  readonly reasons: readonly ('fts5' | 'vector' | 'pinned' | 'recent')[]
}

export interface ConversationImportSessionV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly projectId: string
  readonly sourceKind: ConversationSourceKind
  readonly title: string
  readonly sourceFileName: string
  readonly expectedBytes?: number
  readonly receivedBytes: number
  readonly receivedChunks: number
  readonly workspaceId?: string
  readonly scopeId: string
  readonly status: ConversationImportStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateConversationImportSessionInputV1 {
  readonly sourceKind: ConversationSourceKind
  readonly title?: string
  readonly sourceFileName: string
  readonly expectedBytes?: number
  readonly workspaceId?: string
  readonly scopeId: string
}

export interface CompleteConversationImportInputV1 {
  readonly expectedChunks: number
  readonly expectedContentHash?: string
}

export interface CompleteConversationImportResultV1 {
  readonly session: ConversationSessionV1
  readonly sections: readonly ConversationSectionV1[]
  readonly matchedFileReferences: number
  readonly ignoredDuplicateEvents: number
}

export interface PinConversationMessageInputV1 {
  readonly title?: string
  readonly summary?: string
  readonly scopeId: string
  readonly workspaceId?: string
  readonly x?: number
  readonly y?: number
}

export interface AnnotateConversationSectionInputV1 {
  readonly sourceHash: string
  readonly title: string
  readonly decisions: readonly string[]
  readonly todos: readonly string[]
  readonly involvedFiles: readonly string[]
  readonly annotatedBy?: 'agent' | 'user'
}

export interface ConversationSemanticIndexStatusV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly provider: 'ollama'
  readonly model: string
  readonly state: 'disabled' | 'not_ready' | 'indexing' | 'ready' | 'partial' | 'failed'
  readonly backend: 'sqlite-vec' | 'sqlite-blob-fallback'
  readonly indexedMessages: number
  readonly staleMessages: number
  readonly dimensions?: number
  readonly indexVersion?: string
  readonly lastError?: string
  readonly updatedAt: string
}

export interface BuildConversationSemanticIndexInputV1 {
  readonly model?: string
  readonly sessionId?: string
  readonly force?: boolean
  readonly batchSize?: number
}

export interface ManualConversationEntryV1 {
  readonly role: 'user' | 'assistant' | 'tool' | 'system'
  readonly contentText: string
  readonly createdAt?: string
  readonly toolName?: string
}

export interface ImportManualConversationInputV1 {
  readonly title?: string
  readonly scopeId: string
  readonly workspaceId?: string
  readonly entries: readonly ManualConversationEntryV1[]
}

/**
 * Stable import envelope for future Context adapters. Conversation is the
 * first implemented adapter; other exports must add a real parser rather
 * than pretending to be Codex JSONL.
 */
export type ContextImportSourceV0 =
  | {
      readonly kind: 'conversation'
      readonly adapter: 'codex-jsonl'
      readonly sourceFileName: string
    }
  | {
      readonly kind: 'conversation'
      readonly adapter: 'manual-timeline'
      readonly title?: string
    }
