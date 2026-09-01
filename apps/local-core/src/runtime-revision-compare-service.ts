import { readFile } from 'node:fs/promises'

import type { ArtifactRevision, FileRecord } from '@local-creative-os/domain'

import type { SqliteMetadataRepository } from './metadata-repository.js'

export interface RevisionCompareLine {
  readonly type: 'same' | 'add' | 'remove'
  readonly text: string
}

export interface RevisionCompareResult {
  readonly base: { readonly revisionId: string; readonly contentHash: string; readonly size: number; readonly mimeType: string }
  readonly head: { readonly revisionId: string; readonly contentHash: string; readonly size: number; readonly mimeType: string }
  readonly changed: boolean
  readonly contentAvailable: boolean
  readonly diff?: readonly RevisionCompareLine[]
}

const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/yaml', 'application/x-yaml']

function isTextRecord(fileRecord: FileRecord): boolean {
  return TEXT_MIME_PREFIXES.some((prefix) => fileRecord.mimeType.toLocaleLowerCase('en-US').startsWith(prefix))
}

function simpleDiff(baseLines: readonly string[], headLines: readonly string[]): RevisionCompareLine[] {
  const result: RevisionCompareLine[] = []
  const max = Math.max(baseLines.length, headLines.length)
  for (let index = 0; index < max; index += 1) {
    const baseLine = baseLines[index]
    const headLine = headLines[index]
    if (baseLine === undefined) result.push({ type: 'add', text: headLine ?? '' })
    else if (headLine === undefined) result.push({ type: 'remove', text: baseLine })
    else if (baseLine === headLine) result.push({ type: 'same', text: baseLine })
    else {
      result.push({ type: 'remove', text: baseLine })
      result.push({ type: 'add', text: headLine })
    }
  }
  return result
}

export class RuntimeRevisionCompareService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  async compare(baseRevisionId: string, headRevisionId: string): Promise<RevisionCompareResult> {
    const baseRevision = this.repository.getArtifactRevision(baseRevisionId)
    const headRevision = this.repository.getArtifactRevision(headRevisionId)
    if (baseRevision === undefined || headRevision === undefined) {
      throw new Error('Compare requires two existing revisions.')
    }
    const baseFile = this.repository.getFileRecord(String(baseRevision.fileRecordId))
    const headFile = this.repository.getFileRecord(String(headRevision.fileRecordId))
    if (baseFile === undefined || headFile === undefined) {
      throw new Error('Compare requires file records for both revisions.')
    }
    const baseMeta = { revisionId: String(baseRevision.id), contentHash: String(baseRevision.contentHash), size: baseFile.size, mimeType: baseFile.mimeType }
    const headMeta = { revisionId: String(headRevision.id), contentHash: String(headRevision.contentHash), size: headFile.size, mimeType: headFile.mimeType }
    const changed = String(baseRevision.contentHash) !== String(headRevision.contentHash) || baseFile.size !== headFile.size
    const textBase = isTextRecord(baseFile)
    const textHead = isTextRecord(headFile)
    const contentAvailable = textBase && textHead
    if (!contentAvailable) {
      return { base: baseMeta, head: headMeta, changed, contentAvailable: false }
    }
    try {
      const [baseText, headText] = await Promise.all([
        readFile(baseFile.observedPath, 'utf8'),
        readFile(headFile.observedPath, 'utf8'),
      ])
      return {
        base: baseMeta,
        head: headMeta,
        changed,
        contentAvailable: true,
        diff: simpleDiff(baseText.split(/\r?\n/), headText.split(/\r?\n/)),
      }
    } catch {
      return { base: baseMeta, head: headMeta, changed, contentAvailable: false }
    }
  }

  revisionList(artifactId: string): readonly ArtifactRevision[] {
    return this.repository.getArtifactRevisions(artifactId)
  }
}
