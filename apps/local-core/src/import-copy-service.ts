import { createHash } from 'node:crypto'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

import type { Artifact, ArtifactRevision, ArtifactView, FileRecord, ProjectId, ScopeId } from '@local-creative-os/domain'

import { SqliteMetadataRepository } from './metadata-repository.js'
import { artifactKindForFile, mimeTypeForFile } from './file-format-registry.js'

const MAX_IMPORT_BYTES = 128 * 1024 * 1024

export interface ImportCopyInput {
  readonly importRequestId: string
  readonly fileName: string
  readonly contentType: string
  readonly bytes: Buffer
  readonly scopeId: string
  readonly position: { readonly x: number; readonly y: number }
}

export interface ImportCopyResult {
  readonly fileRecord: FileRecord
  readonly artifact: Artifact
  readonly revision: ArtifactRevision
  readonly view: ArtifactView
  readonly reused: boolean
}

export class ImportCopyConflictError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportCopyConflictError'
  }
}

function cleanIdPart(value: string): string {
  const cleaned = value.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (cleaned.length === 0) throw new Error('importRequestId is required.')
  return cleaned.slice(0, 80)
}

function safeFileName(value: string): string {
  const base = basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').trim()
  return base.length === 0 ? 'imported-file' : base.slice(0, 120)
}

function hashBytes(bytes: Buffer): FileRecord['observedHash'] {
  return createHash('sha256').update(bytes).digest('hex') as FileRecord['observedHash']
}

function importIdentity(projectId: ProjectId, requestId: string): string {
  return createHash('sha256').update(String(projectId)).update('\0').update(requestId).digest('hex').slice(0, 24)
}

function isInsideDirectory(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === '' || (!fromRoot.startsWith('..') && !fromRoot.match(/^[a-z]:/i))
}

export class ImportCopyService {
  /** F6 P0-A2（20260828）：mutation-driven 索引挂点；缺省不 reindex（search-time repair 兜底）。 */
  readonly #semantic: import('./semantic-index-service.js').SemanticIndexService | undefined

  constructor(readonly repository: SqliteMetadataRepository, semantic?: import('./semantic-index-service.js').SemanticIndexService) {
    this.#semantic = semantic
  }

  async importCopy(projectId: ProjectId, input: ImportCopyInput): Promise<ImportCopyResult> {
    const project = this.repository.getProject(String(projectId))
    if (project === undefined) throw new Error('Project not found.')
    if (input.bytes.byteLength === 0) throw new Error('Imported file is empty.')
    if (input.bytes.byteLength > MAX_IMPORT_BYTES) throw new RangeError('Imported file exceeds the 128 MiB desktop import limit.')
    const requestId = cleanIdPart(input.importRequestId)
    const identity = importIdentity(projectId, requestId)
    const observedHash = hashBytes(input.bytes)
    const importedTitle = safeFileName(input.fileName)

    const matchingFile = this.repository.getFileRecords(String(projectId)).find((record) => String(record.observedHash) === String(observedHash))
    if (matchingFile !== undefined) {
      const matchingArtifact = this.repository.getArtifacts(String(projectId)).find((artifact) => {
        if (artifact.currentRevisionId === undefined) return false
        return String(this.repository.getArtifactRevision(String(artifact.currentRevisionId))?.fileRecordId) === String(matchingFile.id)
      })
      const matchingRevision = matchingArtifact?.currentRevisionId === undefined ? undefined : this.repository.getArtifactRevision(String(matchingArtifact.currentRevisionId))
      const matchingView = matchingArtifact === undefined ? undefined : this.repository.getArtifactViews(String(matchingArtifact.id))[0]
      if (matchingArtifact !== undefined && matchingRevision !== undefined && matchingView !== undefined) {
        return { fileRecord: matchingFile, artifact: matchingArtifact, revision: matchingRevision, view: matchingView, reused: true }
      }
    }

    const ids = {
      fileRecordId: `import-file-${identity}` as FileRecord['id'],
      artifactId: `import-artifact-${identity}` as Artifact['id'],
      revisionId: `import-revision-${identity}` as ArtifactRevision['id'],
      viewId: `import-view-${identity}` as ArtifactView['id'],
    }
    const existingView = this.repository.getArtifactView(String(ids.viewId))
    const existingArtifact = this.repository.getArtifact(String(ids.artifactId))
    const existingRevision = this.repository.getArtifactRevision(String(ids.revisionId))
    const existingFileRecord = this.repository.getFileRecord(String(ids.fileRecordId))
    if (existingView !== undefined && existingArtifact !== undefined && existingRevision !== undefined && existingFileRecord !== undefined) {
      const compatibleReplay = String(existingArtifact.projectId) === String(projectId)
        && String(existingFileRecord.projectId) === String(projectId)
        && existingArtifact.title === importedTitle
        && String(existingRevision.contentHash) === String(observedHash)
        && String(existingView.scopeId) === String(input.scopeId)
      if (!compatibleReplay) {
        throw new ImportCopyConflictError('importRequestId was already used with different import content or placement.')
      }
      return {
        fileRecord: existingFileRecord,
        artifact: existingArtifact,
        revision: existingRevision,
        view: existingView,
        reused: true,
      }
    }

    const importsRoot = resolve(project.rootPath, 'imports')
    await mkdir(importsRoot, { recursive: true })
    const finalName = `${requestId}-${safeFileName(input.fileName)}`
    const finalPath = resolve(join(importsRoot, finalName))
    if (!isInsideDirectory(importsRoot, finalPath)) throw new Error('Import destination escaped project imports directory.')
    const tempPath = `${finalPath}.tmp`
    let published = false
    try {
      await writeFile(tempPath, input.bytes, { flag: 'w' })
      await rename(tempPath, finalPath)
      published = true
    } catch (error: unknown) {
      await rm(tempPath, { force: true })
      throw error
    }
    const fileStat = await stat(finalPath)
    const now = new Date().toISOString()
    const fileRecord: FileRecord = {
      id: ids.fileRecordId,
      projectId,
      observedPath: finalPath,
      observedHash,
      size: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      mimeType: mimeTypeForFile(input.fileName, input.contentType),
      availability: 'current',
      observedAt: now,
    }
    const artifact: Artifact = {
      id: ids.artifactId,
      projectId,
      title: importedTitle,
      kind: artifactKindForFile(input.fileName, mimeTypeForFile(input.fileName, input.contentType)),
      availability: 'available',
      currentRevisionId: ids.revisionId,
      createdAt: now,
      updatedAt: now,
    }
    const revision: ArtifactRevision = {
      id: ids.revisionId,
      artifactId: ids.artifactId,
      fileRecordId: ids.fileRecordId,
      contentHash: observedHash,
      source: 'import',
      status: 'current',
      createdAt: now,
    }
    const view: ArtifactView = {
      id: ids.viewId,
      artifactId: ids.artifactId,
      scopeId: input.scopeId as ScopeId,
      revisionId: ids.revisionId,
      referenceKind: 'primary',
      position: input.position,
      size: artifact.kind === 'image' ? { width: 220, height: 320 } : { width: 220, height: 150 },
      displayMode: ['image', 'pdf', 'presentation'].includes(artifact.kind) ? 'thumbnail' : 'card',
      collapsed: false,
    }

    try {
      this.repository.registerImportedSource(fileRecord, artifact, revision, view)
    } catch (error: unknown) {
      if (published) await rm(finalPath, { force: true })
      await rm(tempPath, { force: true })
      throw error
    }
    // F6 P0-A2：导入即索引（PDF 页文本在此进入索引；图片等 OCR evidence 后再补）。
    if (this.#semantic !== undefined) await this.#semantic.reindexArtifact(String(projectId), String(artifact.id))
    return { fileRecord, artifact, revision, view, reused: false }
  }
}
