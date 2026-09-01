/**
 * Phase B：Capture Staging Buffer 契约。
 *
 * 它是临时 transport buffer，不是 Inbox domain。
 * 大文件走 ~/.lcos/capture-staging/blobs/<sha256>，SQLite 不存 binary。
 */
export interface CaptureStagingItemV0 {
  readonly id: string
  readonly operationId: string
  readonly kind: string
  readonly payloadRef: string
  readonly source: Readonly<Record<string, unknown>>
  readonly suggestedProjects: readonly {
    readonly projectId: string
    readonly score: number
    readonly reason: string
  }[]
  readonly semanticHint?: {
    readonly model: string
    readonly scores: readonly { readonly projectId: string; readonly score: number }[]
  }
  readonly capturedAt: string
  readonly resolvedProjectId?: string
  readonly resolvedAt?: string
  /**
   * F6 follow-up（20260828 补充冻结）：materialize 产物回链——capture→surface 的
   * apply 第二步失败后可安全重试（materialize 幂等返回既有产物）。
   * 存量已 resolved 但缺回链的行保持旧行为（fail-close），不回填猜测。
   */
  readonly resolvedArtifactId?: string
  readonly resolvedViewId?: string
}

export type CaptureKindV0 =
  | 'web_page'
  | 'web_image'
  | 'web_selection'
  | 'web_link'
  | 'local_file'
  | 'screenshot'
  | 'clipboard_image'
  | 'clipboard_text'
  | 'conversation_snapshot'

export interface CaptureRequestV0 {
  readonly schemaVersion: 0
  readonly operationId: string
  readonly kind: CaptureKindV0
  readonly targetHint?: {
    readonly projectId?: string
    readonly scopeId?: string
    readonly presentationId?: string
  }
  readonly source: {
    readonly app?: string
    readonly url?: string
    readonly title?: string
    readonly referrer?: string
    readonly capturedAt: string
    readonly sessionId?: string
    readonly browserProfileId?: string
    readonly browserTabId?: number
  }
  readonly payload:
    | { readonly type: 'url'; readonly url: string }
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'local_path'; readonly path: string }
    | { readonly type: 'staged_blob'; readonly blobRef: string }
  readonly hints?: {
    readonly title?: string
    readonly note?: string
  }
}

export interface CaptureReceiptV0 {
  readonly operationId: string
  readonly status: 'created' | 'reused' | 'staged' | 'failed'
  readonly projectId?: string
  readonly artifactId?: string
  readonly resourceId?: string
  readonly viewId?: string
  readonly stagingId?: string
  readonly duplicateOf?: string
}

export interface CaptureWatchRuleV0 {
  readonly id: string
  readonly path: string
  readonly patterns: readonly string[]
  readonly projectHint?: string
  readonly settleMs: number
  readonly enabled: boolean
}

/**
 * Phase 5 §8.2：CaptureRequestV1 —— 浏览器扩展/桌面快速捕获的统一载荷。
 * Core 仍是路由权威；扩展不做 Project Affinity。
 */
export interface CaptureRequestV1 {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly capturedAt: string
  readonly source: {
    readonly kind: 'page' | 'selection' | 'image' | 'link' | 'screenshot' | 'text' | 'file'
    readonly pageUrl?: string
    readonly pageTitle?: string
    readonly sourceUrl?: string
    /** 桌面快速捕获：本地文件/文件夹/快捷方式路径（仅 Runtime Host 信任通道）。 */
    readonly localPath?: string
  }
  readonly content?: {
    readonly text?: string
    readonly dataUrl?: string
    readonly mimeType?: string
  }
  readonly target:
    | { readonly mode: 'auto' }
    | { readonly mode: 'project'; readonly projectId: string }
    | { readonly mode: 'staging' }
  readonly hints?: {
    readonly title?: string
  }
}

export interface CaptureGatewayResultV1 {
  readonly receipt: CaptureReceiptV0
  readonly destinationLabel: string
  readonly destination: 'project' | 'staging'
}

/**
 * 0.1 Capture Space：系统级暂存画布的纯 Presentation truth。
 * Capture payload 仍属于 staging transport；这里仅保存位置、分组和轻量显示状态。
 */
export interface CaptureSpaceViewV1 {
  readonly captureId: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly collapsed?: boolean
  readonly fixed?: boolean
}

export interface CaptureSpaceRegionV1 {
  readonly id: string
  readonly label: string
  readonly captureIds: readonly string[]
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly projectHintId?: string
}

export interface CaptureSpacePresentationV1 {
  readonly schemaVersion: 1
  readonly version: number
  readonly views: readonly CaptureSpaceViewV1[]
  readonly regions: readonly CaptureSpaceRegionV1[]
  readonly updatedAt: string
}

export interface CaptureSpaceSnapshotV1 {
  readonly schemaVersion: 1
  readonly items: readonly CaptureStagingItemV0[]
  readonly pendingCount: number
  readonly presentation: CaptureSpacePresentationV1
}

export interface CaptureSpaceOrganizeResultV1 {
  readonly schemaVersion: 1
  readonly presentation: CaptureSpacePresentationV1
  readonly providerId?: string
  readonly model?: string
  readonly usedModel: boolean
  readonly summary: string
}

export interface CaptureMaterializeResultV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly batchId: string
  readonly imported: number
  readonly items: readonly {
    readonly captureId: string
    readonly artifactId: string
    readonly viewId: string
    readonly revisionId?: string
    readonly resourceId?: string
    /** 幂等复用：capture 已 resolved 到同一 project 时返回既有产物，不重复物化。 */
    readonly reused?: boolean
  }[]
}

export interface CaptureSpacePayloadPreviewV1 {
  readonly schemaVersion: 1
  readonly captureId: string
  readonly type: 'text' | 'image' | 'url' | 'local_path' | 'unknown'
  readonly text?: string
  readonly dataUrl?: string
  readonly url?: string
  readonly path?: string
  readonly truncated?: boolean
}
