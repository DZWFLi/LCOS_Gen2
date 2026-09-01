/**
 * /space/ 虚拟命名空间沙箱服务（任务四 P1）。
 *
 * 职责：把项目的文本 artifact 暴露成 nodes/<safeLabel>.md 虚拟路径
 * （列表带 L1 扫描头，读取带 full-read lease 记录）。
 *
 * 边界（huabu 同构纪律）：
 * - 只读。写入只走 CAS 守卫的 curation/text；本服务不提供任何写形态。
 * - allowlist 仅 nodes/**；解析只到 artifact（title→safeLabel），永不落盘。
 * - 只有文本 artifact（text/markdown、text/plain）进入命名空间；
 *   媒体节点走 resource 通道，不伪装成 .md。
 *
 * 20260827 补检索原语 search：关键词 AND 扫标题+正文前缀。
 * 搜索不记 lease——片段命中不构成「已读」，写前仍须 /space/read（诚实 CAS 边界）。
 */

import { open } from 'node:fs/promises'

import type { SpaceListResultV0, SpaceListNodeV0, SpaceReadResultV0, SpaceSearchNodeV0, SpaceSearchResultV0 } from '@local-creative-os/contracts'

import type { SessionReadSet } from './session-read-set.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import { extractAgentNodePreview } from './node-ref.js'
import { nodeSpaceRel, parseSpacePath, SPACE_VFS_PREFIX, SpaceVfsError } from './space-vfs.js'

/** 单次 read 的字符上限（huabu 是 10MB 字节；LCOS 按字符算，200k 足够任何 markdown 节点）。 */
const SPACE_READ_MAX_CHARS = 200_000
/** ls 时读取做 preview 的前缀字符数。 */
const PREVIEW_READ_CHARS = 2_000
/** search 扫描的正文前缀字符数（匹配深度与扫描成本的折中）。 */
const SEARCH_SCAN_CHARS = 50_000
/** search 片段窗口（折叠空白后）。 */
const SEARCH_SNIPPET_CHARS = 200
/** search 默认/最大返回条数。 */
const SEARCH_DEFAULT_LIMIT = 20
const SEARCH_MAX_LIMIT = 50
const TEXT_MIME = new Set(['text/markdown', 'text/plain'])

/** read 命中不了任何节点时抛出；route 映射 404。 */
export class SpacePathNotFoundError extends Error {
  constructor(rel: string) {
    super(`space path not found: ${rel} (call /space/ls to list current paths)`)
    this.name = 'SpacePathNotFoundError'
  }
}

interface SpaceNodeEntry {
  readonly rel: string
  readonly artifactId: string
  readonly title: string
  readonly revisionId: string
  readonly contentHash: string
  readonly observedPath: string | undefined
  readonly mimeType: string
  readonly viewId: string | undefined
}

export interface SpaceSandboxServiceDeps {
  readonly repository: SqliteMetadataRepository
  readonly sessionReadSet: SessionReadSet
}

async function readTextPrefix(observedPath: string | undefined, maxChars: number): Promise<string> {
  if (observedPath === undefined) return ''
  try {
    const handle = await open(observedPath, 'r')
    try {
      const buffer = Buffer.alloc(maxChars * 4 + 4)
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
      return buffer.subarray(0, bytesRead).toString('utf8').slice(0, maxChars)
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

export class SpaceSandboxService {
  constructor(private readonly deps: SpaceSandboxServiceDeps) {}

  /**
   * 构建确定性路径表：artifact 按 id 排序；同 safeLabel 冲突时
   * 后来者追加 `-<artifactId 前 8 位>` 后缀消歧（路径始终可用 /space/ls 重发现）。
   */
  async #entries(projectId: string): Promise<SpaceNodeEntry[]> {
    const graph = this.deps.repository.get(projectId)
    if (graph === undefined) throw new Error('Project not found.')
    const revisionById = new Map(graph.artifactRevisions.map((revision) => [String(revision.id), revision]))
    const fileRecordById = new Map(graph.fileRecords.map((record) => [String(record.id), record]))
    const viewsByArtifact = new Map<string, string>()
    for (const view of [...graph.artifactViews].sort((left, right) => String(left.id).localeCompare(String(right.id), 'en-US'))) {
      const artifactId = String(view.artifactId)
      if (!viewsByArtifact.has(artifactId)) viewsByArtifact.set(artifactId, String(view.id))
    }

    const taken = new Set<string>()
    const entries: SpaceNodeEntry[] = []
    const artifacts = [...graph.artifacts].sort((left, right) => String(left.id).localeCompare(String(right.id), 'en-US'))
    for (const artifact of artifacts) {
      if (artifact.currentRevisionId === undefined) continue
      const revision = revisionById.get(String(artifact.currentRevisionId))
      if (revision === undefined || String(revision.artifactId) !== String(artifact.id)) continue
      const fileRecord = fileRecordById.get(String(revision.fileRecordId))
      if (fileRecord === undefined || !TEXT_MIME.has(fileRecord.mimeType)) continue
      let rel = nodeSpaceRel(artifact.title)
      if (taken.has(rel)) {
        rel = nodeSpaceRel(`${artifact.title}-${String(artifact.id).slice(0, 8)}`)
        if (taken.has(rel)) continue
      }
      taken.add(rel)
      entries.push({
        rel,
        artifactId: String(artifact.id),
        title: artifact.title,
        revisionId: String(revision.id),
        contentHash: String(revision.contentHash),
        observedPath: fileRecord.observedPath,
        mimeType: fileRecord.mimeType,
        viewId: viewsByArtifact.get(String(artifact.id)),
      })
    }
    return entries
  }

  /** 列出命名空间全部节点（含 L1 扫描头：preview + contentHash rev token）。 */
  async list(projectId: string): Promise<SpaceListResultV0> {
    const entries = await this.#entries(projectId)
    const items: SpaceListNodeV0[] = []
    for (const entry of entries) {
      const prefix = await readTextPrefix(entry.observedPath, PREVIEW_READ_CHARS)
      const preview = extractAgentNodePreview({ content: prefix })
      items.push({
        path: `${SPACE_VFS_PREFIX}${entry.rel}`,
        artifactId: entry.artifactId,
        title: entry.title,
        revisionId: entry.revisionId,
        contentHash: entry.contentHash,
        ...(preview === undefined ? {} : { preview }),
      })
    }
    return { items, generatedAt: new Date().toISOString() }
  }

  /**
   * 按虚拟路径读取节点全文。
   * sessionId 存在且未截断 → 记 full-read lease（与 /curation/read readMode=full
   * 同一 SessionReadSet 实例，后续 curation/text 写入即通过 CAS 校验）。
   */
  async read(projectId: string, wirePath: string, sessionId?: string): Promise<SpaceReadResultV0> {
    const rel = parseSpacePath(wirePath)
    const entries = await this.#entries(projectId)
    const entry = entries.find((candidate) => candidate.rel === rel)
    if (entry === undefined) throw new SpacePathNotFoundError(rel)
    const raw = await readTextPrefix(entry.observedPath, SPACE_READ_MAX_CHARS)
    const truncated = raw.length >= SPACE_READ_MAX_CHARS
    if (sessionId !== undefined && !truncated) {
      this.deps.sessionReadSet.recordFullRead({
        sessionId,
        projectId,
        artifactId: entry.artifactId,
        revisionId: entry.revisionId,
        contentHash: entry.contentHash,
      })
    }
    return {
      path: `${SPACE_VFS_PREFIX}${entry.rel}`,
      artifactId: entry.artifactId,
      ...(entry.viewId === undefined ? {} : { viewId: entry.viewId }),
      revisionId: entry.revisionId,
      contentHash: entry.contentHash,
      content: raw,
      truncated,
    }
  }

  /**
   * 关键词检索（huabu agentic 检索的 grep 直译，20260827）：
   * 空白分词、全部命中（AND）、大小写不敏感（CJK 无词边界，子串天然可用）。
   * 标题命中排前，正文命中按命中位置排；同分按 artifactId 保稳定序。
   * 片段窗口 200 字；**不记 lease**——写前仍须 /space/read。
   */
  async search(projectId: string, query: string, limit?: number): Promise<SpaceSearchResultV0> {
    const terms = [...new Set(query.split(/\s+/).map((term) => term.trim().toLowerCase()).filter((term) => term.length > 0))]
    if (terms.length === 0) throw new SpaceVfsError({ kind: 'invalid', message: 'search query must contain at least one non-empty term.' })
    const boundedLimit = Math.max(1, Math.min(SEARCH_MAX_LIMIT, limit ?? SEARCH_DEFAULT_LIMIT))
    const entries = await this.#entries(projectId)
    const hits: { node: SpaceSearchNodeV0; rank: number }[] = []
    for (const entry of entries) {
      const lowerTitle = entry.title.toLowerCase()
      const titleHit = terms.every((term) => lowerTitle.includes(term))
      let matchedIn: 'title' | 'content' | undefined
      let snippet: string | undefined
      let rank: number | undefined
      if (titleHit) {
        matchedIn = 'title'
        rank = 0
      } else {
        const body = (await readTextPrefix(entry.observedPath, SEARCH_SCAN_CHARS)).toLowerCase()
        if (terms.every((term) => body.includes(term))) {
          matchedIn = 'content'
          const first = Math.min(...terms.map((term) => body.indexOf(term)).filter((index) => index >= 0))
          const raw = body.slice(Math.max(0, first - SEARCH_SNIPPET_CHARS / 2), first + SEARCH_SNIPPET_CHARS / 2)
          snippet = raw.replace(/\s+/g, ' ').trim()
          rank = first
        }
      }
      if (matchedIn === undefined || rank === undefined) continue
      hits.push({
        node: {
          path: `${SPACE_VFS_PREFIX}${entry.rel}`,
          artifactId: entry.artifactId,
          title: entry.title,
          revisionId: entry.revisionId,
          contentHash: entry.contentHash,
          matchedIn,
          ...(matchedIn === 'content' && snippet !== undefined ? { snippet } : {}),
        },
        rank,
      })
    }
    hits.sort((left, right) => {
      if (left.node.matchedIn !== right.node.matchedIn) return left.node.matchedIn === 'title' ? -1 : 1
      if (left.rank !== right.rank) return left.rank - right.rank
      return left.node.artifactId.localeCompare(right.node.artifactId, 'en-US')
    })
    return {
      items: hits.slice(0, boundedLimit).map((hit) => hit.node),
      scanned: entries.length,
      generatedAt: new Date().toISOString(),
    }
  }
}

export { SpaceVfsError }
