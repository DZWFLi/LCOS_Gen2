/**
 * Federated search contract — Phase D (Agent CLI Read + Search V0).
 * Unified hits over Artifact text/title, Notes, Conversation FTS and Resource
 * descriptors. No new search DB; no vector claims.
 */

export type SearchEntityTypeV0 = 'artifact' | 'note' | 'conversation' | 'resource' | 'file'

export interface SearchHitV0 {
  readonly entityType: SearchEntityTypeV0
  readonly entityId: string
  readonly viewId?: string
  readonly title: string
  readonly snippet: string
  readonly source: string
  readonly score: number
  /**
   * 块级锚点（chunking，第一梯队核心能力 B）：语义同 ContextManifestOrderedItemV0.sourceAnchor，
   * 形如 'pdf:p3-p5' / 'section:风险' / 'chunk:2-4'。省略 = 文档级命中（标题/整文档）；
   * 带值 = 块级命中（正文分块），让信息谱能引用到块级而不是整份文档。
   */
  readonly chunkAnchor?: string
  /** 块序号（0-based，标题块为 0），便于 UI 区分文档级/块级命中。 */
  readonly chunkIndex?: number
  /** 该实体的总分块数（含标题块）。 */
  readonly chunkCount?: number
}

export interface SearchQueryV0 {
  readonly query: string
  readonly limit?: number
  readonly types?: readonly SearchEntityTypeV0[]
}

export interface SearchResultV0 {
  readonly schemaVersion: 0
  readonly query: string
  readonly hits: readonly SearchHitV0[]
  readonly truncated: boolean
  readonly generatedAt: string
}

// ==================== VNext（F6 后端同步施工单 P0-A4，20260828） ====================

/** 命中原因：让 GUI 能说「为什么搜到它」，而不是只给一个分数。 */
export type SearchMatchReasonVNext =
  | 'title'          // 标题/文件名命中
  | 'body'           // 正文文本命中（FTS）
  | 'ocr'            // 图片 OCR 文本命中
  | 'visual'         // 视觉相似（visual embedding；落地后启用）
  | 'semantic'       // 向量语义命中（chunk embedding）
  | 'source'         // 来源/域名/URL 命中（web/link/resource descriptor）
  | 'relation'       // relation / project memory 扩展命中
  | 'metadata'       // 其它元数据（note body / conversation transcript 等宽泛正文）

/** 命中模态：粗粒度告诉前端这是文本路径还是多模态路径。 */
export type SearchMatchModalityVNext = 'text' | 'semantic' | 'ocr' | 'visual' | 'graph'

/** canonical entity ref（与 Assembly SourceRef 同构的 entity 引用形状）。 */
export interface SearchEntityRefVNext {
  readonly type: 'artifact' | 'note' | 'conversation' | 'resource' | 'file'
  readonly id: string
  readonly viewId?: string
}

/** 命中对象的画布位置投影（read projection，不新建 Location Truth）。 */
export interface SearchLocationRefVNext {
  readonly kind: 'workspace'
  readonly id: string
  readonly name?: string
}

/**
 * F6 Search Hit vNext：V0 字段全部保留（旧消费者零破坏），新增字段全部 optional。
 * 普通用户不看 vector distance —— score 已归一化为排序分；distance 不进 contract。
 */
export interface SearchHitVNext extends SearchHitV0 {
  /** canonical entity ref（type:id + 可选 viewId）。 */
  readonly entityRef?: SearchEntityRefVNext
  /** 为什么命中（映射自 source，见 ProjectSearchService 的 SOURCE_TO_MATCH_REASON）。 */
  readonly matchReason?: SearchMatchReasonVNext
  /** 命中模态。 */
  readonly matchModality?: SearchMatchModalityVNext
  /** 语义同 chunkAnchor（显式别名，前端 vNext 读取用）。 */
  readonly sourceAnchor?: string
  /** 预览引用（GUI 卡片封面/缩略图的既有 preview 通道；无则省略）。 */
  readonly previewRef?: string
  /** 该对象出现在哪些画布位置（上限 5，read projection）。 */
  readonly locationRefs?: readonly SearchLocationRefVNext[]
  /** 位置总数（不截断时的全量计数）。 */
  readonly locationCount?: number
  /** 是否被当前 Target 使用（请求带 usedHereTarget 时填充）。 */
  readonly usedHere?: boolean
}

/** 搜索请求 vNext：V0 参数 + usedHere 投影开关。 */
export interface SearchQueryVNext extends SearchQueryV0 {
  /** 给定时对每个 hit 计算 usedHere（read projection，不改 Truth）。 */
  readonly usedHereTarget?: { readonly kind: 'workspace' | 'scope' | 'conversation'; readonly id: string }
}

export interface SearchResultVNext extends SearchResultV0 {
  readonly hits: readonly SearchHitVNext[]
}
