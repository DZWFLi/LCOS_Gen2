import { open, stat } from 'node:fs/promises'
import { dirname, extname, relative, resolve } from 'node:path'

import type {
  ImportResourceResultV1,
  ResourceDescriptorV0,
  ResourceId,
  ResourceUnderstandingStatus,
} from '@local-creative-os/contracts'
import type { Artifact, ArtifactRevision, ArtifactView, FileRecord, ProjectId } from '@local-creative-os/domain'

import { ImportCopyService, type ImportCopyInput } from '../import-copy-service.js'
import { SqliteMetadataRepository } from '../metadata-repository.js'
import { AnalyzerRegistry } from './analyzers/analyzer-registry.js'
import { FallbackAnalyzer } from './analyzers/fallback-analyzer.js'
import { JsonAnalyzer } from './analyzers/json-analyzer.js'
import { LinkAnalyzer } from './analyzers/link-analyzer.js'
import { MarkdownAnalyzer } from './analyzers/markdown-analyzer.js'
import { SkillPackageAnalyzer } from './analyzers/skill-package-analyzer.js'
import { TextAnalyzer } from './analyzers/text-analyzer.js'
import { YamlAnalyzer } from './analyzers/yaml-analyzer.js'
import { buildLinkMarkdown } from './link-document.js'
import { randomUUID } from 'node:crypto'
import { ResourceDescriptorService, RESOURCE_ANALYZER_VERSION } from './resource-descriptor-service.js'
import { assertSafeHttpUrl } from './url-security.js'

const CONTENT_PEEK_BYTES = 512 * 1024

export interface ResourceImportUrlInput {
  readonly importRequestId: string
  readonly url: string
  readonly title?: string
  readonly scopeId: string
  readonly position: { readonly x: number; readonly y: number }
  readonly userNote?: string
}

export interface ResourceImportOutcome extends ImportResourceResultV1 {
  readonly fileRecord: FileRecord
  readonly artifact: Artifact
  readonly revision: ArtifactRevision
  readonly view: ArtifactView
  readonly reused: boolean
}

function resourceIdFromFileRecord(fileRecordId: string): ResourceId {
  const identity = String(fileRecordId).replace(/^import-file-/, '')
  return `resource-${identity}` as ResourceId
}

export class UniversalResourceImportService {
  readonly #workerId = `resource-worker-${process.pid}-${randomUUID()}`
  #draining = false

  constructor(
    readonly repository: SqliteMetadataRepository,
    readonly importCopy: ImportCopyService,
    readonly descriptors: ResourceDescriptorService = new ResourceDescriptorService(),
    readonly analyzers: AnalyzerRegistry = new AnalyzerRegistry([
      new MarkdownAnalyzer(),
      new TextAnalyzer(),
      new JsonAnalyzer(),
      new YamlAnalyzer(),
      new SkillPackageAnalyzer(),
      new LinkAnalyzer(),
      new FallbackAnalyzer(),
    ]),
  ) {}

  async importFile(projectId: ProjectId, input: ImportCopyInput): Promise<ResourceImportOutcome> {
    const imported = await this.importCopy.importCopy(projectId, input)
    const originalName = imported.fileRecord.observedPath.split(/[\\/]/).filter(Boolean).at(-1)
    return this.#registerOutcome(projectId, imported, 'file_copy', imported.reused, {
      title: imported.artifact.title,
      extension: extname(imported.fileRecord.observedPath).toLocaleLowerCase('en-US'),
      mediaType: imported.fileRecord.mimeType,
      contentHash: imported.fileRecord.observedHash,
      ...(originalName === undefined ? {} : { originalName }),
    })
  }

  async importUrl(projectId: ProjectId, input: ResourceImportUrlInput): Promise<ResourceImportOutcome> {
    const url = assertSafeHttpUrl(input.url)
    const link = buildLinkMarkdown({
      url: url.href,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.userNote === undefined ? {} : { note: input.userNote }),
    })
    const imported = await this.importCopy.importCopy(projectId, {
      importRequestId: input.importRequestId,
      fileName: link.fileName,
      contentType: 'text/markdown',
      bytes: Buffer.from(link.markdown, 'utf8'),
      scopeId: input.scopeId,
      position: input.position,
    })
    return this.#registerOutcome(projectId, imported, 'link', imported.reused, {
      title: link.title,
      extension: '.link.md',
      mediaType: 'text/markdown',
      contentHash: imported.fileRecord.observedHash,
      originalName: link.fileName,
      normalizedUrl: url.href,
      domain: url.hostname,
      ...(input.userNote === undefined ? {} : { userNote: input.userNote }),
    })
  }

  async afterImport(projectId: ProjectId, imported: {
    readonly fileRecord: FileRecord
    readonly artifact: Artifact
    readonly revision: ArtifactRevision
    readonly view: ArtifactView
    readonly sourceKind?: ImportResourceResultV1['sourceKind']
    readonly reused?: boolean
  }): Promise<ResourceImportOutcome> {
    const originalName = imported.fileRecord.observedPath.split(/[\\/]/).filter(Boolean).at(-1)
    return this.#registerOutcome(projectId, imported, imported.sourceKind ?? 'file_copy', imported.reused ?? false, {
      title: imported.artifact.title,
      extension: extname(imported.fileRecord.observedPath).toLocaleLowerCase('en-US'),
      mediaType: imported.fileRecord.mimeType,
      contentHash: imported.fileRecord.observedHash,
      ...(originalName === undefined ? {} : { originalName }),
    })
  }

  list(projectId: string): ResourceDescriptorV0[] {
    return this.repository.listResourceDescriptors(projectId)
  }

  getDescriptor(projectId: string, resourceId: string): ResourceDescriptorV0 | undefined {
    return this.repository.getResourceDescriptorByResourceId(projectId, resourceId)
  }

  async reanalyze(projectId: string, resourceId: string): Promise<ResourceDescriptorV0 | undefined> {
    const current = this.getDescriptor(projectId, resourceId)
    if (current === undefined) return undefined
    const revision = this.repository.getArtifactRevision(current.sourceRevisionId)
    const fileRecord = revision === undefined ? undefined : this.repository.getFileRecord(String(revision.fileRecordId))
    const content = await this.#readContent(fileRecord?.observedPath)
    const readFile = fileRecord === undefined || current.source.kind !== 'directory'
      ? undefined
      : async (relativePath: string): Promise<string | undefined> => {
          const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
          const manifestText = await this.#readContent(fileRecord.observedPath)
          if (manifestText === undefined) return undefined
          const manifest = JSON.parse(manifestText) as { files?: readonly { path: string }[] }
          if (!manifest.files?.some((file) => file.path === normalized)) return undefined
          const sourceRoot = resolve(dirname(fileRecord.observedPath), 'source')
          const target = resolve(sourceRoot, normalized)
          if (relative(sourceRoot, target).startsWith('..')) return undefined
          return this.#readContent(target)
        }
    const analyzed = await this.descriptors.analyzeResource(current, content ?? '', this.analyzers, undefined, readFile)
    this.repository.replaceResourceDescriptor(analyzed)
    return analyzed
  }

  async drainAnalysisQueue(): Promise<void> {
    if (this.#draining) return
    this.#draining = true
    try {
      for (;;) {
        const job = this.repository.claimResourceAnalysis(this.#workerId)
        if (job === undefined) break
        try {
          const current = this.getDescriptor(job.projectId, job.resourceId)
          if (current === undefined || current.sourceRevisionId !== job.sourceRevisionId) {
            this.repository.completeResourceAnalysis(job.id)
            continue
          }
          await this.reanalyze(job.projectId, job.resourceId)
          this.repository.completeResourceAnalysis(job.id)
        } catch (error) {
          this.repository.failResourceAnalysis(job.id, error instanceof Error ? error.message : String(error))
        }
      }
    } finally {
      this.#draining = false
    }
  }

  #registerOutcome(
    projectId: ProjectId,
    imported: {
      readonly fileRecord: FileRecord
      readonly artifact: Artifact
      readonly revision: ArtifactRevision
      readonly view: ArtifactView
    },
    sourceKind: ImportResourceResultV1['sourceKind'],
    reused: boolean,
    meta: {
      readonly title: string
      readonly extension?: string
      readonly mediaType?: string
      readonly contentHash?: string
      readonly originalName?: string
      readonly normalizedUrl?: string
      readonly domain?: string
      readonly userNote?: string
    },
  ): ResourceImportOutcome {
    const resourceId = resourceIdFromFileRecord(String(imported.fileRecord.id))
    const existing = this.repository.getResourceDescriptorByResourceId(String(projectId), resourceId)
    if (reused && existing !== undefined) {
      return {
        resourceId,
        artifactId: String(imported.artifact.id),
        revisionId: String(imported.revision.id),
        viewId: String(imported.view.id),
        sourceKind,
        understandingStatus: existing.understanding.status as ResourceUnderstandingStatus,
        descriptor: existing,
        fileRecord: imported.fileRecord,
        artifact: imported.artifact,
        revision: imported.revision,
        view: imported.view,
        reused,
      }
    }
    const fast = this.descriptors.buildFastDescriptor({
      projectId: String(projectId),
      resourceId,
      artifactId: String(imported.artifact.id),
      revisionId: String(imported.revision.id),
      title: meta.title,
      sourceKind: meta.normalizedUrl === undefined ? 'file' : 'url',
      ...(meta.originalName === undefined ? {} : { originalName: meta.originalName }),
      ...(meta.mediaType === undefined ? {} : { mediaType: meta.mediaType }),
      ...(meta.extension === undefined ? {} : { extension: meta.extension }),
      ...(meta.normalizedUrl === undefined ? {} : { normalizedUrl: meta.normalizedUrl }),
      ...(meta.domain === undefined ? {} : { domain: meta.domain }),
      ...(meta.contentHash === undefined ? {} : { contentHash: meta.contentHash }),
      ...(meta.userNote === undefined ? {} : { userNote: meta.userNote }),
    })
    this.repository.createResourceDescriptorPending(fast)
    if (meta.userNote !== undefined) {
      this.repository.upsertResourcePolicy({
        projectId: String(projectId), resourceId, trustLevel: 'untrusted', approvedContext: false,
        executable: false, annotation: { note: meta.userNote },
      })
    }
    if (meta.normalizedUrl === undefined) this.#enqueueUnderstanding(String(projectId), resourceId)
    return {
      resourceId,
      artifactId: String(imported.artifact.id),
      revisionId: String(imported.revision.id),
      viewId: String(imported.view.id),
      sourceKind,
      understandingStatus: fast.understanding.status as ResourceUnderstandingStatus,
      descriptor: fast,
      fileRecord: imported.fileRecord,
      artifact: imported.artifact,
      revision: imported.revision,
      view: imported.view,
      reused,
    }
  }

  #enqueueUnderstanding(projectId: string, resourceId: string): void {
    const descriptor = this.getDescriptor(projectId, resourceId)
    if (descriptor === undefined) return
    this.repository.enqueueResourceAnalysis({
      id: `analysis-${randomUUID()}`, projectId, resourceId,
      sourceRevisionId: descriptor.sourceRevisionId, analyzerVersion: RESOURCE_ANALYZER_VERSION,
    })
    setImmediate(() => { void this.drainAnalysisQueue().catch(() => undefined) })
  }

  async #readContent(observedPath: string | undefined): Promise<string | undefined> {
    if (observedPath === undefined) return undefined
    try {
      const fileStat = await stat(observedPath)
      const length = Math.min(fileStat.size, CONTENT_PEEK_BYTES)
      const handle = await open(observedPath, 'r')
      try {
        const buffer = Buffer.alloc(length)
        await handle.read(buffer, 0, length, 0)
        return buffer.toString('utf8')
      } finally {
        await handle.close()
      }
    } catch {
      return undefined
    }
  }
}
