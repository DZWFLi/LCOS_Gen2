import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaptureReceiptV0, CaptureRequestV0 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { CaptureStagingService } from './capture-staging-service.js'
import type { RuntimeRegistryService } from './runtime-registry-service.js'
import { resolveProjectAffinity } from './project-affinity-service.js'
import { createTextArtifact } from './text-artifact-service.js'
import type { UniversalResourceImportService } from './resources/universal-resource-import-service.js'
import type { CapturePlacementService } from './capture-placement-service.js'

/**
 * Phase C：Capture Application Service。
 * 幂等（operationId → receipt）→ Affinity → 高置信直接进项目 / 不确定进 Staging。
 * 热路径不等 LLM、不等 Ollama；<2s 给 receipt。
 */
export interface CaptureApplicationOptions {
  readonly blobRoot: string
  readonly placement: CapturePlacementService
  /** F6 P0-A2（20260828）：materialize 即索引；缺省不 reindex（search-time repair 兜底）。 */
  readonly semantic?: import('./semantic-index-service.js').SemanticIndexService
}

export class CaptureApplicationService {
  readonly #metadata: SqliteMetadataRepository
  readonly #resources: UniversalResourceImportService
  readonly #staging: CaptureStagingService
  readonly #registry: RuntimeRegistryService
  readonly #semantic: import('./semantic-index-service.js').SemanticIndexService | undefined
  readonly #blobRoot: string
  readonly #placement: CapturePlacementService

  constructor(
    metadata: SqliteMetadataRepository,
    resources: UniversalResourceImportService,
    staging: CaptureStagingService,
    registry: RuntimeRegistryService,
    options: CaptureApplicationOptions,
  ) {
    this.#metadata = metadata
    this.#resources = resources
    this.#staging = staging
    this.#registry = registry
    this.#blobRoot = options.blobRoot
    this.#placement = options.placement
    this.#semantic = options.semantic
  }

  async capture(request: CaptureRequestV0): Promise<CaptureReceiptV0> {
    if (request.schemaVersion !== 0) throw new Error('CaptureRequest schemaVersion must be 0.')
    const existing = this.#metadata.getCaptureReceipt(request.operationId)
    if (existing !== undefined) return existing

    const projectRoots = this.#metadata.listProjects().map((project) => ({ projectId: String(project.id), rootPath: project.rootPath }))
    const affinity = resolveProjectAffinity(
      {
        ...(request.targetHint?.projectId === undefined ? {} : { explicitProjectId: request.targetHint.projectId }),
        ...(request.source.sessionId === undefined ? {} : { sessionId: request.source.sessionId }),
        ...(request.payload.type === 'local_path' ? { localPath: request.payload.path } : {}),
        ...(request.source.browserProfileId !== undefined && request.source.browserTabId !== undefined
          ? { browser: { profileId: request.source.browserProfileId, tabId: request.source.browserTabId } }
          : {}),
        capturedAt: request.source.capturedAt,
      },
      {
        projectRoots,
        registry: this.#registry.getRegistry(),
        now: request.source.capturedAt,
      },
    )

    if (affinity.projectId === undefined || affinity.confidence < 0.8) {
      const staged = await this.#staging.enqueue({
        operationId: request.operationId,
        kind: request.kind,
        ...(await this.#stagingPayloadFor(request)),
        source: request.source as unknown as Record<string, unknown>,
        suggestedProjects: (affinity.candidates ?? []).map((candidate) => ({ projectId: candidate.projectId, score: candidate.score, reason: candidate.reason })),
        capturedAt: request.source.capturedAt,
      })
      const receipt: CaptureReceiptV0 = { operationId: request.operationId, status: 'staged', stagingId: staged.id }
      this.#metadata.saveCaptureReceipt(receipt)
      return receipt
    }

    const imported = await this.#importIntoProject(request, affinity.projectId)
    // F6 P0-A2：materialize 即索引（capture 产出的 artifact 立即可搜，不重启不等 repair）。
    if (this.#semantic !== undefined && !imported.reused) {
      await this.#semantic.reindexArtifact(String(affinity.projectId), imported.artifactId)
    }
    const capturedAt = request.source.capturedAt || new Date().toISOString()
    this.#metadata.saveImportBatch({
      schemaVersion: 1, id: `import-batch-capture-${request.operationId}`, projectId: affinity.projectId,
      sourceKind: 'capture', status: 'completed', scopeId: imported.scopeId,
      importRequestIds: [request.operationId], artifactIds: [imported.artifactId],
      revisionIds: imported.revisionId ? [imported.revisionId] : [], viewIds: [imported.viewId],
      createdAt: capturedAt, completedAt: new Date().toISOString(),
    })
    const receipt: CaptureReceiptV0 = {
      operationId: request.operationId,
      status: imported.reused ? 'reused' : 'created',
      projectId: affinity.projectId,
      artifactId: imported.artifactId,
      ...(imported.resourceId === undefined ? {} : { resourceId: imported.resourceId }),
      viewId: imported.viewId,
      ...(imported.duplicateOf === undefined ? {} : { duplicateOf: imported.duplicateOf }),
    }
    this.#metadata.saveCaptureReceipt(receipt)
    return receipt
  }

  async #stagingPayloadFor(request: CaptureRequestV0): Promise<{ readonly payloadRef?: string; readonly payloadBytes?: Uint8Array }> {
    if (request.payload.type === 'staged_blob') return { payloadRef: request.payload.blobRef }
    if (request.payload.type === 'url') return { payloadRef: request.payload.url }
    if (request.payload.type === 'local_path') return { payloadRef: request.payload.path }
    if (request.payload.type === 'text') return { payloadBytes: new TextEncoder().encode(request.payload.text) }
    return { payloadRef: `operation:${request.operationId}` }
  }

  async #importIntoProject(request: CaptureRequestV0, projectId: string): Promise<{
    readonly artifactId: string
    readonly resourceId?: string
    readonly viewId: string
    readonly revisionId?: string
    readonly scopeId: string
    readonly reused: boolean
    readonly duplicateOf?: string
  }> {
    const scopes = this.#metadata.getScopes(projectId)
    const rootScope = scopes.find((scope) => scope.kind === 'root')
    if (rootScope === undefined) throw new Error('Project has no root scope.')
    const scopeId = request.targetHint?.scopeId ?? String(rootScope.id)
    const title = request.hints?.title ?? request.source.title
    const placement = this.#placement.place({ projectId, scopeId })

    if (request.payload.type === 'url') {
      const imported = await this.#resources.importUrl(projectId as never, {
        importRequestId: request.operationId,
        url: request.payload.url,
        ...(title === undefined ? {} : { title }),
        scopeId: scopeId as never,
        position: placement,
      })
      return {
        artifactId: String(imported.artifactId),
        resourceId: String(imported.resourceId),
        viewId: String(imported.viewId),
        revisionId: String(imported.revisionId),
        scopeId,
        reused: imported.reused,
      }
    }

    if (request.payload.type === 'text') {
      const created = await createTextArtifact(this.#metadata, projectId as never, {
        ...(title === undefined ? {} : { title }),
        body: request.payload.text,
        scopeId: scopeId as never,
        x: placement.x,
        y: placement.y,
      })
      return { artifactId: created.artifactId, revisionId: created.revisionId, viewId: created.viewId, scopeId, reused: false }
    }

    if (request.payload.type === 'local_path') {
      const bytes = await readFile(request.payload.path)
      const imported = await this.#resources.importFile(projectId as never, {
        importRequestId: request.operationId,
        fileName: request.payload.path.split(/[\\/]/).at(-1) ?? 'capture.bin',
        contentType: 'application/octet-stream',
        bytes,
        scopeId: scopeId as never,
        position: placement,
      })
      return {
        artifactId: String(imported.artifactId),
        resourceId: String(imported.resourceId),
        viewId: String(imported.viewId),
        revisionId: String(imported.revisionId),
        scopeId,
        reused: imported.reused,
      }
    }

    if (request.payload.type === 'staged_blob') {
      const blobHash = request.payload.blobRef.replace(/^blob:/, '')
      const bytes = await readFile(join(this.#blobRoot, blobHash))
      const imported = await this.#resources.importFile(projectId as never, {
        importRequestId: request.operationId,
        fileName: `${request.kind}-${blobHash.slice(0, 8)}.png`,
        contentType: 'image/png',
        bytes,
        scopeId: scopeId as never,
        position: placement,
      })
      return {
        artifactId: String(imported.artifactId),
        resourceId: String(imported.resourceId),
        viewId: String(imported.viewId),
        revisionId: String(imported.revisionId),
        scopeId,
        reused: imported.reused,
      }
    }

    throw new Error(`Unsupported capture payload type: ${(request.payload as { type: string }).type}`)
  }
}
