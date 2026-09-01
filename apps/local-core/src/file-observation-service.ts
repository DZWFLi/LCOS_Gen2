import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'

import type { Artifact, ArtifactRevision, ArtifactView, ContentHash, FileRecord, FileRecordId } from '@local-creative-os/domain'

import { hashFileSha256 } from './file-registry-service.js'
import { SqliteMetadataRepository } from './metadata-repository.js'

export type FileObservationStatus = FileRecord['availability']

export interface FileObservationResult {
  readonly fileRecord: FileRecord
  readonly artifact?: Artifact
  readonly previousAvailability: FileRecord['availability']
  readonly currentRevisionHash?: ContentHash
  readonly changed: boolean
  readonly revisionCreated: false
}

export interface AdoptExternalChangeResult {
  readonly fileRecord: FileRecord
  readonly artifact: Artifact
  readonly previousRevision: ArtifactRevision
  readonly revision: ArtifactRevision
  readonly updatedViews: readonly ArtifactView[]
}

function artifactAvailabilityFor(fileAvailability: FileRecord['availability']): Artifact['availability'] {
  if (fileAvailability === 'missing') return 'missing'
  if (fileAvailability === 'stale' || fileAvailability === 'unreadable') return 'stale'
  return 'available'
}

export class FileObservationService {
  constructor(readonly repository: SqliteMetadataRepository) {}

  async refresh(fileRecordId: FileRecordId, signal?: AbortSignal): Promise<FileObservationResult> {
    const current = this.repository.getFileRecord(String(fileRecordId))
    if (current === undefined) throw new Error('FileRecord not found.')
    const artifact = this.#artifactForCurrentFileRecord(current)
    const currentRevision = artifact?.currentRevisionId === undefined ? undefined : this.repository.getArtifactRevision(String(artifact.currentRevisionId))
    const now = new Date().toISOString()
    const previousAvailability = current.availability

    let nextFileRecord: FileRecord
    try {
      const info = await stat(current.observedPath)
      if (!info.isFile()) {
        nextFileRecord = { ...current, availability: 'unreadable', observedAt: now }
      } else if (info.size === current.size && info.mtime.toISOString() === current.modifiedAt) {
        const availability = currentRevision?.contentHash === current.observedHash ? 'current' : current.availability
        nextFileRecord = { ...current, availability, observedAt: now }
      } else {
        const observedHash = await hashFileSha256(current.observedPath, signal) as ContentHash
        const availability: FileRecord['availability'] = currentRevision?.contentHash === observedHash ? 'current' : 'stale'
        nextFileRecord = {
          ...current,
          observedHash,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          availability,
          observedAt: now,
        }
      }
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : ''
      nextFileRecord = { ...current, availability: code === 'ENOENT' ? 'missing' : 'unreadable', observedAt: now }
    }

    const nextArtifact = artifact === undefined ? undefined : {
      ...artifact,
      availability: artifactAvailabilityFor(nextFileRecord.availability),
      updatedAt: now,
    }
    this.repository.updateFileObservation(nextFileRecord, nextArtifact)
    return {
      fileRecord: nextFileRecord,
      previousAvailability,
      changed: nextFileRecord.availability !== previousAvailability || nextFileRecord.observedHash !== current.observedHash || nextFileRecord.size !== current.size || nextFileRecord.modifiedAt !== current.modifiedAt,
      revisionCreated: false,
      ...(nextArtifact === undefined ? {} : { artifact: nextArtifact }),
      ...(currentRevision?.contentHash === undefined ? {} : { currentRevisionHash: currentRevision.contentHash }),
    }
  }

  async adopt(fileRecordId: FileRecordId, signal?: AbortSignal): Promise<AdoptExternalChangeResult> {
    const observed = this.repository.getFileRecord(String(fileRecordId))
    if (observed === undefined) throw new Error('FileRecord not found.')
    if (observed.availability !== 'stale') throw new Error('Only a stale FileRecord can be adopted.')
    const artifact = this.#artifactForCurrentFileRecord(observed)
    if (artifact?.currentRevisionId === undefined) throw new Error('Current Artifact Revision not found.')
    const currentRevision = this.repository.getArtifactRevision(String(artifact.currentRevisionId))
    if (currentRevision === undefined) throw new Error('Current Artifact Revision not found.')
    const info = await stat(observed.observedPath)
    if (!info.isFile()) throw new Error('Observed source is not a readable file.')
    const verifiedHash = await hashFileSha256(observed.observedPath, signal) as ContentHash
    if (verifiedHash !== observed.observedHash
      || info.size !== observed.size
      || info.mtime.toISOString() !== observed.modifiedAt) {
      throw new Error('Observed source changed again. Refresh before adopting.')
    }
    const now = new Date().toISOString()
    const nextFileRecord: FileRecord = {
      ...observed,
      id: randomUUID() as FileRecord['id'],
      availability: 'current',
      observedAt: now,
    }
    const previousRevision: ArtifactRevision = {
      ...currentRevision,
      status: 'superseded',
    }
    const revision: ArtifactRevision = {
      id: randomUUID() as ArtifactRevision['id'],
      artifactId: artifact.id,
      fileRecordId: nextFileRecord.id,
      parentRevisionId: currentRevision.id,
      contentHash: nextFileRecord.observedHash,
      source: 'external',
      status: 'current',
      createdAt: now,
    }
    const nextArtifact: Artifact = {
      ...artifact,
      currentRevisionId: revision.id,
      availability: 'available',
      updatedAt: now,
    }
    const updatedViews = this.repository.getArtifactViews(String(artifact.projectId))
      .filter((view) => String(view.artifactId) === String(artifact.id) && String(view.revisionId) === String(currentRevision.id))
      .map((view) => ({ ...view, revisionId: revision.id }))
    this.repository.adoptExternalChange(previousRevision, nextFileRecord, revision, nextArtifact, updatedViews)
    return {
      fileRecord: nextFileRecord,
      artifact: nextArtifact,
      previousRevision,
      revision,
      updatedViews,
    }
  }

  #artifactForCurrentFileRecord(fileRecord: FileRecord): Artifact | undefined {
    return this.repository.getArtifacts(String(fileRecord.projectId))
      .find((artifact) => artifact.currentRevisionId !== undefined
        && this.repository.getArtifactRevision(String(artifact.currentRevisionId))?.fileRecordId === fileRecord.id)
  }
}
