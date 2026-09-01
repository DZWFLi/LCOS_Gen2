import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import { createDefaultSearchContentExtractors, readArtifactIndexBody } from './search-artifact-body.js'
import {
  LOCAL_CHUNK_RETRIEVAL_PROVIDER_ID,
  OLLAMA_EMBEDDING_PROVIDER_ID,
  OllamaEmbeddingProvider,
  RepositoryChunkRetrievalProvider,
  SemanticProviderRegistry,
  type SemanticVectorHitV0,
} from './semantic-provider-registry.js'

export type { SemanticVectorHitV0 } from './semantic-provider-registry.js'

const DEFAULT_EMBEDDING_MODEL = process.env.LCOS_OLLAMA_EMBED_MODEL ?? 'nomic-embed-text'
const DEFAULT_OLLAMA_URL = process.env.LCOS_OLLAMA_URL ?? 'http://127.0.0.1:11434'

// ==================== Chunking（第一梯队核心能力 B：块级锚点检索） ====================

/** 单块目标 token 上限（近似估算口径见 estimateTokens）。集中成常量便于调参。 */
export const CHUNK_TARGET_TOKENS = 1200

/** markdown 标题行（# ~ ######）识别。 */
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/

/** chunkAnchor 中标题文本最大长度（超长截断，保持锚点可读）。 */
const ANCHOR_TITLE_MAX_CHARS = 60

export interface SemanticIndexHealthV0 {
  /** Compatibility signal for the built-in Ollama adapter; availability is still probed lazily on embed. */
  readonly ollama: 'available' | 'unavailable'
  readonly vector: 'native' | 'fallback' | 'unavailable'
  readonly backend: 'sqlite-vec' | 'sqlite-blob-fallback' | 'none'
  readonly model: string
  readonly embeddingProvider: string
  readonly retrievalProvider: string
  readonly visualEmbeddingProviders: readonly string[]
}

export interface SemanticIndexedEntityV0 {
  readonly projectId: string
  readonly entityType: string
  readonly entityId: string
  readonly title: string
  readonly body: string
}

/** chunkEntity 分块计划：标题块（文档级命中）+ 正文块（块级命中，带 anchor）。 */
export interface SemanticChunkPlanV0 {
  readonly chunkAnchor: string
  readonly chunkKind: 'title' | 'body'
  readonly chunkText: string
  readonly contentHash: string
  readonly chunkIndex: number
  readonly chunkCount: number
}

function isCjkCodePoint(code: number): boolean {
  return (code >= 0x3000 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef)
}

/** 近似 token 估算：CJK 字符按 1 token，其余按 4 字符 1 token。 */
function estimateTokens(text: string): number {
  let cjk = 0
  let total = 0
  for (const ch of text) {
    total += 1
    if (isCjkCodePoint(ch.codePointAt(0) ?? 0)) cjk += 1
  }
  return cjk + Math.ceil((total - cjk) / 4)
}

interface BodyChunkDraft {
  readonly anchor: string
  readonly text: string
}

function sanitizeAnchorTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, ANCHOR_TITLE_MAX_CHARS)
}

/** 超大段落（单段超过目标 token）按近似 token 窗口展开，避免无换行长文产生超限单块。 */
function splitOversizedParagraph(paragraph: string): string[] {
  const chars = Array.from(paragraph)
  const parts: string[] = []
  let start = 0
  let tokens = 0
  for (let index = 0; index < chars.length; index += 1) {
    tokens += isCjkCodePoint(chars[index]!.codePointAt(0) ?? 0) ? 1 : 0.25
    if (tokens >= CHUNK_TARGET_TOKENS) {
      parts.push(chars.slice(start, index + 1).join(''))
      start = index + 1
      tokens = 0
    }
  }
  if (start < chars.length) {
    const tail = chars.slice(start).join('')
    // 尾块过小并入前块，避免碎片块
    if (parts.length > 0 && estimateTokens(tail) * 8 < CHUNK_TARGET_TOKENS) {
      parts[parts.length - 1] = `${parts[parts.length - 1] ?? ''}${tail}`
    } else {
      parts.push(tail)
    }
  }
  return parts
}

/** 段落切分（一个及以上空行分界），超大段落展开为 token 窗口子段。 */
function splitParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  for (const raw of text.split(/\n{2,}/)) {
    const trimmed = raw.trim()
    if (trimmed === '') continue
    if (estimateTokens(trimmed) <= CHUNK_TARGET_TOKENS) paragraphs.push(trimmed)
    else paragraphs.push(...splitOversizedParagraph(trimmed))
  }
  return paragraphs
}

/** anchor 去重：重复出现的 anchor 依次追加 #2、#3（同名标题、同页多组）。 */
function dedupeAnchors(drafts: readonly BodyChunkDraft[]): BodyChunkDraft[] {
  const used = new Map<string, number>()
  return drafts.map((draft) => {
    const seen = used.get(draft.anchor) ?? 0
    used.set(draft.anchor, seen + 1)
    return seen === 0 ? draft : { ...draft, anchor: `${draft.anchor}#${seen + 1}` }
  })
}

/** 段落贪心聚合到目标 token 上限；anchorFor 接收组的首/尾段落序号与组序号（均为 0-based）。 */
function packParagraphs(
  paragraphs: readonly string[],
  anchorFor: (group: { readonly first: number; readonly last: number; readonly index: number }) => string,
): BodyChunkDraft[] {
  const groups: Array<{ first: number; last: number; texts: string[] }> = []
  let buffer: string[] = []
  let bufferFirst = 0
  let bufferTokens = 0
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]!
    const tokens = estimateTokens(paragraph)
    if (buffer.length > 0 && bufferTokens + tokens > CHUNK_TARGET_TOKENS) {
      groups.push({ first: bufferFirst, last: index - 1, texts: buffer })
      buffer = []
      bufferTokens = 0
    }
    if (buffer.length === 0) bufferFirst = index
    buffer.push(paragraph)
    bufferTokens += tokens
  }
  if (buffer.length > 0) groups.push({ first: bufferFirst, last: paragraphs.length - 1, texts: buffer })
  return groups.map((group, index) => ({ anchor: anchorFor({ ...group, index }), text: group.texts.join('\n\n') }))
}

/** markdown/text 正文：按标题行分节（anchor='section:标题'），前言与无标题文本按段落窗口（anchor='chunk:a-b'）。 */
function planSectionChunks(body: string): BodyChunkDraft[] {
  const lines = body.split('\n')
  const preambleLines: string[] = []
  const sections: Array<{ anchor: string; lines: string[] }> = []
  let current: { anchor: string; lines: string[] } | undefined
  for (const line of lines) {
    const match = HEADING_PATTERN.exec(line)
    if (match !== null) {
      if (current !== undefined) sections.push(current)
      current = { anchor: `section:${sanitizeAnchorTitle(match[2] ?? '')}`, lines: [line] }
    } else if (current !== undefined) {
      current.lines.push(line)
    } else {
      preambleLines.push(line)
    }
  }
  if (current !== undefined) sections.push(current)

  const drafts: BodyChunkDraft[] = []
  const preambleText = preambleLines.join('\n').trim()
  if (preambleText !== '') {
    drafts.push(...packParagraphs(splitParagraphs(preambleText), (group) =>
      group.first === group.last ? `chunk:${group.first + 1}` : `chunk:${group.first + 1}-${group.last + 1}`))
  }
  for (const section of sections) {
    const sectionText = section.lines.join('\n').trim()
    if (sectionText === '') continue
    drafts.push(...packParagraphs(splitParagraphs(sectionText), (group) =>
      group.index === 0 ? section.anchor : `${section.anchor}#${group.index + 1}`))
  }
  return dedupeAnchors(drafts)
}

/** pdf 正文（\f 分页约定，页号 1-based 与 PDF 页对应）：按页聚合到目标大小（anchor='pdf:p3'/'pdf:p3-p5'），超大页内部再切。 */
function planPageChunks(body: string): BodyChunkDraft[] {
  const rawPages = body.split('\f')
  const segments: Array<{ page: number; text: string; tokens: number }> = []
  for (let index = 0; index < rawPages.length; index += 1) {
    const pageText = rawPages[index]!.trim()
    if (pageText === '') continue
    for (const part of splitParagraphs(pageText)) {
      segments.push({ page: index + 1, text: part, tokens: estimateTokens(part) })
    }
  }
  const groups: Array<{ firstPage: number; lastPage: number; texts: string[] }> = []
  let buffer: Array<{ page: number; text: string }> = []
  let bufferTokens = 0
  let firstPage = 0
  const flush = (): void => {
    if (buffer.length === 0) return
    groups.push({ firstPage, lastPage: buffer[buffer.length - 1]!.page, texts: buffer.map((item) => item.text) })
    buffer = []
    bufferTokens = 0
  }
  for (const segment of segments) {
    if (buffer.length > 0 && bufferTokens + segment.tokens > CHUNK_TARGET_TOKENS) flush()
    if (buffer.length === 0) firstPage = segment.page
    buffer.push({ page: segment.page, text: segment.text })
    bufferTokens += segment.tokens
  }
  flush()
  return dedupeAnchors(groups.map((group) => ({
    anchor: group.firstPage === group.lastPage ? `pdf:p${group.firstPage}` : `pdf:p${group.firstPage}-p${group.lastPage}`,
    text: group.texts.join('\n\n'),
  })))
}

function buildPlan(anchor: string, kind: 'title' | 'body', text: string, chunkIndex: number, chunkCount: number): SemanticChunkPlanV0 {
  return {
    chunkAnchor: anchor,
    chunkKind: kind,
    chunkText: text,
    contentHash: createHash('sha256').update(`${kind}\n${anchor}\n${text}`, 'utf8').digest('hex'),
    chunkIndex,
    chunkCount,
  }
}

/**
 * 分块策略（参考 PipesHub indexing 管线的 block 粒度思路，本地化为纯函数）：
 * - 标题块：title 单独成块（chunkKind='title'，anchor='document'）→ 检索时视为文档级命中；
 * - 正文含 \f（PDF 页文本的分页约定）：按页聚合分块，anchor='pdf:p3' / 'pdf:p3-p5'（语义同
 *   contracts 的 sourceAnchor）；
 * - markdown/text：按标题行分节，anchor='section:标题'；节超过 CHUNK_TARGET_TOKENS 再按段落
 *   聚合切分（后续子块追加 #2、#3 后缀）；
 * - 无标题文本（含第一个标题前的前言）按段落窗口分块，anchor='chunk:a-b'（段落序号 1-based）；
 * - 超大段落按近似 token 窗口展开；重复 anchor 依次去重。
 * 每块独立 contentHash，增量索引只重算变化块。
 */
export function chunkEntity(input: { readonly title: string; readonly body: string }): SemanticChunkPlanV0[] {
  const titleText = input.title.trim()
  const normalizedBody = input.body.replace(/\r\n/g, '\n')
  const bodyDrafts: BodyChunkDraft[] = []
  if (normalizedBody.trim() !== '') {
    bodyDrafts.push(...(normalizedBody.includes('\f') ? planPageChunks(normalizedBody) : planSectionChunks(normalizedBody)))
  }
  const chunkCount = (titleText === '' ? 0 : 1) + bodyDrafts.length
  const plans: SemanticChunkPlanV0[] = []
  let chunkIndex = 0
  if (titleText !== '') {
    plans.push(buildPlan('document', 'title', titleText, chunkIndex, chunkCount))
    chunkIndex += 1
  }
  for (const draft of bodyDrafts) {
    plans.push(buildPlan(draft.anchor, 'body', draft.text, chunkIndex, chunkCount))
    chunkIndex += 1
  }
  return plans
}

/**
 * Phase G: generic semantic index over the derived search_documents layer.
 * Conversation-specific embedding stays in ConversationImportService (compat);
 * artifacts/notes/resources/skills index through this service.
 * Vector availability is never a hard dependency.
 * 核心能力 B：正文按块（chunk）独立 embed，检索命中带 chunkAnchor（块级锚点），
 * 标题块命中仍保留为文档级命中。
 */
export interface SemanticIndexServiceOptions {
  readonly ollamaUrl?: string
  readonly vectorExtensionPath?: string
  readonly providers?: SemanticProviderRegistry
  readonly embeddingProviderId?: string
  readonly retrievalProviderId?: string
}

export class SemanticIndexService {
  #vectorLoaded = false
  readonly #vectorExtensionPath: string | undefined
  readonly #providers: SemanticProviderRegistry
  readonly #embeddingProviderId: string
  readonly #retrievalProviderId: string

  constructor(
    private readonly repository: SqliteMetadataRepository,
    options: SemanticIndexServiceOptions = {},
  ) {
    const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
    this.#vectorExtensionPath = options.vectorExtensionPath
      ?? join(repoRoot, '.runtime', 'sqlite-vec', process.platform === 'win32' ? 'vec0.dll' : process.platform === 'darwin' ? 'vec0.dylib' : 'vec0.so')
    if (this.#vectorExtensionPath !== undefined) {
      this.#vectorLoaded = this.repository.loadVectorExtension(resolve(this.#vectorExtensionPath))
    }

    this.#providers = options.providers ?? new SemanticProviderRegistry()
    for (const extractor of createDefaultSearchContentExtractors()) {
      if (this.#providers.contentExtractor(extractor.id) === undefined) this.#providers.registerContentExtractor(extractor)
    }

    const requestedEmbeddingId = options.embeddingProviderId ?? this.#providers.defaultEmbeddingProviderId()
    if (requestedEmbeddingId === undefined) {
      this.#providers.registerEmbedding(new OllamaEmbeddingProvider(options.ollamaUrl ?? DEFAULT_OLLAMA_URL))
      this.#embeddingProviderId = OLLAMA_EMBEDDING_PROVIDER_ID
    } else {
      if (this.#providers.embedding(requestedEmbeddingId) === undefined) {
        throw new Error(`Embedding provider not found: ${requestedEmbeddingId}`)
      }
      this.#embeddingProviderId = requestedEmbeddingId
    }

    const requestedRetrievalId = options.retrievalProviderId ?? this.#providers.defaultRetrievalProviderId()
    if (requestedRetrievalId === undefined) {
      this.#providers.registerRetrieval(new RepositoryChunkRetrievalProvider(this.repository))
      this.#retrievalProviderId = LOCAL_CHUNK_RETRIEVAL_PROVIDER_ID
    } else {
      if (this.#providers.retrieval(requestedRetrievalId) === undefined) {
        throw new Error(`Retrieval provider not found: ${requestedRetrievalId}`)
      }
      this.#retrievalProviderId = requestedRetrievalId
    }
  }

  providers(): SemanticProviderRegistry {
    return this.#providers
  }

  health(): SemanticIndexHealthV0 {
    return {
      ollama: this.#embeddingProviderId === OLLAMA_EMBEDDING_PROVIDER_ID ? 'available' : 'unavailable',
      vector: this.#vectorLoaded ? 'native' : 'fallback',
      backend: this.#vectorLoaded ? 'sqlite-vec' : 'sqlite-blob-fallback',
      model: DEFAULT_EMBEDDING_MODEL,
      embeddingProvider: this.#embeddingProviderId,
      retrievalProvider: this.#retrievalProviderId,
      visualEmbeddingProviders: this.#providers.list().visualEmbedding,
    }
  }

  async embed(model: string, input: readonly string[]): Promise<number[][]> {
    const provider = this.#providers.embedding(this.#embeddingProviderId)
    if (provider === undefined) throw new Error(`Embedding provider not found: ${this.#embeddingProviderId}`)
    return provider.embed({ model, input })
  }

  async indexEntity(entity: SemanticIndexedEntityV0, model = DEFAULT_EMBEDDING_MODEL): Promise<{ readonly indexed: boolean; readonly vector: boolean }> {
    // HU-1C: late writer / tombstone guard —— entity 已删/已变则丢弃，不 resurrect。
    if (!this.repository.assertEntityAlive(entity.projectId, entity.entityType, entity.entityId)) {
      return { indexed: false, vector: false }
    }
    const contentHash = createHash('sha256').update(`${entity.title}\n${entity.body}`, 'utf8').digest('hex')
    const existing = this.repository.getSearchDocument(entity.projectId, entity.entityType, entity.entityId)
    const chunks = chunkEntity({ title: entity.title, body: entity.body })
    const existingChunks = this.repository.getSearchDocumentChunks(entity.entityId, model)
    // 完全未变（文档 hash + 块集合 hash 均一致；旧库首次会因块行缺失而触发 chunk 化重建）→ 跳过。
    const chunkPlanUnchanged = existingChunks.length === chunks.length
      && chunks.every((chunk) => existingChunks.some((row) => row.chunkIndex === chunk.chunkIndex && row.contentHash === chunk.contentHash))
    if (existing !== undefined && existing.contentHash === contentHash && chunkPlanUnchanged) {
      return { indexed: false, vector: false }
    }
    if (existing === undefined || existing.contentHash !== contentHash) {
      this.repository.upsertSearchDocument({
        id: `search-doc-${entity.entityType}-${entity.entityId}`,
        projectId: entity.projectId,
        entityType: entity.entityType,
        entityId: entity.entityId,
        title: entity.title,
        body: entity.body,
        contentHash,
        updatedAt: new Date().toISOString(),
      })
    }
    // 块元数据（分块计划）先行落库：即使 Ollama 不可用，分块也已记录，下次同内容不重复处理。
    this.repository.upsertSearchDocumentChunkPlan(entity.entityId, model, chunks)
    // per-chunk 差分增量：只重算 contentHash 变化的块。
    const changed = chunks.filter((chunk) => !existingChunks.some((row) => row.chunkIndex === chunk.chunkIndex && row.contentHash === chunk.contentHash))
    let vector = false
    if (changed.length > 0) {
      try {
        const embeddings = await this.embed(model, changed.map((chunk) => chunk.chunkText))
        const rows = changed
          .map((chunk, position) => {
            const embedding = embeddings[position]
            return embedding === undefined ? undefined : {
              chunkIndex: chunk.chunkIndex,
              dimensions: embedding.length,
              contentHash: chunk.contentHash,
              embeddingBlob: Buffer.from(new Float32Array(embedding).buffer),
              indexedAt: new Date().toISOString(),
            }
          })
          .filter((row): row is NonNullable<typeof row> => row !== undefined)
        if (rows.length > 0) {
          // HU-5 §10：晚写守卫 —— 计算期间文档已删/已变则丢弃向量，不 resurrect。
          const status = this.repository.commitSearchDocumentChunkEmbeddings({
            projectId: entity.projectId,
            entityType: entity.entityType,
            entityId: entity.entityId,
            model,
            documentHash: contentHash,
            chunks: rows,
          })
          vector = status === 'applied'
        }
      } catch {
        // Embedding provider unavailable: document stays FTS-indexed; vectors fill on a later reindex.
      }
    }
    return { indexed: true, vector }
  }

  deleteEntity(projectId: string, entityType: string, entityId: string): void {
    this.repository.deleteSearchDocument(projectId, entityType, entityId)
  }

  /**
   * F6 P0-A2（20260828）：mutation-driven reindex 入口——写路径（curation 文本保存 /
   * import / capture materialize / artifact return accept / OCR 跑完）调这里，
   * 而不是等 search-time 懒索引。幂等（contentHash 未变即跳过），失败 warn 不阻塞写。
   */
  async reindexArtifact(projectId: string, artifactId: string): Promise<void> {
    try {
      const artifact = this.repository.getArtifact(artifactId)
      if (artifact === undefined || String(artifact.projectId) !== projectId) return
      const revisionId = artifact.currentRevisionId
      const revision = revisionId === undefined ? undefined : this.repository.getArtifactRevision(revisionId)
      const fileRecord = revision?.fileRecordId === undefined ? undefined : this.repository.getFileRecord(String(revision.fileRecordId))
      const body = await readArtifactIndexBody({
        fileRecord: fileRecord === undefined ? undefined : { mimeType: fileRecord.mimeType, observedPath: fileRecord.observedPath },
        maxChars: 200_000,
        ocrEvidence: (pid, aid) => this.repository.getOcrEvidenceText(pid, aid),
        projectId,
        artifactId,
        providers: this.#providers,
      })
      await this.indexEntity({
        projectId,
        entityType: 'artifact',
        entityId: artifactId,
        title: artifact.title,
        body,
      })
    } catch (error: unknown) {
      console.warn(`[semantic] reindex failed for artifact ${artifactId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** F6 P0-A2：删除路径的索引清理（tombstone 同步，search 不再命中已删实体）。 */
  removeArtifact(projectId: string, artifactId: string): void {
    try {
      this.repository.deleteSearchDocument(projectId, 'artifact', artifactId)
    } catch (error: unknown) {
      console.warn(`[semantic] remove failed for artifact ${artifactId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * F6 P0-A1：向量检索强制 project scope。projectId 给定时（GUI 搜索路径必给），
   * sqlite-vec KNN 与 blob fallback 两条路径都不返回跨项目 hit。
   */
  async searchVectors(query: string, model = DEFAULT_EMBEDDING_MODEL, limit = 10, projectId?: string): Promise<SemanticVectorHitV0[]> {
    try {
      const [vector] = await this.embed(model, [query])
      if (vector === undefined) return []
      const provider = this.#providers.retrieval(this.#retrievalProviderId)
      if (provider === undefined) return []
      return provider.retrieve({ model, vector, limit, ...(projectId === undefined ? {} : { projectId }) })
    } catch {
      return []
    }
  }

  /**
   * 核心能力 B(FTS 路径块级化):给定文档与查询词,返回包含该词的正文块锚点;
   * 未命中正文块(如标题命中/无分块)返回 undefined,调用方按文档级命中处理。
   * 与 vector 路径的 chunkAnchor 语义一致,不依赖 Ollama。
   */
  chunkHitFor(entityId: string, needle: string): { readonly chunkAnchor: string; readonly chunkIndex: number; readonly chunkCount: number } | undefined {
    const lower = needle.toLocaleLowerCase('en-US')
    for (const chunk of this.repository.getSearchDocumentChunkPlan(entityId)) {
      if (chunk.chunkKind === 'body' && chunk.chunkText.toLocaleLowerCase('en-US').includes(lower)) {
        return { chunkAnchor: chunk.chunkAnchor, chunkIndex: chunk.chunkIndex, chunkCount: chunk.chunkCount }
      }
    }
    return undefined
  }
}
