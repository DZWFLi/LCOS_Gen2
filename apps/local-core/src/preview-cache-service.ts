import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { ArtifactRevisionId, ContentHash, PreviewRecord } from '@local-creative-os/domain'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import { RendererRegistry } from './renderer-registry.js'

export interface PreviewCacheServiceOptions {
  readonly cacheRoot: string
  readonly rendererRegistry?: RendererRegistry
}

export class PreviewCacheService {
  readonly #repository: SqliteMetadataRepository
  readonly #cacheRoot: string
  readonly #rendererRegistry: RendererRegistry

  constructor(repository: SqliteMetadataRepository, options: PreviewCacheServiceOptions) {
    this.#repository = repository
    this.#cacheRoot = resolve(options.cacheRoot)
    this.#rendererRegistry = options.rendererRegistry ?? new RendererRegistry()
  }

  computeCacheKey(input: {
    readonly sourceContentHash: ContentHash
    readonly rendererId: string
    readonly rendererVersion: string
    readonly previewProfile: string
  }): string {
    return createHash('sha256')
      .update(`${input.sourceContentHash}:${input.rendererId}:${input.rendererVersion}:${input.previewProfile}`)
      .digest('hex')
  }

  async publishReadyPreview(
    revisionId: ArtifactRevisionId,
    previewProfile: string,
    bytes: Uint8Array,
  ): Promise<PreviewRecord> {
    const context = this.#resolveContext(revisionId)
    const renderer = this.#rendererRegistry.select(context.fileRecord, previewProfile)
    if (renderer === undefined) return this.recordUnsupported(revisionId, previewProfile)

    const cacheKey = this.computeCacheKey({
      sourceContentHash: context.revision.contentHash,
      rendererId: renderer.id,
      rendererVersion: renderer.version,
      previewProfile,
    })
    const existing = this.#repository.getPreviewRecordByCacheKey(cacheKey)
    if (existing !== undefined && existing.status === 'ready') return existing

    await mkdir(this.#cacheRoot, { recursive: true })
    const finalPath = resolve(this.#cacheRoot, `${cacheKey}.preview`)
    if (!this.#isInsideCacheRoot(finalPath)) throw new Error('Preview cache path escaped cache root.')
    const tmpPath = `${finalPath}.${randomUUID()}.tmp`
    await writeFile(tmpPath, bytes)
    await rename(tmpPath, finalPath)
    const fileStat = await stat(finalPath)
    const now = new Date().toISOString()
    const record: PreviewRecord = {
      id: (existing?.id ?? randomUUID()) as PreviewRecord['id'],
      projectId: context.artifact.projectId,
      revisionId,
      sourceContentHash: context.revision.contentHash,
      rendererId: renderer.id,
      rendererVersion: renderer.version,
      previewProfile,
      cacheKey,
      cachePath: finalPath,
      mimeType: renderer.outputMimeType,
      size: fileStat.size,
      status: 'ready',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.#repository.upsertPreviewRecord(record)
    return record
  }

  recordUnsupported(revisionId: ArtifactRevisionId, previewProfile: string): PreviewRecord {
    const context = this.#resolveContext(revisionId)
    const rendererId = 'unsupported'
    const rendererVersion = '1'
    const cacheKey = this.computeCacheKey({
      sourceContentHash: context.revision.contentHash,
      rendererId,
      rendererVersion,
      previewProfile,
    })
    const existing = this.#repository.getPreviewRecordByCacheKey(cacheKey)
    if (existing !== undefined) return existing
    const now = new Date().toISOString()
    const record: PreviewRecord = {
      id: randomUUID() as PreviewRecord['id'],
      projectId: context.artifact.projectId,
      revisionId,
      sourceContentHash: context.revision.contentHash,
      rendererId,
      rendererVersion,
      previewProfile,
      cacheKey,
      cachePath: '',
      mimeType: 'application/octet-stream',
      size: 0,
      status: 'unsupported',
      errorMessage: `Unsupported mime type: ${context.fileRecord.mimeType}`,
      createdAt: now,
      updatedAt: now,
    }
    this.#repository.upsertPreviewRecord(record)
    return record
  }

  recordFailed(revisionId: ArtifactRevisionId, previewProfile: string, message: string): PreviewRecord {
    const context = this.#resolveContext(revisionId)
    const renderer = this.#rendererRegistry.select(context.fileRecord, previewProfile)
    const rendererId = renderer?.id ?? 'unresolved'
    const rendererVersion = renderer?.version ?? '1'
    const cacheKey = this.computeCacheKey({
      sourceContentHash: context.revision.contentHash,
      rendererId,
      rendererVersion,
      previewProfile,
    })
    const existing = this.#repository.getPreviewRecordByCacheKey(cacheKey)
    const now = new Date().toISOString()
    const record: PreviewRecord = {
      id: (existing?.id ?? randomUUID()) as PreviewRecord['id'],
      projectId: context.artifact.projectId,
      revisionId,
      sourceContentHash: context.revision.contentHash,
      rendererId,
      rendererVersion,
      previewProfile,
      cacheKey,
      cachePath: '',
      mimeType: renderer?.outputMimeType ?? 'application/octet-stream',
      size: 0,
      status: 'failed',
      errorMessage: message,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    this.#repository.upsertPreviewRecord(record)
    return record
  }

  async deleteCacheFile(record: PreviewRecord): Promise<void> {
    if (!record.cachePath) return
    const target = resolve(record.cachePath)
    if (!this.#isInsideCacheRoot(target)) throw new Error('Refusing to delete preview cache outside cache root.')
    await rm(target, { force: true })
  }

  #resolveContext(revisionId: ArtifactRevisionId) {
    const revision = this.#repository.getArtifactRevision(String(revisionId))
    if (revision === undefined) throw new Error(`ArtifactRevision not found: ${revisionId}`)
    const artifact = this.#repository.getArtifact(String(revision.artifactId))
    if (artifact === undefined) throw new Error(`Artifact not found for revision: ${revisionId}`)
    const fileRecord = this.#repository.getFileRecord(String(revision.fileRecordId))
    if (fileRecord === undefined) throw new Error(`FileRecord not found for revision: ${revisionId}`)
    return { artifact, revision, fileRecord }
  }

  #isInsideCacheRoot(path: string): boolean {
    const normalizedRoot = this.#cacheRoot.endsWith('\\') ? this.#cacheRoot : `${this.#cacheRoot}\\`
    return path === this.#cacheRoot || path.startsWith(normalizedRoot)
  }
}
