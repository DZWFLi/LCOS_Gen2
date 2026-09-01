import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { appendFile, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import readline from 'node:readline'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import type {
  AnnotateConversationSectionInputV1,
  BuildConversationSemanticIndexInputV1,
  CompleteConversationImportInputV1,
  CompleteConversationImportResultV1,
  ConversationExportV1,
  ConversationFileReferenceV1,
  ConversationImportSessionV1,
  ConversationMessageV1,
  ConversationProjectionV1,
  ConversationSearchHitV1,
  ConversationSectionAnnotationV1,
  ConversationSectionV1,
  ConversationSemanticIndexStatusV1,
  ConversationSessionV1,
  CreateConversationImportSessionInputV1,
  PinConversationMessageInputV1,
  ImportManualConversationInputV1,
} from '@local-creative-os/contracts'
import type { ProjectId, Relation } from '@local-creative-os/domain'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import { createTextArtifact } from './text-artifact-service.js'

type Row = Record<string, SQLInputValue | undefined>

const MAX_CHUNK_BYTES = 4 * 1024 * 1024
const MAX_IMPORT_BYTES = 512 * 1024 * 1024
const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
const DEFAULT_EMBEDDING_MODEL = process.env.LCOS_OLLAMA_EMBED_MODEL ?? 'nomic-embed-text'
const EMBEDDING_INDEX_VERSION = 'message-v1'
const EMBEDDING_TEXT_LIMITS: Readonly<Record<ConversationMessageV1['role'], number>> = {
  user: 12_000,
  assistant: 12_000,
  tool: 3_000,
  system: 4_000,
  event: 1_500,
}

function now(): string { return new Date().toISOString() }
function json<T>(value: SQLInputValue | undefined, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}
function sha256(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex') }
function sanitizeFileName(value: string): string {
  const name = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 120)
  return name || 'conversation.jsonl'
}
function compactText(value: string, limit = 120): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, limit)
}
function embeddingTextFor(input: {
  readonly role: ConversationMessageV1['role']
  readonly eventKind: string
  readonly toolName?: string
  readonly contentText: string
}): string {
  const normalized = input.contentText.replace(/\r\n/g, '\n').replace(/[\t ]+/g, ' ').trim()
  const limited = normalized.slice(0, EMBEDDING_TEXT_LIMITS[input.role])
  return [
    `role:${input.role}`,
    `event:${input.eventKind}`,
    ...(input.toolName ? [`tool:${input.toolName}`] : []),
    limited,
  ].join('\n')
}
function embeddingInputHash(input: {
  readonly role: ConversationMessageV1['role']
  readonly eventKind: string
  readonly toolName?: string
  readonly contentText: string
}): string {
  return sha256(`${EMBEDDING_INDEX_VERSION}\n${embeddingTextFor(input)}`)
}
function firstMeaningfulLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? ''
}
function normalizeRole(value: unknown): ConversationMessageV1['role'] {
  if (value === 'user') return 'user'
  if (value === 'assistant') return 'assistant'
  if (value === 'system' || value === 'developer') return 'system'
  if (value === 'tool' || value === 'function') return 'tool'
  return 'event'
}
function collectText(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return []
  if (typeof value === 'string') return value.trim() ? [value] : []
  if (Array.isArray(value)) return value.flatMap((item) => collectText(item, depth + 1))
  if (typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const directKeys = ['text', 'message', 'content', 'output', 'input', 'summary']
  const output: string[] = []
  for (const key of directKeys) {
    if (key in record) output.push(...collectText(record[key], depth + 1))
  }
  return output
}
function eventId(value: Record<string, unknown>): string | undefined {
  const payload = typeof value.payload === 'object' && value.payload !== null ? value.payload as Record<string, unknown> : undefined
  for (const candidate of [payload?.id, payload?.client_id, value.id]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}
function timestamp(value: Record<string, unknown>, fallback: string): string {
  const payload = typeof value.payload === 'object' && value.payload !== null ? value.payload as Record<string, unknown> : undefined
  for (const candidate of [value.timestamp, payload?.timestamp, payload?.created_at]) {
    if (typeof candidate === 'string' && !Number.isNaN(Date.parse(candidate))) return new Date(candidate).toISOString()
  }
  return fallback
}
function parseCodexEvent(value: Record<string, unknown>): {
  role: ConversationMessageV1['role']
  eventKind: string
  contentText: string
  toolName?: string
  toolCall?: Record<string, unknown>
  sourceEventId?: string
  originMeta?: Record<string, unknown>
} | undefined {
  const outerType = typeof value.type === 'string' ? value.type : 'event'
  const payload = typeof value.payload === 'object' && value.payload !== null ? value.payload as Record<string, unknown> : {}
  const payloadType = typeof payload.type === 'string' ? payload.type : outerType
  const sourceEventId = eventId(value)
  if (outerType === 'session_meta') {
    return {
      role: 'system',
      eventKind: 'session_meta',
      contentText: '',
      ...(sourceEventId === undefined ? {} : { sourceEventId }),
      originMeta: payload,
    }
  }
  if (payloadType === 'message') {
    const contentText = collectText(payload.content).join('\n').trim()
    if (!contentText) return undefined
    return { role: normalizeRole(payload.role), eventKind: 'message', contentText, ...(sourceEventId === undefined ? {} : { sourceEventId }) }
  }
  if (payloadType === 'user_message' || payloadType === 'agent_message') {
    const contentText = collectText(payload.message ?? payload.content).join('\n').trim()
    if (!contentText) return undefined
    return { role: payloadType === 'user_message' ? 'user' : 'assistant', eventKind: payloadType, contentText, ...(sourceEventId === undefined ? {} : { sourceEventId }) }
  }
  if (['function_call', 'function_call_output', 'tool_call', 'tool_result', 'mcp_tool_call'].includes(payloadType)) {
    const toolName = typeof payload.name === 'string' ? payload.name : typeof payload.tool_name === 'string' ? payload.tool_name : payloadType
    const contentText = collectText(payload).join('\n').trim() || JSON.stringify(payload)
    return { role: 'tool', eventKind: payloadType, contentText, toolName, toolCall: payload, ...(sourceEventId === undefined ? {} : { sourceEventId }) }
  }
  if (outerType === 'response_item' && payloadType === 'reasoning') {
    const contentText = collectText(payload.summary).join('\n').trim()
    if (!contentText) return undefined
    return { role: 'event', eventKind: 'reasoning_summary', contentText, ...(sourceEventId === undefined ? {} : { sourceEventId }) }
  }
  if (outerType === 'compacted' || payloadType === 'compacted') {
    const contentText = collectText(payload).join('\n').trim() || 'Conversation context compacted.'
    return { role: 'event', eventKind: 'compacted', contentText, ...(sourceEventId === undefined ? {} : { sourceEventId }) }
  }
  const contentText = collectText(payload).join('\n').trim()
  if (!contentText) return undefined
  return { role: 'event', eventKind: payloadType, contentText, ...(sourceEventId === undefined ? {} : { sourceEventId }) }
}
function extractFileReferenceCandidates(content: string): string[] {
  const candidates = new Set<string>()
  const patterns = [
    /(?:[A-Za-z]:\\[^\s\n\r"'<>|]+(?:\.[A-Za-z0-9_-]{1,10})?)/g,
    /(?:\/(?:[^\s\n\r"'<>]+\/)*[^\s\n\r"'<>]+\.[A-Za-z0-9_-]{1,10})/g,
    /`([^`\n]+\.[A-Za-z0-9_-]{1,10})`/g,
  ]
  const excludedSchemes = /^(?:https?|mcp|ui|plugin|data|blob):\/\//i
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const candidate = (match[1] ?? match[0] ?? '').replace(/[),.;:]+$/g, '')
      if (candidate.length <= 2 || candidate.length >= 1024 || excludedSchemes.test(candidate)) continue
      candidates.add(candidate)
      if (candidates.size >= 32) return [...candidates]
    }
  }
  return [...candidates]
}
function vectorToBlob(vector: readonly number[]): Buffer {
  const array = new Float32Array(vector)
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength)
}
function blobToVector(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength))
}
function cosineDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 1
  let dot = 0; let na = 0; let nb = 0
  for (let index = 0; index < a.length; index += 1) {
    const av = Number(a[index] ?? 0); const bv = Number(b[index] ?? 0)
    dot += av * bv; na += av * av; nb += bv * bv
  }
  if (na === 0 || nb === 0) return 1
  return 1 - dot / Math.sqrt(na * nb)
}
function isInside(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export class ConversationImportService {
  readonly #repository: SqliteMetadataRepository
  readonly #database: DatabaseSync
  readonly #stagingRoot: string
  readonly #ollamaUrl: string
  readonly #vectorExtensionPath: string | undefined
  #vectorLoaded = false
  #vectorLoadError: string | undefined
  #closed = false
  readonly #activeEmbeddingJobs = new Map<string, Promise<ConversationSemanticIndexStatusV1>>()

  constructor(repository: SqliteMetadataRepository, options: {
    readonly stagingRoot?: string
    readonly ollamaUrl?: string
    readonly vectorExtensionPath?: string
  } = {}) {
    this.#repository = repository
    this.#database = new DatabaseSync(repository.databasePath, { allowExtension: true })
    this.#database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.#stagingRoot = resolve(options.stagingRoot ?? `${repository.databasePath}.conversation-imports`)
    this.#ollamaUrl = options.ollamaUrl ?? process.env.LCOS_OLLAMA_URL ?? DEFAULT_OLLAMA_URL
    const repoRoot = process.env.LCOS_REPO_ROOT
    const runtimeCandidates = repoRoot === undefined ? [] : [
      join(resolve(repoRoot), '.runtime', 'sqlite-vec', process.platform === 'win32' ? 'vec0.dll' : process.platform === 'darwin' ? 'vec0.dylib' : 'vec0.so'),
      join(resolve(repoRoot), '.runtime', 'sqlite-vec', process.platform === 'win32' ? 'sqlite-vec.dll' : process.platform === 'darwin' ? 'sqlite-vec.dylib' : 'sqlite-vec.so'),
    ]
    this.#vectorExtensionPath = options.vectorExtensionPath ?? process.env.LCOS_SQLITE_VEC_EXTENSION ?? runtimeCandidates.find((candidate) => existsSync(candidate))
    this.#tryLoadVectorExtension()
    this.#backfillEmbeddingInputs()
    this.#recoverInterruptedEmbeddingJobs()
    const pending = Number((this.#database.prepare(`SELECT COUNT(*) AS count FROM conversation_embedding_jobs WHERE status='pending'`).get() as Row).count)
    if (pending > 0) queueMicrotask(() => { if (!this.#closed) void this.#resumePendingEmbeddingJobs() })
  }

  close(): void { this.#closed = true; this.#database.close() }

  async importManual(projectId: string, input: ImportManualConversationInputV1): Promise<CompleteConversationImportResultV1> {
    if (input.entries.length < 1 || input.entries.length > 50_000) throw new Error('Manual conversation must contain 1–50,000 entries.')
    const jsonl = input.entries.map((entry, index) => JSON.stringify({
      type: 'event_msg',
      timestamp: entry.createdAt ?? new Date(Date.now() + index).toISOString(),
      payload: entry.role === 'user'
        ? { type: 'user_message', message: entry.contentText }
        : entry.role === 'assistant'
          ? { type: 'agent_message', message: entry.contentText }
          : entry.role === 'tool'
            ? { type: 'tool_result', name: entry.toolName ?? 'manual_tool', content: entry.contentText }
            : { type: 'message', role: 'system', content: [{ type: 'input_text', text: entry.contentText }] },
    })).join('\n') + '\n'
    const bytes = Buffer.from(jsonl, 'utf8')
    const upload = await this.createImportSession(projectId, {
      sourceKind: 'manual',
      ...(input.title === undefined ? {} : { title: input.title }),
      sourceFileName: 'manual-conversation.jsonl',
      expectedBytes: bytes.byteLength,
      scopeId: input.scopeId,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    })
    await this.appendChunk(projectId, upload.id, 0, bytes, sha256(bytes))
    return this.completeImport(projectId, upload.id, { expectedChunks: 1, expectedContentHash: sha256(bytes) })
  }

  async createImportSession(projectId: string, input: CreateConversationImportSessionInputV1): Promise<ConversationImportSessionV1> {
    if (this.#repository.getProject(projectId) === undefined) throw new Error('Project not found.')
    if (!['codex', 'manual'].includes(input.sourceKind)) throw new Error('当前版本只支持 Codex JSONL 和手动时间线；ChatGPT / Claude 解析器需要真实导出样本后接入。')
    if (!input.scopeId) throw new Error('scopeId is required.')
    const expectedBytes = input.expectedBytes
    if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes < 0 || expectedBytes > MAX_IMPORT_BYTES)) {
      throw new Error('Conversation import is limited to 512 MiB.')
    }
    const id = `conversation-upload-${randomUUID()}`
    const createdAt = now()
    const stagingPath = join(this.#stagingRoot, id)
    await mkdir(stagingPath, { recursive: true })
    this.#database.prepare(`
      INSERT INTO conversation_import_sessions (
        id, project_id, source_kind, title, source_file_name, expected_bytes,
        received_bytes, received_chunks, workspace_id, scope_id, status,
        staging_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'receiving', ?, ?, ?)
    `).run(
      id, projectId, input.sourceKind, input.title?.trim() || input.sourceFileName,
      sanitizeFileName(input.sourceFileName), expectedBytes ?? null,
      input.workspaceId ?? null, input.scopeId, stagingPath, createdAt, createdAt,
    )
    return this.getImportSession(projectId, id)!
  }

  getImportSession(projectId: string, id: string): ConversationImportSessionV1 | undefined {
    const row = this.#database.prepare('SELECT * FROM conversation_import_sessions WHERE id = ? AND project_id = ?').get(id, projectId) as Row | undefined
    return row === undefined ? undefined : this.#mapImportSession(row)
  }

  async appendChunk(projectId: string, importSessionId: string, chunkIndex: number, bytes: Buffer, expectedHash?: string): Promise<ConversationImportSessionV1> {
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) throw new Error('chunkIndex must be a non-negative integer.')
    if (bytes.length === 0 || bytes.length > MAX_CHUNK_BYTES) throw new Error('Each conversation chunk must be 1 byte to 4 MiB.')
    const session = this.getImportSession(projectId, importSessionId)
    if (session === undefined) throw new Error('Conversation import session not found.')
    if (session.status !== 'receiving') throw new Error('Conversation import session is not receiving chunks.')
    const hash = sha256(bytes)
    if (expectedHash !== undefined && hash !== expectedHash.toLowerCase()) throw new Error('Conversation chunk hash mismatch.')
    const row = this.#database.prepare('SELECT staging_path FROM conversation_import_sessions WHERE id = ?').get(importSessionId) as Row
    const chunkPath = join(String(row.staging_path), `${String(chunkIndex).padStart(8, '0')}.chunk`)
    const existing = this.#database.prepare('SELECT size, content_hash FROM conversation_import_chunks WHERE import_session_id = ? AND chunk_index = ?').get(importSessionId, chunkIndex) as Row | undefined
    if (existing !== undefined) {
      if (Number(existing.size) !== bytes.length || String(existing.content_hash) !== hash) throw new Error('Chunk index was already used with different content.')
      return session
    }
    await writeFile(chunkPath, bytes, { flag: 'wx' })
    const updatedAt = now()
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      this.#database.prepare(`INSERT INTO conversation_import_chunks VALUES (?, ?, ?, ?, ?, ?)`)
        .run(importSessionId, chunkIndex, bytes.length, hash, chunkPath, updatedAt)
      this.#database.prepare(`
        UPDATE conversation_import_sessions
        SET received_bytes = received_bytes + ?, received_chunks = received_chunks + 1, updated_at = ?
        WHERE id = ? AND project_id = ?
      `).run(bytes.length, updatedAt, importSessionId, projectId)
      const total = Number((this.#database.prepare('SELECT received_bytes AS total FROM conversation_import_sessions WHERE id = ?').get(importSessionId) as Row).total)
      if (total > MAX_IMPORT_BYTES) throw new Error('Conversation import exceeds 512 MiB.')
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      await rm(chunkPath, { force: true }).catch(() => {})
      throw error
    }
    return this.getImportSession(projectId, importSessionId)!
  }

  async completeImport(projectId: string, importSessionId: string, input: CompleteConversationImportInputV1): Promise<CompleteConversationImportResultV1> {
    const upload = this.getImportSession(projectId, importSessionId)
    if (upload === undefined) throw new Error('Conversation import session not found.')
    if (upload.status === 'ready') {
      const completed = this.#database.prepare('SELECT conversation_id FROM conversation_import_sessions WHERE id=? AND project_id=?').get(importSessionId, projectId) as Row | undefined
      if (completed?.conversation_id) return this.completeResult(String(completed.conversation_id))
      throw new Error('Completed conversation import lost its result identity.')
    }
    if (upload.status !== 'receiving' && upload.status !== 'failed') throw new Error('Conversation import is already being parsed.')
    if (!Number.isInteger(input.expectedChunks) || input.expectedChunks <= 0) throw new Error('expectedChunks must be positive.')
    const chunkRows = this.#database.prepare('SELECT * FROM conversation_import_chunks WHERE import_session_id = ? ORDER BY chunk_index').all(importSessionId) as Row[]
    if (chunkRows.length !== input.expectedChunks) throw new Error(`Expected ${input.expectedChunks} chunks but received ${chunkRows.length}.`)
    for (let index = 0; index < chunkRows.length; index += 1) {
      if (Number(chunkRows[index]?.chunk_index) !== index) throw new Error(`Missing chunk ${index}.`)
    }
    const uploadRow = this.#database.prepare('SELECT * FROM conversation_import_sessions WHERE id = ?').get(importSessionId) as Row
    const combinedPath = join(String(uploadRow.staging_path), 'combined.jsonl.partial')
    await rm(combinedPath, { force: true })
    const hash = createHash('sha256')
    for (const row of chunkRows) {
      const bytes = await readFile(String(row.chunk_path))
      hash.update(bytes)
      await appendFile(combinedPath, bytes)
    }
    const sourceContentHash = hash.digest('hex')
    if (input.expectedContentHash !== undefined && input.expectedContentHash.toLowerCase() !== sourceContentHash) throw new Error('Conversation file hash mismatch.')
    const duplicate = this.#database.prepare("SELECT id FROM conversation_sessions WHERE project_id = ? AND source_content_hash = ? AND status='ready'").get(projectId, sourceContentHash) as Row | undefined
    if (duplicate !== undefined) {
      this.#database.prepare("UPDATE conversation_import_sessions SET status='ready', conversation_id=?, updated_at=? WHERE id=?").run(String(duplicate.id), now(), importSessionId)
      return this.completeResult(String(duplicate.id))
    }
    this.#database.prepare("UPDATE conversation_import_sessions SET status='parsing', last_error=NULL, updated_at=? WHERE id=?").run(now(), importSessionId)
    try {
      const result = await this.#parseAndPersist(projectId, upload, combinedPath, sourceContentHash)
      this.#database.prepare("UPDATE conversation_import_sessions SET status='ready', conversation_id=?, updated_at=? WHERE id=?").run(result.session.id, now(), importSessionId)
      await rm(String(uploadRow.staging_path), { recursive: true, force: true })
      return result
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
      if (code !== 'CONVERSATION_IMPORT_IN_PROGRESS') {
        await this.#cleanupIncompleteConversation(projectId, sourceContentHash)
      }
      this.#database.prepare("UPDATE conversation_import_sessions SET status='failed', last_error=?, updated_at=? WHERE id=?")
        .run(error instanceof Error ? error.message : 'Conversation import failed.', now(), importSessionId)
      throw error
    }
  }

  list(projectId: string): ConversationSessionV1[] {
    return (this.#database.prepare('SELECT * FROM conversation_sessions WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as Row[]).map((row) => this.#mapSession(row))
  }

  exportConversation(projectId: string, conversationId: string, includeMessages = true): ConversationExportV1 {
    const projection = this.getProjection(projectId, conversationId)
    if (projection === undefined) throw new Error('Conversation not found.')
    return {
      schemaVersion: 1,
      exportedAt: now(),
      session: projection.session,
      sections: projection.sections,
      pinnedDecisions: projection.pinnedDecisions,
      ...(includeMessages ? { messages: this.getMessages(conversationId, { limit: 500000 }) } : {}),
      source: {
        kind: projection.session.sourceKind,
        ...(projection.session.sourceContentHash ? { contentHash: projection.session.sourceContentHash } : {}),
        ...(projection.session.sourceFileName ? { fileName: projection.session.sourceFileName } : {}),
        rawTimelineIncluded: includeMessages,
      },
    }
  }

  getProjection(projectId: string, conversationId: string): ConversationProjectionV1 | undefined {
    const row = this.#database.prepare('SELECT * FROM conversation_sessions WHERE id = ? AND project_id = ?').get(conversationId, projectId) as Row | undefined
    if (row === undefined) return undefined
    return {
      session: this.#mapSession(row),
      sections: this.getSections(conversationId),
      pinnedDecisions: this.getMessages(conversationId, { pinnedOnly: true, limit: 100 }),
      recentMessages: this.getMessages(conversationId, { offset: Math.max(0, Number(row.message_count) - 50), limit: 50 }),
      semanticIndex: this.getSemanticIndexStatus(projectId),
    }
  }

  getMessages(conversationId: string, input: { readonly offset?: number; readonly limit?: number; readonly pinnedOnly?: boolean } = {}): ConversationMessageV1[] {
    const offset = Math.max(0, Math.floor(input.offset ?? 0))
    const limit = Math.min(250_000, Math.max(1, Math.floor(input.limit ?? 100)))
    const rows = this.#database.prepare(`
      SELECT * FROM conversation_messages
      WHERE session_id = ? ${input.pinnedOnly ? 'AND pinned_as_decision = 1' : ''}
      ORDER BY seq LIMIT ? OFFSET ?
    `).all(conversationId, limit, offset) as Row[]
    return this.#mapMessages(rows)
  }

  getMessage(conversationId: string, messageId: string): ConversationMessageV1 | undefined {
    const row = this.#database.prepare('SELECT * FROM conversation_messages WHERE id = ? AND session_id = ?').get(messageId, conversationId) as Row | undefined
    return row === undefined ? undefined : this.#mapMessages([row])[0]
  }

  getSections(conversationId: string): ConversationSectionV1[] {
    const rows = this.#database.prepare(`
      SELECT s.*, a.source_hash, a.title AS annotation_title, a.decisions_json, a.todos_json,
             a.involved_files_json, a.status AS annotation_status, a.annotated_by, a.annotated_at
      FROM conversation_sections s
      LEFT JOIN conversation_section_annotations a ON a.section_id = s.id
      WHERE s.session_id = ? ORDER BY s.seq
    `).all(conversationId) as Row[]
    return rows.map((row) => this.#mapSection(row))
  }

  refreshSections(projectId: string, conversationId: string): ConversationSectionV1[] {
    const session = this.#database.prepare('SELECT id FROM conversation_sessions WHERE id = ? AND project_id = ?').get(conversationId, projectId)
    if (session === undefined) throw new Error('Conversation not found.')
    const derived = this.#deriveSectionsFromDatabase(conversationId)
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const locked = this.#database.prepare('SELECT * FROM conversation_sections WHERE session_id = ? AND locked_by_user = 1').all(conversationId) as Row[]
      this.#database.prepare('DELETE FROM conversation_sections WHERE session_id = ? AND locked_by_user = 0').run(conversationId)
      const overlaps = (section: ConversationSectionV1) => locked.some((row) => Number(row.start_seq) <= section.endSeq && Number(row.end_seq) >= section.startSeq)
      const candidates = derived.filter((item) => !overlaps(item))
      this.#database.prepare('UPDATE conversation_sections SET seq=seq+1000000 WHERE session_id=? AND locked_by_user=1').run(conversationId)
      const merged = [
        ...locked.map((row) => ({ kind: 'locked' as const, startSeq: Number(row.start_seq), id: String(row.id) })),
        ...candidates.map((section) => ({ kind: 'derived' as const, startSeq: section.startSeq, section })),
      ].sort((a, b) => a.startSeq - b.startSeq)
      for (let seq = 0; seq < merged.length; seq += 1) {
        const item = merged[seq]!
        if (item.kind === 'locked') this.#database.prepare('UPDATE conversation_sections SET seq=? WHERE id=?').run(seq, item.id)
        else this.#insertSection({ ...item.section, seq })
      }
      const count = merged.length
      this.#database.prepare('UPDATE conversation_sessions SET section_count=?, updated_at=? WHERE id=?').run(count, now(), conversationId)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) { this.#database.exec('ROLLBACK;'); throw error }
    return this.getSections(conversationId)
  }

  updateSection(projectId: string, conversationId: string, sectionId: string, input: { readonly title?: string; readonly lockedByUser?: boolean }): ConversationSectionV1 {
    if (this.#database.prepare('SELECT 1 FROM conversation_sessions WHERE id=? AND project_id=?').get(conversationId, projectId) === undefined) throw new Error('Conversation not found.')
    const current = this.#database.prepare('SELECT * FROM conversation_sections WHERE id=? AND session_id=?').get(sectionId, conversationId) as Row | undefined
    if (current === undefined) throw new Error('Conversation section not found.')
    const titleWasEdited = input.title !== undefined && input.title.trim() !== String(current.title)
    const title = input.title?.trim() || String(current.title)
    const locked = input.lockedByUser === undefined ? (titleWasEdited ? 1 : Number(current.locked_by_user)) : input.lockedByUser ? 1 : 0
    this.#database.prepare('UPDATE conversation_sections SET title=?, locked_by_user=? WHERE id=?')
      .run(title.slice(0, 160), locked, sectionId)
    return this.getSections(conversationId).find((item) => item.id === sectionId)!
  }

  annotateSection(projectId: string, conversationId: string, sectionId: string, input: AnnotateConversationSectionInputV1): ConversationSectionAnnotationV1 {
    if (this.#database.prepare('SELECT 1 FROM conversation_sessions WHERE id=? AND project_id=?').get(conversationId, projectId) === undefined) throw new Error('Conversation not found.')
    const section = this.getSections(conversationId).find((item) => item.id === sectionId)
    if (section === undefined) throw new Error('Conversation section not found.')
    const messages = this.#database.prepare('SELECT content_hash FROM conversation_messages WHERE session_id=? AND seq BETWEEN ? AND ? ORDER BY seq')
      .all(conversationId, section.startSeq, section.endSeq) as Row[]
    const actualHash = sha256(messages.map((row) => String(row.content_hash)).join(':'))
    if (input.sourceHash !== actualHash) throw new Error('SECTION_SOURCE_STALE')
    const existing = this.#database.prepare('SELECT * FROM conversation_section_annotations WHERE section_id=?').get(sectionId) as Row | undefined
    if (existing !== undefined && String(existing.annotated_by) === 'user' && (input.annotatedBy ?? 'agent') === 'agent') {
      throw new Error('ANNOTATION_USER_LOCKED')
    }
    const annotation: ConversationSectionAnnotationV1 = {
      schemaVersion: 1,
      sectionId,
      sourceHash: actualHash,
      title: input.title.trim().slice(0, 40),
      decisions: input.decisions.slice(0, 3).map((item) => item.trim()).filter(Boolean),
      todos: input.todos.slice(0, 3).map((item) => item.trim()).filter(Boolean),
      involvedFiles: input.involvedFiles.slice(0, 20).map((item) => item.trim()).filter(Boolean),
      status: 'ready',
      annotatedBy: input.annotatedBy ?? 'agent',
      annotatedAt: now(),
    }
    this.#database.prepare(`
      INSERT INTO conversation_section_annotations VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, ?)
      ON CONFLICT(section_id) DO UPDATE SET source_hash=excluded.source_hash, title=excluded.title,
        decisions_json=excluded.decisions_json, todos_json=excluded.todos_json,
        involved_files_json=excluded.involved_files_json, status='ready', annotated_by=excluded.annotated_by,
        annotated_at=excluded.annotated_at
    `).run(sectionId, actualHash, annotation.title, JSON.stringify(annotation.decisions), JSON.stringify(annotation.todos), JSON.stringify(annotation.involvedFiles), annotation.annotatedBy, annotation.annotatedAt)
    return annotation
  }

  getSectionSource(conversationId: string, sectionId: string): { readonly section: ConversationSectionV1; readonly sourceHash: string; readonly messages: readonly ConversationMessageV1[] } {
    const section = this.getSections(conversationId).find((item) => item.id === sectionId)
    if (section === undefined) throw new Error('Conversation section not found.')
    const messages = this.#mapMessages(this.#database.prepare('SELECT * FROM conversation_messages WHERE session_id=? AND seq BETWEEN ? AND ? ORDER BY seq')
      .all(conversationId, section.startSeq, section.endSeq) as Row[])
    return { section, sourceHash: sha256(messages.map((item) => item.contentHash).join(':')), messages }
  }

  async pinMessage(projectId: string, conversationId: string, messageId: string, input: PinConversationMessageInputV1): Promise<ConversationMessageV1> {
    const message = this.getMessage(conversationId, messageId)
    const session = this.#database.prepare('SELECT * FROM conversation_sessions WHERE id=? AND project_id=?').get(conversationId, projectId) as Row | undefined
    if (message === undefined || session === undefined) throw new Error('Conversation message not found.')
    if (message.pinnedAsDecision && message.decisionArtifactId) return message
    const title = input.title?.trim() || compactText(firstMeaningfulLine(message.contentText), 60) || `对话决策 ${message.seq}`
    const body = [
      `# ${title}`,
      '',
      input.summary?.trim() || message.contentText,
      '',
      `> 来源：${String(session.title)} · 消息 ${message.seq}`,
      `> 原始消息 ID：${message.id}`,
    ].join('\n')
    const result = await createTextArtifact(this.#repository, projectId as ProjectId, {
      title,
      body,
      scopeId: input.scopeId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.x === undefined ? {} : { x: input.x }),
      ...(input.y === undefined ? {} : { y: input.y }),
    })
    this.#database.prepare('UPDATE conversation_messages SET pinned_as_decision=1, decision_artifact_id=? WHERE id=? AND session_id=?')
      .run(result.artifactId, messageId, conversationId)
    if (typeof session.conversation_artifact_id === 'string') {
      const timestampValue = now()
      this.#repository.upsertRelation({
        id: `relation-conversation-decision-${randomUUID()}` as Relation['id'],
        projectId: projectId as ProjectId,
        sourceEntityType: 'artifact', sourceEntityId: String(session.conversation_artifact_id),
        targetEntityType: 'artifact', targetEntityId: result.artifactId,
        kind: 'conversation_decision', createdAt: timestampValue, updatedAt: timestampValue,
      })
    }
    return this.getMessage(conversationId, messageId)!
  }

  search(projectId: string, query: string, options: { readonly limit?: number; readonly semantic?: boolean; readonly model?: string } = {}): Promise<ConversationSearchHitV1[]> {
    return this.#search(projectId, query, options)
  }

  getSemanticIndexStatus(projectId: string): ConversationSemanticIndexStatusV1 {
    const row = this.#database.prepare('SELECT * FROM conversation_embedding_jobs WHERE project_id=? ORDER BY updated_at DESC LIMIT 1').get(projectId) as Row | undefined
    if (row === undefined) return {
      schemaVersion: 1, projectId, provider: 'ollama', model: DEFAULT_EMBEDDING_MODEL,
      state: 'not_ready', backend: this.#vectorLoaded ? 'sqlite-vec' : 'sqlite-blob-fallback',
      indexedMessages: 0, staleMessages: this.#countIndexableMessages(projectId), indexVersion: EMBEDDING_INDEX_VERSION,
      ...(this.#vectorLoadError === undefined ? {} : { lastError: this.#vectorLoadError }),
      updatedAt: now(),
    }
    return this.#mapSemanticStatus(row)
  }

  queueSemanticIndex(projectId: string, input: BuildConversationSemanticIndexInputV1 = {}): ConversationSemanticIndexStatusV1 {
    const jobId = this.#ensureEmbeddingJob(projectId, input)
    void this.#executeEmbeddingJob(jobId)
    return this.#mapSemanticStatus(this.#database.prepare('SELECT * FROM conversation_embedding_jobs WHERE id=?').get(jobId) as Row)
  }

  async buildSemanticIndex(projectId: string, input: BuildConversationSemanticIndexInputV1 = {}): Promise<ConversationSemanticIndexStatusV1> {
    const jobId = this.#ensureEmbeddingJob(projectId, input)
    return this.#executeEmbeddingJob(jobId)
  }

  #ensureEmbeddingJob(projectId: string, input: BuildConversationSemanticIndexInputV1): string {
    if (this.#repository.getProject(projectId) === undefined) throw new Error('Project not found.')
    const model = input.model?.trim() || DEFAULT_EMBEDDING_MODEL
    const batchSize = Math.max(1, Math.min(64, Math.floor(input.batchSize ?? 16)))
    const existing = this.#database.prepare(`
      SELECT * FROM conversation_embedding_jobs
      WHERE project_id=? AND model=? AND index_version=?
        AND status IN ('pending','running') AND COALESCE(session_id, '')=?
      ORDER BY updated_at DESC LIMIT 1
    `).get(projectId, model, EMBEDDING_INDEX_VERSION, input.sessionId ?? '') as Row | undefined
    if (existing !== undefined) return String(existing.id)
    const jobId = `conversation-embedding-${randomUUID()}`
    const backend = this.#vectorLoaded ? 'sqlite-vec' : 'sqlite-blob-fallback'
    const createdAt = now()
    this.#database.prepare(`
      INSERT INTO conversation_embedding_jobs (
        id, project_id, session_id, provider, model, status, attempt_count,
        indexed_messages, stale_messages, dimensions, backend, last_error,
        lease_owner, lease_expires_at, created_at, updated_at, index_version,
        force_rebuild, batch_size, next_attempt_at
      ) VALUES (?, ?, ?, 'ollama', ?, 'pending', 0, 0, 0, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?)
    `).run(
      jobId,
      projectId,
      input.sessionId ?? null,
      model,
      backend,
      createdAt,
      createdAt,
      EMBEDDING_INDEX_VERSION,
      input.force ? 1 : 0,
      batchSize,
      createdAt,
    )
    return jobId
  }

  #executeEmbeddingJob(jobId: string): Promise<ConversationSemanticIndexStatusV1> {
    const active = this.#activeEmbeddingJobs.get(jobId)
    if (active !== undefined) return active
    const task = this.#runEmbeddingJob(jobId).finally(() => { this.#activeEmbeddingJobs.delete(jobId) })
    this.#activeEmbeddingJobs.set(jobId, task)
    return task
  }

  async #runEmbeddingJob(jobId: string): Promise<ConversationSemanticIndexStatusV1> {
    const job = this.#database.prepare('SELECT * FROM conversation_embedding_jobs WHERE id=?').get(jobId) as Row | undefined
    if (job === undefined) throw new Error('Conversation embedding job not found.')
    const status = String(job.status)
    if (['ready', 'partial', 'failed'].includes(status)) return this.#mapSemanticStatus(job)
    const projectId = String(job.project_id)
    const model = String(job.model)
    const sessionId = job.session_id ? String(job.session_id) : undefined
    const batchSize = Math.max(1, Math.min(64, Number(job.batch_size ?? 16)))
    const force = Number(job.force_rebuild ?? 0) === 1
    this.#database.prepare(`
      UPDATE conversation_embedding_jobs
      SET status='running', attempt_count=attempt_count+1, last_error=NULL,
          lease_owner=?, lease_expires_at=?, updated_at=?
      WHERE id=? AND status='pending'
    `).run(
      `local-core:${process.pid}`,
      new Date(Date.now() + 10 * 60_000).toISOString(),
      now(),
      jobId,
    )
    try {
      this.#backfillEmbeddingInputs(projectId, sessionId)
      const rows = this.#database.prepare(`
        SELECT m.id, m.role, m.event_kind, m.tool_name, m.content_text,
               m.content_hash, m.embedding_input_hash, m.embedding_version
        FROM conversation_messages m
        JOIN conversation_sessions s ON s.id=m.session_id
        LEFT JOIN conversation_embeddings e ON e.message_id=m.id AND e.model=?
        WHERE s.project_id=? AND m.content_text <> ''
          ${sessionId ? 'AND m.session_id=?' : ''}
          AND (?=1 OR e.input_hash IS NULL OR e.input_hash<>m.embedding_input_hash
            OR e.embedding_version<>m.embedding_version)
        ORDER BY m.session_id, m.seq
      `).all(...(sessionId ? [model, projectId, sessionId, force ? 1 : 0] : [model, projectId, force ? 1 : 0])) as Row[]
      let indexed = 0
      let dimensions = job.dimensions === null || job.dimensions === undefined ? undefined : Number(job.dimensions)
      for (let index = 0; index < rows.length; index += batchSize) {
        const batch = rows.slice(index, index + batchSize)
        const input = batch.map((row) => embeddingTextFor({
          role: String(row.role) as ConversationMessageV1['role'],
          eventKind: String(row.event_kind),
          ...(row.tool_name ? { toolName: String(row.tool_name) } : {}),
          contentText: String(row.content_text),
        }))
        const embeddings = await this.#ollamaEmbed(model, input)
        if (embeddings.length !== batch.length) throw new Error('Ollama returned an unexpected embedding count.')
        this.#database.exec('BEGIN IMMEDIATE;')
        try {
          for (let inner = 0; inner < batch.length; inner += 1) {
            const row = batch[inner]!
            const vector = embeddings[inner]!
            dimensions ??= vector.length
            if (vector.length !== dimensions) throw new Error('Embedding dimensions changed within one job.')
            const inputHash = String(row.embedding_input_hash)
            const embeddingVersion = String(row.embedding_version ?? EMBEDDING_INDEX_VERSION)
            this.#database.prepare(`
              INSERT INTO conversation_embeddings (
                message_id, model, dimensions, content_hash, embedding_blob,
                indexed_at, input_hash, embedding_version
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(message_id, model) DO UPDATE SET
                dimensions=excluded.dimensions,
                content_hash=excluded.content_hash,
                embedding_blob=excluded.embedding_blob,
                indexed_at=excluded.indexed_at,
                input_hash=excluded.input_hash,
                embedding_version=excluded.embedding_version
            `).run(
              String(row.id),
              model,
              vector.length,
              String(row.content_hash),
              vectorToBlob(vector),
              now(),
              inputHash,
              embeddingVersion,
            )
            if (this.#vectorLoaded) this.#upsertVecRow(String(row.id), model, vector)
            indexed += 1
          }
          this.#database.exec('COMMIT;')
        } catch (error: unknown) {
          this.#database.exec('ROLLBACK;')
          throw error
        }
        this.#database.prepare(`
          UPDATE conversation_embedding_jobs
          SET indexed_messages=?, dimensions=?, lease_expires_at=?, updated_at=?
          WHERE id=?
        `).run(indexed, dimensions ?? null, new Date(Date.now() + 10 * 60_000).toISOString(), now(), jobId)
      }
      const stale = this.#countStaleMessages(projectId, model, sessionId)
      this.#database.prepare(`
        UPDATE conversation_embedding_jobs
        SET status=?, indexed_messages=?, stale_messages=?, dimensions=?,
            lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=NULL, updated_at=?
        WHERE id=?
      `).run(stale === 0 ? 'ready' : 'partial', indexed, stale, dimensions ?? null, now(), jobId)
    } catch (error: unknown) {
      const attempt = Number((this.#database.prepare('SELECT attempt_count FROM conversation_embedding_jobs WHERE id=?').get(jobId) as Row).attempt_count)
      const retryable = attempt < 3
      this.#database.prepare(`
        UPDATE conversation_embedding_jobs
        SET status=?, last_error=?, lease_owner=NULL, lease_expires_at=NULL,
            next_attempt_at=?, updated_at=? WHERE id=?
      `).run(
        retryable ? 'pending' : 'failed',
        error instanceof Error ? error.message : 'Embedding index failed.',
        retryable ? new Date(Date.now() + Math.min(60_000, 2 ** attempt * 1_000)).toISOString() : null,
        now(),
        jobId,
      )
      if (retryable) {
        const delay = Math.min(60_000, 2 ** attempt * 1_000)
        const timer = setTimeout(() => {
          if (!this.#closed) void this.#executeEmbeddingJob(jobId)
        }, delay)
        timer.unref()
      }
    }
    return this.#mapSemanticStatus(this.#database.prepare('SELECT * FROM conversation_embedding_jobs WHERE id=?').get(jobId) as Row)
  }

  async #parseAndPersist(projectId: string, upload: ConversationImportSessionV1, combinedPath: string, sourceContentHash: string): Promise<CompleteConversationImportResultV1> {
    const project = this.#repository.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const conversationId = `conversation-${sha256(`${projectId}:${sourceContentHash}`).slice(0, 24)}`
    const existing = this.#database.prepare('SELECT status FROM conversation_sessions WHERE id=?').get(conversationId) as Row | undefined
    if (existing !== undefined) {
      if (String(existing.status) === 'ready') return this.completeResult(conversationId)
      if (String(existing.status) === 'parsing') {
        const error = new Error('同一份对话正在另一个导入任务中处理，请稍后重试。') as Error & { code?: string }
        error.code = 'CONVERSATION_IMPORT_IN_PROGRESS'
        throw error
      }
      await this.#cleanupConversationById(projectId, conversationId)
    }
    const importedAt = now()
    const sourceDir = resolve(project.rootPath, '.creative-os', 'conversations', conversationId)
    await mkdir(sourceDir, { recursive: true })
    const sourcePath = join(sourceDir, sanitizeFileName(upload.sourceFileName || 'conversation.jsonl'))
    await copyFile(combinedPath, `${sourcePath}.partial`)
    await rename(`${sourcePath}.partial`, sourcePath)
    const title = upload.title || upload.sourceFileName
    this.#database.prepare(`
      INSERT INTO conversation_sessions (
        id, project_id, provider, source_kind, title, message_count, section_count, status,
        source_content_hash, source_file_name, source_path, origin_meta_json,
        imported_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, 0, 'parsing', ?, ?, ?, '{}', ?, ?, ?)
    `).run(conversationId, projectId, upload.sourceKind, upload.sourceKind, title, sourceContentHash, upload.sourceFileName, sourcePath, importedAt, importedAt, importedAt)
    const graph = this.#repository.get(projectId)
    const fileRecords = graph?.fileRecords ?? []
    const artifactByFile = new Map<string, string>()
    for (const revision of graph?.artifactRevisions ?? []) artifactByFile.set(String(revision.fileRecordId), String(revision.artifactId))
    const projectFileByPath = new Map<string, string>()
    const projectFileByBasename = new Map<string, string | null>()
    const registerUniqueName = (name: string, artifactId: string) => {
      const nameKey = basename(name).toLocaleLowerCase('en-US')
      if (!nameKey) return
      const existing = projectFileByBasename.get(nameKey)
      projectFileByBasename.set(nameKey, existing === undefined ? artifactId : existing === artifactId ? artifactId : null)
    }
    for (const file of fileRecords) {
      const artifactId = artifactByFile.get(String(file.id))
      if (!artifactId) continue
      const absolutePath = resolve(file.observedPath)
      projectFileByPath.set(absolutePath.toLocaleLowerCase('en-US'), artifactId)
      registerUniqueName(absolutePath, artifactId)
    }
    // Imported copies may receive an idempotency prefix in their observed filename.
    // Artifact titles preserve the user-visible source filename, so a unique title is
    // a safer basename fallback than guessing from an arbitrary external path.
    for (const artifact of graph?.artifacts ?? []) registerUniqueName(artifact.title, String(artifact.id))
    const input = createReadStream(sourcePath, { encoding: 'utf8' })
    const lines = readline.createInterface({ input, crlfDelay: Infinity })
    let seq = 0
    let parsedLines = 0
    let invalidLines = 0
    let ignoredEvents = 0
    let duplicates = 0
    let matchedFileReferences = 0
    let originMeta: Record<string, unknown> = {}
    const seen = new Set<string>()
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      for await (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        parsedLines += 1
        let parsed: unknown
        try { parsed = JSON.parse(trimmed) } catch { invalidLines += 1; continue }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { invalidLines += 1; continue }
        const record = parsed as Record<string, unknown>
        const normalized = parseCodexEvent(record)
        if (normalized?.originMeta) { originMeta = { ...originMeta, ...normalized.originMeta }; continue }
        if (normalized === undefined || !normalized.contentText.trim()) { ignoredEvents += 1; continue }
        const createdAt = timestamp(record, importedAt)
        const contentHash = sha256(`${normalized.role}\n${normalized.contentText}`)
        const dedupeKey = `${normalized.role}:${createdAt}:${contentHash}`
        if (seen.has(dedupeKey)) { duplicates += 1; continue }
        seen.add(dedupeKey)
        const refs: ConversationFileReferenceV1[] = []
        const seenArtifacts = new Set<string>()
        for (const raw of extractFileReferenceCandidates(normalized.contentText)) {
          const normalizedRaw = raw.trim().replace(/^['"`]+|['"`]+$/g, '')
          if (!normalizedRaw || /^(?:https?|mcp|ui|plugin|data|blob):/i.test(normalizedRaw)) continue
          const candidate = isAbsolute(normalizedRaw)
            ? resolve(normalizedRaw)
            : resolve(project.rootPath, normalizedRaw.replaceAll('\\', '/'))
          let artifactId = isInside(project.rootPath, candidate)
            ? projectFileByPath.get(candidate.toLocaleLowerCase('en-US'))
            : undefined
          // A path outside the project may still refer to a file that the user has
          // already imported. Reuse it only when its basename maps to exactly one
          // project Artifact; ambiguous names are ignored rather than guessed.
          if (!artifactId) {
            artifactId = projectFileByBasename.get(basename(normalizedRaw.replaceAll('\\', '/')).toLocaleLowerCase('en-US')) ?? undefined
          }
          if (!artifactId || seenArtifacts.has(artifactId)) continue
          seenArtifacts.add(artifactId)
          matchedFileReferences += 1
          refs.push({ raw: normalizedRaw, normalized: candidate, artifactId, inProject: true })
        }
        const id = normalized.sourceEventId ? `conversation-message-${sha256(`${conversationId}:${normalized.sourceEventId}`).slice(0, 24)}` : `conversation-message-${randomUUID()}`
        const inputHash = embeddingInputHash(normalized)
        this.#database.prepare(`
          INSERT INTO conversation_messages (
            id, session_id, seq, role, event_kind, source_event_id, content_text, created_at,
            tool_name, tool_call_json, file_refs_json, parent_id, pinned_as_decision,
            decision_artifact_id, content_hash, embedding_input_hash, embedding_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ?, ?)
        `).run(id, conversationId, seq, normalized.role, normalized.eventKind, normalized.sourceEventId ?? null, normalized.contentText, createdAt,
          normalized.toolName ?? null, normalized.toolCall ? JSON.stringify(normalized.toolCall) : null, JSON.stringify(refs), contentHash,
          inputHash, EMBEDDING_INDEX_VERSION)
        for (let ordinal = 0; ordinal < refs.length; ordinal += 1) {
          const ref = refs[ordinal]!
          this.#database.prepare(`
            INSERT INTO conversation_file_references (
              id, message_id, ordinal, raw, normalized, artifact_id, relation_id, in_project, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
          `).run(
            `conversation-file-ref-${sha256(`${id}:${ordinal}:${ref.raw}`).slice(0, 24)}`,
            id,
            ordinal,
            ref.raw,
            ref.normalized ?? null,
            ref.artifactId ?? null,
            ref.inProject ? 1 : 0,
            importedAt,
          )
        }
        seq += 1
      }
      this.#database.prepare(`
        UPDATE conversation_sessions
        SET provider=?, message_count=?, origin_meta_json=?, parsed_line_count=?, invalid_line_count=?,
            ignored_event_count=?, duplicate_event_count=?, matched_file_reference_count=?, updated_at=?
        WHERE id=?
      `).run(
        typeof originMeta.model_provider === 'string' ? String(originMeta.model_provider) : upload.sourceKind,
        seq,
        JSON.stringify(originMeta),
        parsedLines,
        invalidLines,
        ignoredEvents,
        duplicates,
        matchedFileReferences,
        now(),
        conversationId,
      )
      this.#database.exec('COMMIT;')
    } catch (error: unknown) { this.#database.exec('ROLLBACK;'); throw error }
    const sections = this.#deriveSectionsFromDatabase(conversationId)
    this.#database.exec('BEGIN IMMEDIATE;')
    try { for (const section of sections) this.#insertSection(section); this.#database.exec('COMMIT;') } catch (error: unknown) { this.#database.exec('ROLLBACK;'); throw error }
    const artifact = await createTextArtifact(this.#repository, projectId as ProjectId, {
      title,
      body: [
        `# ${title}`,
        '',
        `- 来源：${upload.sourceKind}`,
        `- 消息：${seq}`,
        `- 章节：${sections.length}`,
        `- 原始内容哈希：${sourceContentHash}`,
        '',
        '> 这是会话入口节点。原始消息保存在 LCOS 时间线数据库中，不在此文件重复存储。',
      ].join('\n'),
      scopeId: upload.scopeId,
      ...(upload.workspaceId ? { workspaceId: upload.workspaceId } : {}),
      x: 160,
      y: 160,
    })
    const artifactRows = this.#database.prepare(`
      SELECT DISTINCT artifact_id FROM conversation_file_references r
      JOIN conversation_messages m ON m.id=r.message_id
      WHERE m.session_id=? AND r.artifact_id IS NOT NULL
    `).all(conversationId) as Row[]
    for (const row of artifactRows) {
      const artifactId = String(row.artifact_id)
      const relationId = `relation-conversation-file-${randomUUID()}`
      const createdAt = now()
      this.#repository.upsertRelation({
        id: relationId as Relation['id'],
        projectId: projectId as ProjectId,
        sourceEntityType: 'artifact', sourceEntityId: artifact.artifactId,
        targetEntityType: 'artifact', targetEntityId: artifactId,
        kind: 'conversation_file_reference', createdAt, updatedAt: createdAt,
      })
      this.#database.prepare(`
        UPDATE conversation_file_references SET relation_id=?
        WHERE artifact_id=? AND message_id IN (
          SELECT id FROM conversation_messages WHERE session_id=?
        )
      `).run(relationId, artifactId, conversationId)
    }
    this.#database.prepare(`
      UPDATE conversation_sessions SET conversation_artifact_id=?, conversation_view_id=?,
        section_count=?, status='ready', updated_at=? WHERE id=?
    `).run(artifact.artifactId, artifact.viewId, sections.length, now(), conversationId)
    return { session: this.getProjection(projectId, conversationId)!.session, sections: this.getSections(conversationId), matchedFileReferences, ignoredDuplicateEvents: duplicates }
  }

  async #cleanupIncompleteConversation(projectId: string, sourceContentHash: string): Promise<void> {
    const rows = this.#database.prepare(`
      SELECT id FROM conversation_sessions
      WHERE project_id=? AND source_content_hash=? AND status<>'ready'
    `).all(projectId, sourceContentHash) as Row[]
    for (const row of rows) await this.#cleanupConversationById(projectId, String(row.id))
  }

  async #cleanupConversationById(projectId: string, conversationId: string): Promise<void> {
    const row = this.#database.prepare(`
      SELECT source_path, conversation_artifact_id, conversation_view_id
      FROM conversation_sessions WHERE id=? AND project_id=?
    `).get(conversationId, projectId) as Row | undefined
    if (row === undefined) return
    const artifactId = row.conversation_artifact_id ? String(row.conversation_artifact_id) : undefined
    const fileRows = artifactId === undefined ? [] : this.#database.prepare(`
      SELECT DISTINCT f.id, f.observed_path
      FROM artifact_revisions r JOIN file_records f ON f.id=r.file_record_id
      WHERE r.artifact_id=?
    `).all(artifactId) as Row[]
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      if (artifactId !== undefined) {
        this.#database.prepare(`DELETE FROM relations WHERE project_id=? AND (source_entity_id=? OR target_entity_id=?)`).run(projectId, artifactId, artifactId)
        this.#database.prepare(`DELETE FROM workspace_memberships WHERE view_id IN (SELECT id FROM artifact_views WHERE artifact_id=?)`).run(artifactId)
        this.#database.prepare('DELETE FROM artifact_views WHERE artifact_id=?').run(artifactId)
        this.#database.prepare('DELETE FROM artifact_revisions WHERE artifact_id=?').run(artifactId)
        for (const file of fileRows) this.#database.prepare('DELETE FROM file_records WHERE id=? AND project_id=?').run(String(file.id), projectId)
        this.#database.prepare('DELETE FROM artifacts WHERE id=? AND project_id=?').run(artifactId, projectId)
      }
      this.#database.prepare('DELETE FROM conversation_sessions WHERE id=? AND project_id=?').run(conversationId, projectId)
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
    const project = this.#repository.getProject(projectId)
    const safeRemove = async (candidate: string | undefined): Promise<void> => {
      if (!candidate || project === undefined || !isInside(project.rootPath, candidate)) return
      const relativePath = relative(resolve(project.rootPath), resolve(candidate)).replaceAll('\\', '/')
      if (!relativePath.startsWith('.creative-os/')) return
      await rm(candidate, { recursive: true, force: true }).catch(() => {})
    }
    await safeRemove(row.source_path ? String(row.source_path) : undefined)
    for (const file of fileRows) await safeRemove(file.observed_path ? String(file.observed_path) : undefined)
  }

  #deriveSectionsFromDatabase(conversationId: string): ConversationSectionV1[] {
    const userCount = Number((this.#database.prepare(`
      SELECT COUNT(*) AS count FROM conversation_messages
      WHERE session_id=? AND role='user'
    `).get(conversationId) as Row).count)
    const sections: ConversationSectionV1[] = []
    type SectionAccumulator = {
      startSeq: number
      endSeq: number
      count: number
      totalChars: number
      fileReferenceCount: number
      allTools: boolean
      first: { role: ConversationMessageV1['role']; contentText: string }
      firstUser?: { role: ConversationMessageV1['role']; contentText: string }
      firstNonTool?: { role: ConversationMessageV1['role']; contentText: string }
    }
    let current: SectionAccumulator | undefined
    let seenUser = false
    const finalize = (): void => {
      if (current === undefined || current.count === 0) return
      const lead = current.firstUser ?? current.firstNonTool ?? current.first
      const titleSource = firstMeaningfulLine(lead.contentText).replace(/^#+\s*/, '')
      sections.push({
        schemaVersion: 1,
        id: `conversation-section-${sha256(`${conversationId}:${current.startSeq}:${current.endSeq}`).slice(0, 24)}`,
        sessionId: conversationId,
        seq: sections.length,
        kind: lead.role === 'user' ? 'instruction' : current.allTools ? 'tool_cluster' : current.totalChars > 80_000 ? 'long_message' : 'turn',
        title: compactText(titleSource, 80) || `第 ${sections.length + 1} 段`,
        startSeq: current.startSeq,
        endSeq: current.endSeq,
        lockedByUser: false,
        derivedAt: now(),
      })
      current = undefined
    }
    const rows = this.#database.prepare(`
      SELECT seq, role, content_text, file_refs_json FROM conversation_messages
      WHERE session_id=? ORDER BY seq
    `).iterate(conversationId) as Iterable<Row>
    for (const row of rows) {
      const role = String(row.role) as ConversationMessageV1['role']
      const seq = Number(row.seq)
      const contentText = String(row.content_text)
      const fileReferenceCount = json<unknown[]>(row.file_refs_json, []).length
      const splitOnUser = role === 'user' && seenUser
      const splitOnCount = userCount === 0 && current !== undefined && current.count >= 200
      const splitOnSize = userCount === 0 && current !== undefined && current.count > 0 && current.totalChars + contentText.length > 80_000
      const splitOnFileDensity = current !== undefined && current.count >= 20 && current.fileReferenceCount >= 8 && fileReferenceCount > 0
      if (splitOnUser || splitOnCount || splitOnSize || splitOnFileDensity) finalize()
      const item = { role, contentText }
      current ??= {
        startSeq: seq,
        endSeq: seq,
        count: 0,
        totalChars: 0,
        fileReferenceCount: 0,
        allTools: true,
        first: item,
      }
      current.endSeq = seq
      current.count += 1
      current.totalChars += contentText.length
      current.fileReferenceCount += fileReferenceCount
      current.allTools = current.allTools && role === 'tool'
      if (current.firstNonTool === undefined && role !== 'tool') current.firstNonTool = item
      if (current.firstUser === undefined && role === 'user') current.firstUser = item
      if (role === 'user') seenUser = true
    }
    finalize()
    return sections
  }

  #insertSection(section: ConversationSectionV1): void {
    this.#database.prepare('INSERT INTO conversation_sections VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(section.id, section.sessionId, section.seq, section.kind, section.title, section.startSeq, section.endSeq, section.lockedByUser ? 1 : 0, section.derivedAt)
  }

  async #search(projectId: string, query: string, options: { readonly limit?: number; readonly semantic?: boolean; readonly model?: string }): Promise<ConversationSearchHitV1[]> {
    const normalized = query.trim()
    if (!normalized) return []
    const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)))
    const tokens = normalized.split(/\s+/).filter(Boolean).map((token) => `"${token.replaceAll('"', '""')}"`)
    const ftsQuery = tokens.join(' OR ')
    const lexicalRows = this.#database.prepare(`
      SELECT f.message_id, bm25(conversation_messages_fts, 0.0, 0.0, 0.0, 1.0, 4.0) AS rank
      FROM conversation_messages_fts f
      WHERE conversation_messages_fts MATCH ? AND f.project_id=?
      ORDER BY rank LIMIT ?
    `).all(ftsQuery, projectId, limit * 3) as Row[]
    const scores = new Map<string, { lexicalRank?: number; vectorDistance?: number; reasons: Set<'fts5' | 'vector' | 'pinned' | 'recent'> }>()
    lexicalRows.forEach((row, index) => scores.set(String(row.message_id), { lexicalRank: Number(row.rank), reasons: new Set(['fts5']) }))
    if (options.semantic !== false) {
      const model = options.model ?? this.getSemanticIndexStatus(projectId).model
      try {
        const [queryVector] = await this.#ollamaEmbed(model, [normalized])
        if (queryVector) {
          const vectorRows = this.#vectorLoaded ? this.#queryVec(projectId, model, queryVector, limit * 3) : this.#queryBlobVectors(projectId, model, queryVector, limit * 3)
          for (const row of vectorRows) {
            const current = scores.get(row.messageId) ?? { reasons: new Set<'fts5' | 'vector' | 'pinned' | 'recent'>() }
            current.vectorDistance = row.distance; current.reasons.add('vector'); scores.set(row.messageId, current)
          }
        }
      } catch { /* lexical search remains fully usable */ }
    }
    const ids = [...scores.keys()]
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.#database.prepare(`
      SELECT m.*, s.title AS session_title,
        cs.id AS section_id, cs.title AS section_title
      FROM conversation_messages m
      JOIN conversation_sessions s ON s.id=m.session_id
      LEFT JOIN conversation_sections cs ON cs.session_id=m.session_id AND m.seq BETWEEN cs.start_seq AND cs.end_seq
      WHERE m.id IN (${placeholders}) AND s.project_id=?
    `).all(...ids, projectId) as Row[]
    const messagesById = new Map(this.#mapMessages(rows).map((message) => [message.id, message]))
    const maxLex = Math.max(1, lexicalRows.length)
    return rows.map((row) => {
      const score = scores.get(String(row.id))!
      const lexPosition = lexicalRows.findIndex((item) => String(item.message_id) === String(row.id))
      const lexicalScore = lexPosition < 0 ? 0 : 1 - lexPosition / maxLex
      const vectorScore = score.vectorDistance === undefined ? 0 : Math.max(0, 1 - score.vectorDistance)
      const pinned = Number(row.pinned_as_decision) === 1
      if (pinned) score.reasons.add('pinned')
      return {
        message: messagesById.get(String(row.id))!,
        sessionTitle: String(row.session_title),
        ...(row.section_id ? { sectionId: String(row.section_id), sectionTitle: String(row.section_title) } : {}),
        ...(score.lexicalRank === undefined ? {} : { lexicalRank: score.lexicalRank }),
        ...(score.vectorDistance === undefined ? {} : { vectorDistance: score.vectorDistance }),
        hybridScore: lexicalScore * 0.55 + vectorScore * 0.4 + (pinned ? 0.05 : 0),
        reasons: [...score.reasons],
      }
    }).sort((a, b) => b.hybridScore - a.hybridScore).slice(0, limit)
  }

  async #ollamaEmbed(model: string, input: readonly string[]): Promise<number[][]> {
    const url = new URL('/api/embed', this.#ollamaUrl)
    if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) throw new Error('Ollama embedding endpoint must be loopback.')
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetch(url, {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ model, input, truncate: true }),
      })
      if (!response.ok) throw new Error(`Ollama embed failed with HTTP ${response.status}.`)
      const value = await response.json() as { embeddings?: unknown }
      if (!Array.isArray(value.embeddings) || !value.embeddings.every((vector) => Array.isArray(vector) && vector.every((item) => typeof item === 'number'))) {
        throw new Error('Ollama returned an invalid embedding response.')
      }
      return value.embeddings as number[][]
    } finally { clearTimeout(timeout) }
  }

  #tryLoadVectorExtension(): void {
    if (!this.#vectorExtensionPath) return
    try {
      this.#database.loadExtension(resolve(this.#vectorExtensionPath))
      this.#database.prepare('SELECT vec_version()').get()
      this.#vectorLoaded = true
      this.#vectorLoadError = undefined
    } catch (error: unknown) {
      this.#vectorLoaded = false
      this.#vectorLoadError = `sqlite-vec 加载失败：${error instanceof Error ? error.message : '未知错误'}`
    }
  }

  #recoverInterruptedEmbeddingJobs(): void {
    const recoveredAt = now()
    this.#database.prepare(`
      UPDATE conversation_embedding_jobs
      SET status='pending', last_error='Local Core 重启，索引任务将从当前内容安全重建。',
          lease_owner=NULL, lease_expires_at=NULL, next_attempt_at=?, updated_at=?
      WHERE status='running'
    `).run(recoveredAt, recoveredAt)
  }

  async #resumePendingEmbeddingJobs(): Promise<void> {
    if (this.#closed) return
    const rows = this.#database.prepare(`
      SELECT id FROM conversation_embedding_jobs
      WHERE status='pending' AND (next_attempt_at IS NULL OR next_attempt_at<=?)
      ORDER BY created_at
    `).all(now()) as Row[]
    for (const row of rows) await this.#executeEmbeddingJob(String(row.id))
  }

  #backfillEmbeddingInputs(projectId?: string, sessionId?: string): void {
    const clauses: string[] = ["content_text<>''", "(embedding_input_hash IS NULL OR embedding_version IS NULL OR embedding_version<>?)"]
    const args: SQLInputValue[] = [EMBEDDING_INDEX_VERSION]
    if (sessionId) {
      clauses.push('session_id=?')
      args.push(sessionId)
    } else if (projectId) {
      clauses.push('session_id IN (SELECT id FROM conversation_sessions WHERE project_id=?)')
      args.push(projectId)
    }
    const rows = this.#database.prepare(`
      SELECT id, role, event_kind, tool_name, content_text
      FROM conversation_messages WHERE ${clauses.join(' AND ')}
    `).all(...args) as Row[]
    if (rows.length === 0) return
    this.#database.exec('BEGIN IMMEDIATE;')
    try {
      const statement = this.#database.prepare(`
        UPDATE conversation_messages
        SET embedding_input_hash=?, embedding_version=? WHERE id=?
      `)
      for (const row of rows) {
        const input = {
          role: String(row.role) as ConversationMessageV1['role'],
          eventKind: String(row.event_kind),
          ...(row.tool_name ? { toolName: String(row.tool_name) } : {}),
          contentText: String(row.content_text),
        }
        statement.run(embeddingInputHash(input), EMBEDDING_INDEX_VERSION, String(row.id))
      }
      this.#database.exec('COMMIT;')
    } catch (error: unknown) {
      this.#database.exec('ROLLBACK;')
      throw error
    }
  }

  #ensureVecTable(model: string, dimensions: number): string {
    const key = sha256(`${model}:${dimensions}`).slice(0, 16)
    const table = `conversation_vec_${key}`
    this.#database.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING vec0(message_id TEXT PRIMARY KEY, embedding float[${dimensions}])`)
    return table
  }

  #upsertVecRow(messageId: string, model: string, vector: readonly number[]): void {
    const table = this.#ensureVecTable(model, vector.length)
    this.#database.prepare(`DELETE FROM ${table} WHERE message_id=?`).run(messageId)
    this.#database.prepare(`INSERT INTO ${table}(message_id, embedding) VALUES (?, ?)`)
      .run(messageId, JSON.stringify(vector))
  }

  #queryVec(projectId: string, model: string, vector: readonly number[], limit: number): { messageId: string; distance: number }[] {
    const table = this.#ensureVecTable(model, vector.length)
    const candidates = this.#database.prepare(`
      SELECT message_id, distance FROM ${table}
      WHERE embedding MATCH ? AND k=?
      ORDER BY distance
    `).all(JSON.stringify(vector), Math.max(limit * 5, 50)) as Row[]
    if (candidates.length === 0) return []
    const ids = candidates.map((row) => String(row.message_id))
    const placeholders = ids.map(() => '?').join(',')
    const allowed = new Set((this.#database.prepare(`
      SELECT m.id FROM conversation_messages m
      JOIN conversation_sessions s ON s.id=m.session_id
      WHERE s.project_id=? AND m.id IN (${placeholders})
    `).all(projectId, ...ids) as Row[]).map((row) => String(row.id)))
    return candidates
      .filter((row) => allowed.has(String(row.message_id)))
      .slice(0, limit)
      .map((row) => ({ messageId: String(row.message_id), distance: Number(row.distance) }))
  }

  #queryBlobVectors(projectId: string, model: string, vector: readonly number[], limit: number): { messageId: string; distance: number }[] {
    const rows = this.#database.prepare(`
      SELECT e.message_id, e.embedding_blob FROM conversation_embeddings e
      JOIN conversation_messages m ON m.id=e.message_id
      JOIN conversation_sessions s ON s.id=m.session_id
      WHERE e.model=? AND s.project_id=?
    `).all(model, projectId) as Row[]
    return rows.map((row) => ({ messageId: String(row.message_id), distance: cosineDistance(vector, [...blobToVector(row.embedding_blob as Buffer)]) }))
      .sort((a, b) => a.distance - b.distance).slice(0, limit)
  }

  #countIndexableMessages(projectId: string): number {
    return Number((this.#database.prepare(`SELECT COUNT(*) AS count FROM conversation_messages m JOIN conversation_sessions s ON s.id=m.session_id WHERE s.project_id=? AND m.content_text<>''`).get(projectId) as Row).count)
  }
  #countStaleMessages(projectId: string, model: string, sessionId?: string): number {
    return Number((this.#database.prepare(`
      SELECT COUNT(*) AS count FROM conversation_messages m
      JOIN conversation_sessions s ON s.id=m.session_id
      LEFT JOIN conversation_embeddings e ON e.message_id=m.id AND e.model=?
      WHERE s.project_id=? AND m.content_text<>''
        ${sessionId ? 'AND m.session_id=?' : ''}
        AND (e.input_hash IS NULL OR e.input_hash<>m.embedding_input_hash
          OR e.embedding_version<>m.embedding_version)
    `).get(...(sessionId ? [model, projectId, sessionId] : [model, projectId])) as Row).count)
  }

  #mapImportSession(row: Row): ConversationImportSessionV1 {
    return {
      schemaVersion: 1, id: String(row.id), projectId: String(row.project_id), sourceKind: String(row.source_kind) as ConversationImportSessionV1['sourceKind'],
      title: String(row.title), sourceFileName: String(row.source_file_name),
      ...(row.expected_bytes === null || row.expected_bytes === undefined ? {} : { expectedBytes: Number(row.expected_bytes) }),
      receivedBytes: Number(row.received_bytes), receivedChunks: Number(row.received_chunks),
      ...(row.workspace_id ? { workspaceId: String(row.workspace_id) } : {}), scopeId: String(row.scope_id),
      status: String(row.status) as ConversationImportSessionV1['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }
  #mapSession(row: Row): ConversationSessionV1 {
    return {
      schemaVersion: 1, id: String(row.id), projectId: String(row.project_id), provider: String(row.provider),
      sourceKind: String(row.source_kind) as ConversationSessionV1['sourceKind'], title: String(row.title), messageCount: Number(row.message_count), sectionCount: Number(row.section_count),
      status: String(row.status) as ConversationSessionV1['status'],
      ...(row.source_content_hash ? { sourceContentHash: String(row.source_content_hash) } : {}),
      ...(row.source_file_name ? { sourceFileName: String(row.source_file_name) } : {}),
      originMeta: json(row.origin_meta_json, {}),
      diagnostics: {
        parsedLines: Number(row.parsed_line_count ?? 0),
        invalidLines: Number(row.invalid_line_count ?? 0),
        ignoredEvents: Number(row.ignored_event_count ?? 0),
        duplicateEvents: Number(row.duplicate_event_count ?? 0),
        matchedFileReferences: Number(row.matched_file_reference_count ?? 0),
      },
      ...(row.conversation_artifact_id ? { conversationArtifactId: String(row.conversation_artifact_id) } : {}),
      ...(row.conversation_view_id ? { conversationViewId: String(row.conversation_view_id) } : {}),
      ...(row.imported_at ? { importedAt: String(row.imported_at) } : {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }
  }
  #mapMessages(rows: readonly Row[]): ConversationMessageV1[] {
    if (rows.length === 0) return []
    const ids = rows.map((row) => String(row.id))
    const refsByMessage = new Map<string, ConversationFileReferenceV1[]>()
    // SQLite builds commonly cap one statement at 999 or 32766 variables.
    // A large imported timeline can contain hundreds of thousands of messages,
    // so hydrate normalized file references in bounded chunks instead of
    // creating one heroic IN (...) clause that collapses under real data.
    for (let start = 0; start < ids.length; start += 500) {
      const chunk = ids.slice(start, start + 500)
      const placeholders = chunk.map(() => '?').join(',')
      const referenceRows = this.#database.prepare(`
        SELECT * FROM conversation_file_references
        WHERE message_id IN (${placeholders})
        ORDER BY message_id, ordinal
      `).all(...chunk) as Row[]
      for (const ref of referenceRows) {
        const messageId = String(ref.message_id)
        const values = refsByMessage.get(messageId) ?? []
        values.push({
          raw: String(ref.raw),
          ...(ref.normalized ? { normalized: String(ref.normalized) } : {}),
          ...(ref.artifact_id ? { artifactId: String(ref.artifact_id) } : {}),
          ...(ref.relation_id ? { relationId: String(ref.relation_id) } : {}),
          inProject: Number(ref.in_project) === 1,
        })
        refsByMessage.set(messageId, values)
      }
    }
    return rows.map((row) => this.#mapMessage(row, refsByMessage.get(String(row.id))))
  }
  #mapMessage(row: Row, normalizedRefs?: readonly ConversationFileReferenceV1[]): ConversationMessageV1 {
    return {
      schemaVersion: 1, id: String(row.id), sessionId: String(row.session_id), seq: Number(row.seq), role: String(row.role) as ConversationMessageV1['role'],
      eventKind: String(row.event_kind), ...(row.source_event_id ? { sourceEventId: String(row.source_event_id) } : {}), contentText: String(row.content_text), createdAt: String(row.created_at),
      ...(row.tool_name ? { toolName: String(row.tool_name) } : {}), ...(row.tool_call_json ? { toolCall: json(row.tool_call_json, {}) } : {}),
      fileRefs: normalizedRefs ?? json(row.file_refs_json, []), ...(row.parent_id ? { parentId: String(row.parent_id) } : {}), pinnedAsDecision: Number(row.pinned_as_decision) === 1,
      ...(row.decision_artifact_id ? { decisionArtifactId: String(row.decision_artifact_id) } : {}), contentHash: String(row.content_hash),
    }
  }
  #mapSection(row: Row): ConversationSectionV1 {
    const annotation = row.source_hash ? {
      schemaVersion: 1 as const, sectionId: String(row.id), sourceHash: String(row.source_hash), title: String(row.annotation_title),
      decisions: json<string[]>(row.decisions_json, []), todos: json<string[]>(row.todos_json, []), involvedFiles: json<string[]>(row.involved_files_json, []),
      status: String(row.annotation_status) as ConversationSectionAnnotationV1['status'], annotatedBy: String(row.annotated_by) as ConversationSectionAnnotationV1['annotatedBy'], annotatedAt: String(row.annotated_at),
    } : undefined
    return { schemaVersion: 1, id: String(row.id), sessionId: String(row.session_id), seq: Number(row.seq), kind: String(row.kind) as ConversationSectionV1['kind'], title: String(row.title), startSeq: Number(row.start_seq), endSeq: Number(row.end_seq), lockedByUser: Number(row.locked_by_user) === 1, derivedAt: String(row.derived_at), ...(annotation ? { annotation } : {}) }
  }
  #mapSemanticStatus(row: Row): ConversationSemanticIndexStatusV1 {
    const rawState = String(row.status)
    const state: ConversationSemanticIndexStatusV1['state'] = rawState === 'running'
      ? 'indexing'
      : rawState === 'pending'
        ? 'not_ready'
        : rawState as ConversationSemanticIndexStatusV1['state']
    return { schemaVersion: 1, projectId: String(row.project_id), provider: 'ollama', model: String(row.model), state, backend: String(row.backend) as ConversationSemanticIndexStatusV1['backend'], indexedMessages: Number(row.indexed_messages), staleMessages: Number(row.stale_messages), ...(row.dimensions ? { dimensions: Number(row.dimensions) } : {}), indexVersion: String(row.index_version ?? EMBEDDING_INDEX_VERSION), ...(row.last_error ? { lastError: String(row.last_error) } : {}), updatedAt: String(row.updated_at) }
  }
  completeResult(conversationId: string): CompleteConversationImportResultV1 {
    const row = this.#database.prepare('SELECT project_id FROM conversation_sessions WHERE id=?').get(conversationId) as Row
    const projection = this.getProjection(String(row.project_id), conversationId)
    if (!projection) throw new Error('Conversation not found.')
    return {
      session: projection.session,
      sections: projection.sections,
      matchedFileReferences: projection.session.diagnostics?.matchedFileReferences ?? 0,
      ignoredDuplicateEvents: projection.session.diagnostics?.duplicateEvents ?? 0,
    }
  }
}
