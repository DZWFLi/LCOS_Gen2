import type {
  SearchEntityRefVNext,
  SearchEntityTypeV0,
  SearchHitVNext,
  SearchLocationRefVNext,
  SearchMatchModalityVNext,
  SearchMatchReasonVNext,
  SearchResultVNext,
} from '@local-creative-os/contracts'
import { open } from 'node:fs/promises'

import type { ConversationImportService } from './conversation-import-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { SemanticIndexService } from './semantic-index-service.js'
import { readArtifactIndexBody } from './search-artifact-body.js'

const SNIPPET_CHARS = 160

/**
 * F6 P0-A2：search-time 懒索引从「进程内一次性」降级为「stale/missing repair」。
 * mutation 挂点（curation/import/capture/accept/OCR）是主索引入口；这里的周期重扫
 * 只兜 mutation 挂点遗漏的存量（如旧库升级），TTL 内不重复扫。
 */
const ENSURE_REPAIR_TTL_MS = 2_000

/** locationRefs 投影上限（read projection，只取前几个位置）。 */
const LOCATION_REFS_LIMIT = 5

/** source → matchReason 映射（F6 P0-A4：让 GUI 能说「为什么搜到它」）。 */
const SOURCE_TO_MATCH_REASON: Readonly<Record<string, SearchMatchReasonVNext>> = {
  'artifact-title': 'title',
  'artifact-text': 'body',
  note: 'metadata',
  'conversation-fts': 'body',
  'resource-title': 'title',
  'descriptor-summary': 'source',
  'search-document-fts': 'body',
  'search-document-ocr': 'ocr',
  vector: 'semantic',
  related: 'relation',
}

const REASON_TO_MODALITY: Readonly<Record<SearchMatchReasonVNext, SearchMatchModalityVNext>> = {
  title: 'text',
  body: 'text',
  ocr: 'ocr',
  visual: 'visual',
  semantic: 'semantic',
  source: 'text',
  relation: 'graph',
  metadata: 'text',
}

function snippetFrom(text: string, query: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const index = normalized.toLocaleLowerCase('en-US').indexOf(query.toLocaleLowerCase('en-US'))
  if (index < 0) return normalized.slice(0, SNIPPET_CHARS)
  const start = Math.max(0, index - 40)
  return `${start > 0 ? '…' : ''}${normalized.slice(start, start + SNIPPET_CHARS)}${start + SNIPPET_CHARS < normalized.length ? '…' : ''}`
}

async function readTextPrefix(observedPath: string | undefined, maxChars: number): Promise<string> {
  if (observedPath === undefined) return ''
  try {
    const handle = await open(observedPath, 'r')
    try {
      const buffer = Buffer.alloc(maxChars * 4 + 4)
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

export interface ProjectSearchOptions {
  readonly limit?: number
  readonly types?: readonly SearchEntityTypeV0[]
  readonly related?: boolean
  /** F6 P0-A4：给定时对每个 hit 计算 usedHere（read projection）。 */
  readonly usedHereTarget?: { readonly kind: 'workspace' | 'scope' | 'conversation'; readonly id: string }
}

/**
 * Phase D: federated search over existing sources — no new search DB.
 * Ranking V0 (simple, explicit): exact title/phrase > text artifact > note >
 * conversation FTS > resource title > descriptor summary.
 */
export class ProjectSearchService {
  /** 懒索引 repair 幂等缓存：项目 → 上次全量 repair 时间戳（TTL 内跳过）。 */
  readonly #ensuredAt = new Map<string, number>()

  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly conversations: ConversationImportService | undefined,
    private readonly semantic: SemanticIndexService | undefined,
  ) {}

  async search(projectId: string, query: string, options: ProjectSearchOptions = {}): Promise<SearchResultVNext> {
    const limit = Math.max(1, Math.min(50, options.limit ?? 10))
    const types = new Set(options.types ?? ['artifact', 'note', 'conversation', 'resource'])
    const seen = new Set<string>()
    const needle = query.trim().toLocaleLowerCase('en-US')
    const hits: SearchHitVNext[] = []
    const push = (hit: SearchHitVNext): void => {
      // Derived-document hits may duplicate legacy sources for the same entity;
      // they are collected separately and deduped by entity at the end (best score wins).
      const key = hit.source === 'search-document-fts' || hit.source === 'vector'
        ? `${hit.source}:${hit.entityType}:${hit.entityId}`
        : `${hit.entityType}:${hit.entityId}`
      if (seen.has(key)) return
      seen.add(key)
      hits.push(hit)
    }
    if (needle === '') {
      return { schemaVersion: 0, query, hits: [], truncated: false, generatedAt: new Date().toISOString() }
    }

    const exactPhrase = (text: string): boolean => text.toLocaleLowerCase('en-US').includes(needle)

    // 核心能力 B 接线:RAG chunking 懒索引——存量/导入的 artifact 首次被搜索时触发
    // indexEntity(分块计划先行落库;Ollama 缺席时 FTS-only,不阻塞搜索)。
    // F6 P0-A2：主入口已移到 mutation 挂点，此处降级为 TTL repair（见 ENSURE_REPAIR_TTL_MS）。
    if (types.has('artifact')) await this.#ensureProjectIndexed(projectId)

    // Artifact title + text content
    if (types.has('artifact')) {
      for (const artifact of this.repository.getArtifacts(projectId)) {
        const exactTitle = artifact.title.toLocaleLowerCase('en-US') === needle
        const titleMatch = exactPhrase(artifact.title)
        const viewId = this.repository.getArtifactViews(String(artifact.id))[0]?.id
        const base = {
          entityType: 'artifact' as const,
          entityId: artifact.id,
          ...(viewId === undefined ? {} : { viewId }),
          title: artifact.title,
        }
        if (exactTitle) {
          push({ ...base, snippet: artifact.title, source: 'artifact-title', score: 100 })
        } else if (titleMatch) {
          push({ ...base, snippet: artifact.title, source: 'artifact-title', score: 80 })
        } else {
          const revisionId = artifact.currentRevisionId
          const revision = revisionId === undefined ? undefined : this.repository.getArtifactRevision(revisionId)
          const fileRecord = revision?.fileRecordId === undefined ? undefined : this.repository.getFileRecord(String(revision.fileRecordId))
          if (fileRecord?.mimeType === 'text/markdown' || fileRecord?.mimeType === 'text/plain') {
            const content = await readTextPrefix(fileRecord.observedPath, 8_000)
            if (exactPhrase(content)) {
              push({ ...base, snippet: snippetFrom(content, query), source: 'artifact-text', score: 50, ...(this.semantic?.chunkHitFor(String(artifact.id), needle) ?? {}) })
            }
          }
        }
      }
    }

    // Notes
    if (types.has('note')) {
      for (const note of this.repository.getNotes(projectId)) {
        if (!exactPhrase(note.body)) continue
        push({ entityType: 'note', entityId: note.id, title: note.body.slice(0, 60), snippet: snippetFrom(note.body, query), source: 'note', score: 50 })
      }
    }

    // Conversation FTS
    if (types.has('conversation') && this.conversations !== undefined) {
      const conversationHits = await this.conversations.search(projectId, query, { limit: 20 })
      for (const hit of conversationHits) {
        push({ entityType: 'conversation', entityId: hit.message.sessionId, title: hit.sessionTitle, snippet: snippetFrom(hit.message.contentText, query), source: 'conversation-fts', score: 40 })
      }
    }

    // Resource title + descriptor summary
    if (types.has('resource')) {
      for (const descriptor of this.repository.listResourceDescriptors(projectId)) {
        const title = descriptor.display.title
        const summary = descriptor.display.subtitle ?? ''
        if (exactPhrase(title)) {
          push({ entityType: 'resource', entityId: String(descriptor.resourceId), title, snippet: title, source: 'resource-title', score: 60 })
        } else if (exactPhrase(summary)) {
          push({ entityType: 'resource', entityId: String(descriptor.resourceId), title, snippet: snippetFrom(summary, query), source: 'descriptor-summary', score: 20 })
        }
      }
    }

    // Derived search_documents FTS (Phase G): artifacts/notes/resources indexed by SemanticIndexService.
    const docHits = this.repository.searchDocumentsFts(projectId, query, 20)
    for (const doc of docHits) {
      // 核心能力 B:FTS 命中块级化——正文块含查询词时带 chunkAnchor(块级命中),
      // 标题命中保持文档级(无 anchor);无 Ollama 环境同样可区分两级。
      const chunk = this.semantic?.chunkHitFor(doc.entityId, needle)
      push({
        entityType: 'artifact',
        entityId: doc.entityId,
        title: doc.title,
        snippet: snippetFrom(doc.body, query),
        source: 'search-document-fts',
        score: 35,
        ...(chunk ?? {}),
      })
    }

    // Vector candidates (available only when Ollama + embeddings exist).
    // F6 P0-A1：向量路径强制 project scope——A 项目的查询绝不返回 B 项目的向量 hit。
    if (this.semantic !== undefined) {
      const vectorHits = await this.semantic.searchVectors(query, undefined, 10, projectId)
      for (const hit of vectorHits) {
        push({
          entityType: 'artifact',
          entityId: hit.entityId,
          title: hit.documentTitle ?? hit.entityId,
          snippet: hit.chunkText !== undefined ? snippetFrom(hit.chunkText, query) : `vector distance ${hit.distance.toFixed(3)}`,
          source: 'vector',
          score: 45,
          // 核心能力 B：正文块命中 = 块级（带 chunkAnchor，语义同 sourceAnchor）；
          // 标题块命中 = 文档级（无 chunkAnchor），两者可区分。
          ...(hit.chunkAnchor === undefined ? {} : { chunkAnchor: hit.chunkAnchor, chunkIndex: hit.chunkIndex, chunkCount: hit.chunkCount }),
        })
      }
    }

    // Related expansion (G8): seeds top 10 → 1-hop neighbors, ≤5 per seed.
    if (options.related === true) {
      const seeds = [...hits].sort((left, right) => right.score - left.score).slice(0, 10)
      for (const seed of seeds) {
        const neighbors = this.repository.getRelations(projectId)
          .filter((relation) => String(relation.sourceEntityId) === seed.entityId || String(relation.targetEntityId) === seed.entityId)
          .slice(0, 5)
        for (const relation of neighbors) {
          const otherId = String(relation.sourceEntityId) === seed.entityId ? String(relation.targetEntityId) : String(relation.sourceEntityId)
          push({ entityType: 'artifact', entityId: otherId, title: otherId, snippet: `related via ${relation.kind}`, source: 'related', score: 15 })
        }
      }
    }

    const ranked = hits.sort((left, right) => right.score - left.score).slice(0, limit * 3)
    const deduped: SearchHitVNext[] = []
    const finalSeen = new Set<string>()
    for (const hit of ranked) {
      const key = `${hit.entityType}:${hit.entityId}`
      if (finalSeen.has(key)) continue
      finalSeen.add(key)
      deduped.push(hit)
      if (deduped.length >= limit) break
    }
    // F6 P0-A4：vNext 字段投影（entityRef / matchReason / matchModality / sourceAnchor /
    // locationRefs / usedHere）——全部 read projection，不改任何 Truth。
    const enriched = deduped.map((hit) => this.#enrichHit(projectId, hit, options.usedHereTarget))
    return {
      schemaVersion: 0,
      query,
      hits: enriched,
      truncated: hits.length > limit,
      generatedAt: new Date().toISOString(),
    }
  }

  /** vNext 字段投影：matchReason/matchModality/entityRef/sourceAnchor/location/usedHere。 */
  #enrichHit(projectId: string, hit: SearchHitVNext, usedHereTarget?: { readonly kind: 'workspace' | 'scope' | 'conversation'; readonly id: string }): SearchHitVNext {
    const matchReason = SOURCE_TO_MATCH_REASON[hit.source] ?? 'metadata'
    const entityRef: SearchEntityRefVNext = {
      type: hit.entityType,
      id: String(hit.entityId),
      ...(hit.viewId === undefined ? {} : { viewId: hit.viewId }),
    }
    let locationRefs: readonly SearchLocationRefVNext[] | undefined
    let locationCount: number | undefined
    if (hit.entityType === 'artifact') {
      const locations = this.#locationsForArtifact(projectId, String(hit.entityId))
      locationCount = locations.length
      locationRefs = locations.slice(0, LOCATION_REFS_LIMIT)
    }
    let usedHere: boolean | undefined
    if (usedHereTarget !== undefined && usedHereTarget.kind === 'workspace' && hit.entityType === 'artifact') {
      usedHere = this.#locationsForArtifact(projectId, String(hit.entityId))
        .some((location) => location.id === usedHereTarget.id)
    }
    return {
      ...hit,
      entityRef,
      matchReason,
      matchModality: REASON_TO_MODALITY[matchReason],
      ...(hit.chunkAnchor === undefined ? {} : { sourceAnchor: hit.chunkAnchor }),
      ...(locationRefs === undefined ? {} : { locationRefs }),
      ...(locationCount === undefined ? {} : { locationCount }),
      ...(usedHere === undefined ? {} : { usedHere }),
    }
  }

  /** artifact → 画布位置投影（workspace memberships → read projection，不新建 Truth）。 */
  #locationsForArtifact(projectId: string, artifactId: string): readonly SearchLocationRefVNext[] {
    try {
      const viewIds = new Set(this.repository.getArtifactViews(artifactId).map((view) => String(view.id)))
      const locations: SearchLocationRefVNext[] = []
      for (const membership of this.repository.listProjectWorkspaceMemberships(projectId as never)) {
        if (!viewIds.has(String(membership.artifactViewId))) continue
        const workspace = this.repository.getWorkspace(String(membership.workspaceId))
        locations.push({
          kind: 'workspace',
          id: String(membership.workspaceId),
          ...(workspace === undefined ? {} : { name: workspace.name }),
        })
      }
      return locations
    } catch {
      return []
    }
  }

  /** 读取 artifact 当前正文(共享读取层:md/plain 直读、PDF 页文本、图片 OCR evidence)。 */
  async #artifactBody(artifact: ReturnType<SqliteMetadataRepository['getArtifacts']>[number]): Promise<string> {
    const revisionId = artifact.currentRevisionId
    const revision = revisionId === undefined ? undefined : this.repository.getArtifactRevision(revisionId)
    const fileRecord = revision?.fileRecordId === undefined ? undefined : this.repository.getFileRecord(String(revision.fileRecordId))
    return readArtifactIndexBody({
      fileRecord: fileRecord === undefined ? undefined : { mimeType: fileRecord.mimeType, observedPath: fileRecord.observedPath },
      maxChars: 200_000,
      ocrEvidence: (pid, aid) => this.repository.getOcrEvidenceText(pid, aid),
      projectId: String(artifact.projectId),
      artifactId: String(artifact.id),
      ...(this.semantic === undefined ? {} : { providers: this.semantic.providers() }),
    })
  }

  /**
   * 核心能力 B 接线:项目 artifact 的 RAG 分块索引懒接线——首次搜索时补建索引,
   * indexEntity 自带幂等(contentHash 未变即跳过);进程级缓存避免每次搜索重复扫全项目。
   * F6 P0-A2：从「每项目一次」改为 TTL repair——mutation 挂点是主入口，
   * 这里只兜存量/旧库（导入新 artifact 后不重启，下一次搜索（TTL 过期后）即可命中）。
   */
  async #ensureProjectIndexed(projectId: string): Promise<void> {
    if (this.semantic === undefined) return
    const now = Date.now()
    const last = this.#ensuredAt.get(projectId)
    if (last !== undefined && now - last < ENSURE_REPAIR_TTL_MS) return
    this.#ensuredAt.set(projectId, now)
    for (const artifact of this.repository.getArtifacts(projectId)) {
      try {
        const body = await this.#artifactBody(artifact)
        await this.semantic.indexEntity({
          projectId,
          entityType: 'artifact',
          entityId: String(artifact.id),
          title: artifact.title,
          body,
        })
      } catch {
        // 单个 artifact 索引失败不阻塞搜索(FTS 标题/artifact-text 路径仍可用)。
      }
    }
  }
}
