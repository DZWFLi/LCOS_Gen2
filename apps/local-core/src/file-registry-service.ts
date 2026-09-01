import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'

import type {
  Artifact,
  ArtifactRevision,
  FileRecord,
  ProjectId,
} from '@local-creative-os/domain'
import type {
  RegisterTrustedSourceInput,
  RegisterTrustedSourceResult,
  TrustedFileSelection,
  TrustedFileSelectionId,
} from '@local-creative-os/contracts'

import { guardTrustedFilePath } from './path-guard.js'
import { SqliteMetadataRepository } from './metadata-repository.js'
import { artifactKindForFile, mimeTypeForFile } from './file-format-registry.js'

export async function hashFileSha256(path: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  const abort = () => stream.destroy(new DOMException('Hashing aborted.', 'AbortError'))
  signal?.addEventListener('abort', abort, { once: true })
  try {
    for await (const chunk of stream) {
      if (signal?.aborted) throw new DOMException('Hashing aborted.', 'AbortError')
      hash.update(chunk as Buffer)
    }
    return hash.digest('hex')
  } finally {
    signal?.removeEventListener('abort', abort)
    stream.destroy()
  }
}

/**
 * Launcher/native code is the only caller allowed to place a path in this
 * registry. Browser-facing APIs receive only the opaque selection ID.
 */
export class TrustedFileSelectionRegistry {
  readonly #paths = new Map<TrustedFileSelectionId, string>()

  registerTrustedPath(path: string): TrustedFileSelection {
    const id = randomUUID() as TrustedFileSelectionId
    this.#paths.set(id, path)
    return { id, displayName: basename(path) }
  }

  consume(selectionId: TrustedFileSelectionId): string {
    const path = this.#paths.get(selectionId)
    if (path === undefined) throw new Error('Trusted file selection is missing or expired.')
    this.#paths.delete(selectionId)
    return path
  }
}

export interface FileRegistryServiceOptions {
  readonly allowExternalSource?: boolean
}

export class FileRegistryService {
  constructor(
    readonly repository: SqliteMetadataRepository,
    readonly selections: TrustedFileSelectionRegistry,
    readonly options: FileRegistryServiceOptions = {},
  ) {}

  async registerSource(
    projectId: ProjectId,
    input: RegisterTrustedSourceInput,
    signal?: AbortSignal,
  ): Promise<RegisterTrustedSourceResult> {
    const project = this.repository.getProject(String(projectId))
    if (project === undefined) throw new Error('Project not found.')
    const selectedPath = this.selections.consume(input.selectionId)
    const guarded = guardTrustedFilePath(selectedPath, {
      projectRoot: project.rootPath,
      allowExternalSource: this.options.allowExternalSource ?? false,
    })
    const observedHash = await hashFileSha256(guarded.realPath, signal)
    const now = new Date().toISOString()
    const fileRecordId = randomUUID() as FileRecord['id']
    const artifactId = randomUUID() as Artifact['id']
    const revisionId = randomUUID() as ArtifactRevision['id']
    const fileRecord: FileRecord = {
      id: fileRecordId,
      projectId,
      observedPath: guarded.realPath,
      observedHash: observedHash as FileRecord['observedHash'],
      size: guarded.size,
      modifiedAt: guarded.modifiedAt,
      mimeType: mimeTypeForFile(guarded.realPath),
      availability: 'current',
      observedAt: now,
    }
    const artifact: Artifact = {
      id: artifactId,
      projectId,
      title: input.title?.trim() || basename(guarded.realPath),
      kind: artifactKindForFile(guarded.realPath),
      managed: true,
      availability: 'available',
      currentRevisionId: revisionId,
      createdAt: now,
      updatedAt: now,
    }
    const revision: ArtifactRevision = {
      id: revisionId,
      artifactId,
      fileRecordId,
      contentHash: fileRecord.observedHash,
      source: 'import',
      status: 'current',
      createdAt: now,
    }
    this.repository.registerSource(fileRecord, artifact, revision)
    return { fileRecord, artifact, revision }
  }
}
