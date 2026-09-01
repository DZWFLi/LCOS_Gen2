import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type {
  Artifact,
  ArtifactView,
  Checkpoint,
  ContractError,
  BuildContextManifestV0Input,
  AcceptArtifactReturnInput,
  AgentExecutionPlanV1,
  MutationBatch,
  Note,
  Project,
  ProjectGraphSnapshot,
  ProjectCatalog,
  Relation,
  RegisterTrustedSourceInput,
  Workspace,
  ValidateProjectRootInput,
  CreateRunProposal,
  CommandDraftV1,
  ProviderSessionBindingV1,
  ImportResourceResultV1,
  CreateConversationImportSessionInputV1,
  CompleteConversationImportInputV1,
  ImportManualConversationInputV1,
  AnnotateConversationSectionInputV1,
  PinConversationMessageInputV1,
  BuildConversationSemanticIndexInputV1,
  CanvasObservationV1,
  CaptureStagingItemV0,
  RunEvent,
} from '@local-creative-os/contracts'
import type { ArtifactReturnId, ArtifactRevisionId, ArtifactViewId, FileRecordId, ProjectId, RunId, WorkspaceId } from '@local-creative-os/domain'

import { failure } from './errors.js'
import { getHealthStatus } from './health.js'
import { ExplicitProjectCatalog } from './project-catalog.js'
import { createProjectRoot, rollbackCreatedProjectRoot, validateProjectRoot } from './project-root.js'
import { MetadataForeignKeyConstraintError, SqliteMetadataRepository } from './metadata-repository.js'
import { FileRegistryService } from './file-registry-service.js'
import { FileObservationService } from './file-observation-service.js'
import { PreviewCacheService } from './preview-cache-service.js'
import { PreviewWorkerService } from './preview-worker-service.js'
import { ImportCopyConflictError, ImportCopyService } from './import-copy-service.js'
import { UniversalResourceImportService } from './resources/universal-resource-import-service.js'
import { ResourcePackageConflictError, ResourcePackageService } from './resources/resource-package-service.js'
import { ResourceUploadSessionService } from './resources/resource-upload-session-service.js'
import { ResourceReader } from './resources/resource-reader.js'
import { ResourceMatcher } from './resources/resource-matcher.js'
import { ContextManifestService } from './context-manifest-service.js'
import { RuntimeReviewService } from './runtime-review-service.js'
import { proposeRun, validateAgentExecutionPlan } from './runtime-proposal-service.js'
import { RuntimeRevisionCompareService } from './runtime-revision-compare-service.js'
import { WorkspaceStateService } from './workspace-state-service.js'
import { ProcessProjectionService } from './process-projection-service.js'
import { LcosprojService } from './lcosproj-service.js'
import { createTextArtifact } from './text-artifact-service.js'
import { planCodexDispatch } from './codex-dispatch-service.js'
import {
  RuntimeApplicationService,
  type CreateRuntimeRunInput,
} from './runtime-application-service.js'
import { ActiveContextConflictError, ActiveContextStore, type ActiveContextInput } from './active-context-store.js'
import { composeLocalCoreServices } from './compose.js'
import { handleRuntimeReviewRoute } from './routes/runtime-reviews.js'
import { handleCanvasRoute } from './routes/canvas.js'
import { handleConnectorsRoute } from './routes/connectors.js'
import { handleContextProposalsRoute } from './routes/context-proposals.js'
import { handleConversationsRoute } from './routes/conversations.js'
import { handleEntityRoute } from './routes/entity.js'
import { handleExecutorRoute } from './routes/executor.js'
import { handleImportsRoute } from './routes/imports.js'
import { handleLcosprojRoute } from './routes/lcosproj.js'
import { handleProjectsRoute } from './routes/projects.js'
import { handleWorkbenchRoute } from './routes/workbench.js'
import { handleContextSnapshotsRoute } from './routes/context-snapshots.js'
import { handleHandoffsRoute } from './routes/handoffs.js'
import { handleResourcesRoute } from './routes/resources.js'
import { handleRuntimeRoute } from './routes/runtime.js'
import { handleF6AssemblyRoute } from './routes/f6-assembly.js'
import { handleConversationIdentityRoute } from './routes/conversation-identity.js'
import { handleRunsRoute } from './routes/runs.js'
import { handlePresentationsRoute } from './routes/presentations.js'
import { handleProjectEventsRoute, handleRealtimeDebugRoute } from './routes/project-events.js'
import { handleWorkflowRoute } from './routes/workflow.js'
import { handleCurationRoute } from './routes/curation.js'
import { handleSpaceRoute } from './routes/space.js'
import { handleAgentletsRoute } from './routes/agentlets.js'
import { handleCuratorRoute } from './routes/curator-dispatch.js'
import { handleSkillAuthorRoute } from './routes/skill-author-dispatch.js'
import { handleEventsRoute } from './routes/events.js'
import { handleRetrievalRoute } from './routes/retrieval.js'
import { handleAttentionRoute } from './routes/attention.js'
import { handleArtifactsRoute } from './routes/artifacts.js'
import { handleChangeSetsRoute } from './routes/change-sets.js'
import { handleRelationsRoute } from './routes/relations.js'
import { handleRevisionWorkflowsRoute } from './routes/revision-workflows.js'
import { handleContinuityRoute } from './routes/continuity.js'
import { handleReceiverRoute } from './routes/receiver.js'
import { handleWorkspaceStatesRoute } from './routes/workspace-states.js'
import { handleNavigationMarkersRoute } from './routes/navigation-markers.js'
import { handleColorPinsRoute } from './routes/color-pins.js'
import { handleVoiceTranscriptionRoute } from './routes/voice-transcription.js'
import type { VoiceTranscriptionService } from './voice-transcription-service.js'
import { createDefaultVoiceTranscriptionService } from './voice-transcription-defaults.js'
import { FORBIDDEN_BROWSER_PATH_FIELDS, isRecord, isStringArray, routeRequireMetadata, routeRequireProject } from './routes/route-context.js'
import { ContextProposalStore } from './context-proposal-store.js'
import { RuntimeRegistryService } from './runtime-registry-service.js'
import { OcrService } from './ocr-service.js'
import { IntelligenceProviderService } from './intelligence-provider-service.js'
import { revealRegisteredPath } from './os-integration.js'
import { CaptureGatewayError, CaptureGatewayService } from './capture-gateway-service.js'
import { StagingProjectService } from './staging-project-service.js'
import { selectNativeDirectory, type DirectoryPickerInput, type DirectoryPickerResult } from './native-directory-picker.js'
import { indexProjectRoot, inspectProjectRoot } from './project-root-indexer.js'
import { ObsidianConnectorSessionStore, ObsidianReadOnlyConnector } from './connectors/obsidian-connector.js'
import { ResourceConnectorRegistry } from './connectors/connector-port.js'
import { ConversationImportService } from './conversation-import-service.js'

const LOOPBACK_HOST = '127.0.0.1'
const MAX_BODY_BYTES = 1 * 1024 * 1024 // 1 MiB
const MAX_IMPORT_BODY_BYTES = 130 * 1024 * 1024 // 128 MiB file + multipart overhead
const MAX_DOCUMENT_PREVIEW_BYTES = 128 * 1024 * 1024
const MAX_LCOSPROJ_BODY_BYTES = 128 * 1024 * 1024
const MAX_VOICE_TRANSCRIPTION_BODY_BYTES = 32 * 1024 * 1024
const VOICE_TRANSCRIPTION_REQUEST_TIMEOUT_MS = 130_000
function isAbsolutePath(value: string): boolean {
  return isAbsolute(value)
}

function internalBridgeOrigin(): string {
  const value = process.env.LCOS_BRIDGE_URL ?? 'http://127.0.0.1:43122'
  const url = new URL(value)
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) {
    throw new Error('Light Bridge must use a loopback URL.')
  }
  return url.origin
}

async function bridgeProxy(path: string, input: { readonly method?: string; readonly body?: unknown }, signal: AbortSignal): Promise<{ readonly status: number; readonly body: unknown }> {
  const response = await fetch(new URL(path, `${internalBridgeOrigin()}/`), {
    method: input.method ?? 'GET',
    signal,
    headers: { accept: 'application/json', ...(input.body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  })
  const body = await response.json().catch(() => ({ ok: false, error: { code: 'BRIDGE_PROTOCOL_ERROR', message: `Light Bridge returned HTTP ${response.status}.` } }))
  return { status: response.status, body }
}
function publicResourceImportResult(value: ImportResourceResultV1): ImportResourceResultV1 {
  return {
    resourceId: value.resourceId,
    artifactId: value.artifactId,
    revisionId: value.revisionId,
    ...(value.viewId === undefined ? {} : { viewId: value.viewId }),
    sourceKind: value.sourceKind,
    understandingStatus: value.understandingStatus,
    ...(value.descriptor === undefined ? {} : { descriptor: value.descriptor }),
  }
}

export const LOCAL_CORE_DEV_PORT = 43121

function createProjectId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'project'
  return `project-${slug}-${randomUUID().slice(0, 8)}`
}

export interface LocalCoreServerOptions {
  readonly host?: string
  readonly port?: number
  readonly catalog?: ProjectCatalog
  readonly allowedRoot?: string
  readonly requestTimeoutMs?: number
  readonly metadataRepository?: SqliteMetadataRepository
  readonly fileRegistryService?: FileRegistryService
  readonly fileObservationService?: FileObservationService
  readonly previewWorkerService?: PreviewWorkerService
  readonly importCopyService?: ImportCopyService
  readonly resourceImportService?: UniversalResourceImportService
  readonly resourcePackageService?: ResourcePackageService
  readonly resourceReader?: ResourceReader
  readonly resourceMatcher?: ResourceMatcher
  readonly contextManifestService?: ContextManifestService
  readonly runtimeReviewService?: RuntimeReviewService
  readonly runtimeApplicationService?: RuntimeApplicationService
  readonly previewCacheRoot?: string
  readonly activeContextStore?: ActiveContextStore
  readonly contextProposalStore?: ContextProposalStore
  readonly apiToken?: string
  readonly allowedOrigins?: readonly string[]
  readonly ocr?: OcrService
  readonly directoryPicker?: (input: DirectoryPickerInput) => Promise<DirectoryPickerResult>
  readonly obsidianConnector?: ObsidianReadOnlyConnector
  readonly obsidianSessions?: ObsidianConnectorSessionStore
  readonly connectorRegistry?: ResourceConnectorRegistry
  readonly conversationImportService?: ConversationImportService
  readonly workbenchService?: import('./workbench-service.js').WorkbenchService
  readonly contextSnapshotService?: import('./context-snapshot-service.js').ContextSnapshotService
  readonly runtimeRegistryService?: RuntimeRegistryService
  readonly intelligenceService?: IntelligenceProviderService
  /** @deprecated use intelligenceService */
  readonly localIntelligenceService?: IntelligenceProviderService
  readonly captureStagingService?: import('./capture-staging-service.js').CaptureStagingService
  readonly captureApplicationService?: import('./capture-application-service.js').CaptureApplicationService
  readonly captureWatchService?: import('./capture-watch-service.js').CaptureWatchService
  readonly reorganizeService?: import('./reorganize-service.js').ReorganizeService
  readonly sessionReadSet?: import('./session-read-set.js').SessionReadSet
  /** 任务四 P3：agentlet 包根目录（缺省 packages/agentlets）。 */
  readonly agentletsRoot?: string
  readonly voiceTranscriptionService?: VoiceTranscriptionService
}

export interface LocalCoreAddress {
  readonly host: typeof LOOPBACK_HOST
  readonly port: number
}

export interface LocalCoreServer {
  start(signal?: AbortSignal): Promise<LocalCoreAddress>
  close(): Promise<void>
  address(): LocalCoreAddress | undefined
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}


function sendBinary(response: ServerResponse, statusCode: number, bytes: Buffer, fileName: string, contentType = 'application/octet-stream'): void {
  const asciiName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'download.bin'
  response.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': String(bytes.length),
    'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    'cache-control': 'no-store',
  })
  response.end(bytes)
}

function formatMetadataError(error: unknown, fallback: string): string {
  if (error instanceof MetadataForeignKeyConstraintError) {
    const context = error.context
    const fkCheck = context.foreignKeyCheck
      .map((row) => `${row.table}:${row.rowid}->${row.parent}#${row.fkid}`)
      .join(',') || 'none'
    return [
      error.message,
      `operation=${context.operationType}`,
      `entity=${context.entityId}`,
      `table=${context.table}`,
      `field=${context.foreignKeyColumn}`,
      `referenced=${context.referencedTable}:${context.referencedId}`,
      `statement=${context.statement}`,
      `foreign_key_check=${fkCheck}`,
    ].join(' | ')
  }
  return error instanceof Error ? error.message : fallback
}

async function readJsonBody(request: IncomingMessage, signal: AbortSignal): Promise<unknown> {
  return JSON.parse((await readRawBody(request, signal, MAX_BODY_BYTES)).toString('utf8'))
}

async function readRawBody(request: IncomingMessage, signal: AbortSignal, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    if (signal.aborted) throw new DOMException('Request aborted', 'AbortError')
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) throw new RangeError('Request body is too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function withAbort<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) throw new DOMException('Operation aborted', 'AbortError')

  let abort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new DOMException('Operation aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
  })

  try {
    return await Promise.race([operation, aborted])
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort)
  }
}

function statusForError(code: string): number {
  if (code === 'PROJECT_ROOT_NOT_FOUND' || code === 'NOT_FOUND') return 404
  if (code === 'UNAVAILABLE') return 503
  if (code === 'ABORTED') return 499
  if (code === 'STALE_GRAPH_VERSION') return 409
  return 400
}

function requireMetadata(metadata: SqliteMetadataRepository | undefined, response: ServerResponse): metadata is SqliteMetadataRepository {
  if (metadata === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Metadata repository is not configured.'))
    return false
  }
  return true
}

function requireProject(projectId: string, metadata: SqliteMetadataRepository, response: ServerResponse): Project | undefined {
  const project = metadata.getProject(projectId)
  if (project === undefined) {
    sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
    return undefined
  }
  return project
}

export function createLocalCoreServer(options: LocalCoreServerOptions = {}): LocalCoreServer {
  const host = options.host ?? LOOPBACK_HOST
  if (host !== LOOPBACK_HOST) {
    throw new Error('Local Core may only bind to 127.0.0.1.')
  }
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000
  const apiToken = options.apiToken
  const ocr = options.ocr ?? new OcrService({
    scriptPath: fileURLToPath(new URL('../../../scripts/ocr/run_ocr.py', import.meta.url)),
    runtimeDir: process.env.LCOS_OCR_RUNTIME_DIR ?? fileURLToPath(new URL('../../../.codex-runtime/ocr-runtime', import.meta.url)),
    ...(process.env.LCOS_OCR_PYTHON === undefined ? {} : { pythonCommand: process.env.LCOS_OCR_PYTHON }),
  })
  const allowedOrigins = new Set(options.allowedOrigins ?? ['http://127.0.0.1:5173', 'http://localhost:5173'])
  const voiceTranscription = options.voiceTranscriptionService ?? createDefaultVoiceTranscriptionService()
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error('Local Core requestTimeoutMs must be a positive finite number.')
  }

  const services = composeLocalCoreServices(options)
  const {
    catalog, metadata, fileRegistry, fileObservation, importCopy, resources, packages, uploads,
    resourceReader, matcher, contextManifest, runtimeReview, runtimeApplication, activeContext,
    contextProposals, runEventListeners, obsidian, obsidianSessions, connectorRegistry,
    ownsConversationService, conversations, previewWorker, presentation, curation, search, curationCommand, semantic, warehouse, resultSlots, assemblyApply, projectSummary, skillCatalog, skillPackages, skillProposals, companionProjections, curatorDispatch, skillAuthorDispatch,
    runtimeRegistry, intelligence, captureStaging, resolveProjectAffinity, captureApplication, captureWatch, captureSpace, reorganize, sessionReadSet, spaceSandbox, agentletRuntime, spatialRetrieval, attentionRuntime, boundaryEvaluator, projectEvents, projectMutations, mutationSafety, feedbackRevision, continuityRuntime, receiverRuntime, sessionLifecycle, conversationIdentity,
  } = services
  metadata?.setRunEventSink?.((event) => {
    const payloadProjectId = (event.payload as { projectId?: string } | null)?.projectId
    const runProjectId = payloadProjectId ?? metadata.getRun(event.runId)?.projectId
    const projectId = String(runProjectId ?? '')
    const listeners = runEventListeners.get(projectId)
    if (listeners === undefined) return
    for (const listener of listeners) {
      try { listener() } catch { /* 推送失败不影响 Run 生命周期 */ }
    }
    projectEvents.publish(projectId, {
      channel: 'run',
      type: 'run.changed',
      entityRefs: [String(event.runId)],
      payload: { runId: String(event.runId), sequence: event.sequence, type: event.type },
    })
  })
  let server: Server | undefined
  let currentAddress: LocalCoreAddress | undefined
  let lifecycleSignal: AbortSignal | undefined
  let lifecycleAbort: (() => void) | undefined

  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const controller = new AbortController()
    let timedOut = false
    const effectiveRequestTimeoutMs = request.url?.startsWith('/runtime/voice/transcriptions')
      ? Math.max(requestTimeoutMs, VOICE_TRANSCRIPTION_REQUEST_TIMEOUT_MS)
      : requestTimeoutMs
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, effectiveRequestTimeoutMs)
    const abort = () => controller.abort()
    request.once('aborted', abort)
    response.once('close', () => {
      if (!response.writableEnded) abort()
    })

    try {
      const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`)
      const method = request.method ?? 'GET'
      const pathname = url.pathname
      const routeHelpers = { sendJson, failure, readJsonBody, readRawBody, isRecord, isStringArray, withAbort, statusForError, sendBinary }

      const hostHeader = request.headers.host ?? ''
      const requestHost = hostHeader.replace(/^\[|\](:\d+)?$/g, '').split(':')[0]?.toLowerCase()
      if (requestHost !== '127.0.0.1' && requestHost !== 'localhost' && requestHost !== '::1') {
        sendJson(response, 403, failure('VALIDATION', 'Local Core Host must be loopback.'))
        return
      }
      const origin = request.headers.origin
      const isExtensionOrigin = typeof origin === 'string' && origin.startsWith('chrome-extension://')
      if (origin !== undefined && !isExtensionOrigin && !allowedOrigins.has(origin)) {
        sendJson(response, 403, failure('VALIDATION', 'Origin is not allowed.'))
        return
      }

      // ---- Health ----
      if (method === 'GET' && pathname === '/health') {
        sendJson(response, 200, getHealthStatus())
        return
      }

      // Phase 5 §8.5：capture/v1 网关走扩展 token（x-lcos-token），不要求 core Bearer。
      if (method === 'POST' && pathname === '/capture/v1') {
        const gateway = new CaptureGatewayService(
          captureApplication,
          captureStaging,
          runtimeRegistry,
          metadata,
          process.env.LCOS_CAPTURE_STAGING_ROOT ?? join(homedir(), '.lcos', 'capture-staging', 'blobs'),
        )
        let body: Buffer
        try {
          body = await routeHelpers.readRawBody(request, controller.signal, 12 * 1024 * 1024)
        } catch {
          sendJson(response, 413, failure('INVALID_ARGUMENT', 'CaptureRequestV1 body must be under 12 MiB.'))
          return
        }
        let input: unknown
        try { input = JSON.parse(body.toString('utf8')) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'CaptureRequestV1 body must be valid JSON.'))
          return
        }
        try {
          const rawToken = request.headers['x-lcos-token']
          const rawOrigin = request.headers.origin
          const result = await gateway.submit(input, {
            token: Array.isArray(rawToken) ? rawToken[0] : rawToken,
            origin: Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin,
            trusted: apiToken !== undefined && validBearerToken(request.headers.authorization, apiToken),
          })
          sendJson(response, 201, { ok: true, value: result })
        } catch (error) {
          if (error instanceof CaptureGatewayError) {
            sendJson(response, error.status, failure(error.code as never, error.message))
          } else {
            sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Capture gateway failed.'))
          }
        }
        return
      }

      // Phase 5 §8.5：扩展 token 获取（仅本机回环；正式版由 Runtime Host/native messaging 接管）。
      if (method === 'POST' && pathname === '/runtime/extension-token') {
        if (runtimeRegistry === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Runtime registry is not configured.'))
          return
        }
        sendJson(response, 200, { ok: true, value: { token: runtimeRegistry.ensureExtensionToken() } })
        return
      }

      if (apiToken !== undefined && !validBearerToken(request.headers.authorization, apiToken)) {
        sendJson(response, 401, failure('VALIDATION', 'Local Core authorization is required.'))
        return
      }

      if (await handleVoiceTranscriptionRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        helpers: routeHelpers,
        voiceTranscription,
        maxBodyBytes: MAX_VOICE_TRANSCRIPTION_BODY_BYTES,
      })) return

      if (await handleConnectorsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        connectorRegistry,
        obsidian,
        obsidianSessions,
        resources,
        directoryPicker: options.directoryPicker ?? selectNativeDirectory,
        helpers: routeHelpers,
      })) return
      if (await handleExecutorRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        bridgeProxy,
        helpers: routeHelpers,
      })) return
      if (await handleConversationsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        conversations,
        helpers: routeHelpers,
      })) return
      if (await handleConversationIdentityRoute({
        method,
        pathname,
        url,
        request,
        response,
        signal: controller.signal,
        metadata,
        identity: conversationIdentity,
        helpers: routeHelpers,
      })) return

      // ---- Phase A: Runtime Registry + Focus Signal + Reveal + Local Intelligence ----
      const focusMatch = /^\/runtime\/projects\/([^/]+)\/focus$/.exec(pathname)
      if (method === 'POST' && focusMatch !== null) {
        const projectId = decodeURIComponent(focusMatch[1] ?? '')
        if (projectId.length === 0 || projectId.length > 200) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Invalid project id.'))
          return
        }
        if (metadata !== undefined && metadata.getProject(projectId) === undefined) {
          sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
          return
        }
        const registry = runtimeRegistry.recordFocus(projectId)
        sendJson(response, 200, { ok: true, value: registry })
        return
      }

      if (method === 'GET' && pathname === '/runtime/registry') {
        sendJson(response, 200, { ok: true, value: runtimeRegistry.getRegistry() })
        return
      }

      if (method === 'POST' && pathname === '/runtime/registry/capture-target') {
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 64 KiB.'))
          return
        }
        if (!isRecord(input) || !('projectId' in input) || (input.projectId !== null && typeof input.projectId !== 'string')) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'capture-target requires projectId or null.'))
          return
        }
        const projectId = input.projectId
        if (typeof projectId === 'string' && metadata !== undefined && metadata.getProject(projectId) === undefined) {
          sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
          return
        }
        const registry = runtimeRegistry.setPinnedCaptureProject(projectId)
        sendJson(response, 200, { ok: true, value: registry })
        return
      }

      if (method === 'GET' && (pathname === '/runtime/intelligence' || pathname === '/runtime/local-intelligence')) {
        try {
          sendJson(response, 200, { ok: true, value: await intelligence.status() })
        } catch (error: unknown) {
          sendJson(response, 503, failure('UNAVAILABLE', error instanceof Error ? error.message : 'Intelligence provider probe failed.'))
        }
        return
      }

      // ---- Phase B: Project Affinity + Capture Staging ----
      if (method === 'POST' && pathname === '/capture') {
        if (captureApplication === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture application service is not configured.'))
          return
        }
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 1 MiB.'))
          return
        }
        if (!isRecord(input) || typeof input.operationId !== 'string' || !isRecord(input.source) || !isRecord(input.payload)) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Capture requires operationId, source, payload.'))
          return
        }
        try {
          const receipt = await captureApplication.capture(input as unknown as import('@local-creative-os/contracts').CaptureRequestV0)
          sendJson(response, 201, { ok: true, value: receipt })
        } catch (error: unknown) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Capture failed.'))
        }
        return
      }

      if (method === 'POST' && pathname === '/runtime/affinity/resolve') {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 64 KiB.'))
          return
        }
        if (!isRecord(input) || typeof input.capturedAt !== 'string') {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Affinity resolve requires capturedAt and a valid input.'))
          return
        }
        const projectRoots = db.listProjects().map((project) => ({ projectId: String(project.id), rootPath: project.rootPath }))
        const result = resolveProjectAffinity(input as unknown as Parameters<typeof resolveProjectAffinity>[0], {
          projectRoots,
          registry: runtimeRegistry.getRegistry(),
          now: input.capturedAt,
        })
        sendJson(response, 200, { ok: true, value: result })
        return
      }

      if (method === 'POST' && pathname === '/runtime/captures/staging') {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        if (captureStaging === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture staging service is not configured.'))
          return
        }
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 64 KiB.'))
          return
        }
        if (!isRecord(input) || typeof input.operationId !== 'string' || typeof input.kind !== 'string'
          || !isRecord(input.source) || !Array.isArray(input.suggestedProjects)) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Staging enqueue requires operationId, kind, source, suggestedProjects.'))
          return
        }
        try {
          const item = await captureStaging.enqueue({
            operationId: input.operationId,
            kind: input.kind,
            ...(typeof input.payloadRef === 'string' ? { payloadRef: input.payloadRef } : {}),
            source: input.source as Record<string, unknown>,
            suggestedProjects: input.suggestedProjects as CaptureStagingItemV0['suggestedProjects'],
            ...(typeof input.capturedAt === 'string' ? { capturedAt: input.capturedAt } : {}),
          })
          sendJson(response, 201, { ok: true, value: item })
        } catch (error: unknown) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Failed to enqueue capture.'))
        }
        return
      }

      if (method === 'GET' && pathname === '/runtime/captures/staging') {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        // F6 B6（P0-D）：真分页——repository 级 pendingOnly/search/kind/sourceDomain + LIMIT/OFFSET，
        // 排序 captured_at DESC + id ASC；不再"listRecent 先截 50 再分页"，pending truth 完整可浏览。
        const search = (url.searchParams.get('search') ?? '').trim()
        const kind = url.searchParams.get('kind') ?? ''
        const sourceDomain = (url.searchParams.get('sourceDomain') ?? '').trim()
        const limitParam = Number(url.searchParams.get('limit'))
        const pageLimit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(500, Math.trunc(limitParam)) : 50
        const cursorRaw = url.searchParams.get('cursor') ?? ''
        const cursorOffset = /^offset:(\d+)$/.test(cursorRaw) ? Number(cursorRaw.slice(7)) : 0
        // 多取一行探测是否有下一页。
        const rows = db.queryCaptureStagingItems({
          pendingOnly: true,
          ...(search === '' ? {} : { search }),
          ...(kind === '' ? {} : { kind }),
          ...(sourceDomain === '' ? {} : { sourceDomain }),
          cursor: cursorOffset,
          limit: pageLimit + 1,
        })
        const items = rows.slice(0, pageLimit)
        sendJson(response, 200, {
          ok: true,
          value: {
            items,
            pendingCount: db.countPendingCaptureStagingItems(),
            ...(rows.length > pageLimit ? { nextCursor: `offset:${cursorOffset + pageLimit}` } : {}),
          },
        })
        return
      }

      // Desktop Capture Float：Core Bearer 已验证，复用 Capture Gateway 契约并强制进入全局 Capture Space。
      if (method === 'POST' && pathname === '/runtime/capture-space/enqueue') {
        if (captureApplication === undefined || captureStaging === undefined || metadata === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture gateway is not configured.'))
          return
        }
        let input: unknown
        try {
          const body = await readRawBody(request, controller.signal, 12 * 1024 * 1024)
          input = JSON.parse(body.toString('utf8'))
        } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Capture request must be valid JSON under 12 MiB.'))
          return
        }
        if (!isRecord(input) || input.schemaVersion !== 1 || !isRecord(input.target) || input.target.mode !== 'staging') {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Desktop Capture Float only accepts CaptureRequestV1 with target.mode=staging.'))
          return
        }
        try {
          const gateway = new CaptureGatewayService(
            captureApplication,
            captureStaging,
            runtimeRegistry,
            metadata,
            process.env.LCOS_CAPTURE_STAGING_ROOT ?? join(homedir(), '.lcos', 'capture-staging', 'blobs'),
          )
          const value = await gateway.submitTrusted(input)
          sendJson(response, 201, { ok: true, value })
        } catch (error) {
          if (error instanceof CaptureGatewayError) {
            sendJson(response, error.status, failure(error.code as never, error.message))
          } else {
            sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Desktop capture failed.'))
          }
        }
        return
      }

      // 0.1 Capture Space：系统级暂存画布，不属于任何 Project。
      if (method === 'GET' && pathname === '/runtime/capture-space') {
        if (captureSpace === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture Space is not configured.'))
          return
        }
        const limit = Number(url.searchParams.get('limit'))
        const snapshot = captureSpace.snapshot(Number.isFinite(limit) && limit > 0 ? limit : 500)
        sendJson(response, 200, { ok: true, value: { schemaVersion: 1, ...snapshot } })
        return
      }

      if (method === 'PUT' && pathname === '/runtime/capture-space/presentation') {
        if (captureSpace === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture Space is not configured.'))
          return
        }
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Capture Space presentation must be valid JSON.'))
          return
        }
        if (!isRecord(input) || !Array.isArray(input.views) || !Array.isArray(input.regions)) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Capture Space presentation requires views and regions arrays.'))
          return
        }
        try {
          const presentationValue = captureSpace.savePresentation({
            schemaVersion: 1,
            views: input.views as never,
            regions: input.regions as never,
          }, typeof input.expectedVersion === 'number' ? input.expectedVersion : undefined)
          sendJson(response, 200, { ok: true, value: presentationValue })
        } catch (error) {
          sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Capture Space presentation conflict.'))
        }
        return
      }

      const capturePreviewMatch = /^\/runtime\/capture-space\/items\/([^/]+)\/preview$/.exec(pathname)
      if (method === 'GET' && capturePreviewMatch !== null) {
        if (captureSpace === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture Space is not configured.'))
          return
        }
        try {
          const value = await captureSpace.preview(decodeURIComponent(capturePreviewMatch[1] ?? ''))
          sendJson(response, 200, { ok: true, value })
        } catch (error) {
          sendJson(response, 404, failure('NOT_FOUND', error instanceof Error ? error.message : 'Capture payload not found.'))
        }
        return
      }

      if (method === 'POST' && pathname === '/runtime/capture-space/organize') {
        if (captureSpace === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture Space is not configured.'))
          return
        }
        try {
          const value = await captureSpace.organize()
          sendJson(response, 200, { ok: true, value })
        } catch (error) {
          sendJson(response, 503, failure('UNAVAILABLE', error instanceof Error ? error.message : 'Capture Space organize failed.'))
        }
        return
      }

      if (method === 'POST' && pathname === '/runtime/capture-space/materialize') {
        if (captureSpace === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture Space is not configured.'))
          return
        }
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Capture materialize request must be valid JSON.'))
          return
        }
        if (!isRecord(input) || !Array.isArray(input.captureIds) || input.captureIds.some((id) => typeof id !== 'string') || typeof input.projectId !== 'string') {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Capture materialize requires captureIds[] and projectId.'))
          return
        }
        try {
          const value = await captureSpace.materializeToProject(input.captureIds as string[], input.projectId)
          sendJson(response, 201, { ok: true, value })
        } catch (error) {
          sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Capture materialize failed.'))
        }
        return
      }

      // Phase 5 §8.11：从暂存区创建项目。
      if (method === 'POST' && pathname === '/runtime/captures/create-project') {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        if (captureStaging === undefined || resources === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture staging import is not configured.'))
          return
        }
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 64 KiB.'))
          return
        }
        if (!isRecord(input) || !Array.isArray(input.captureIds) || input.captureIds.some((id) => typeof id !== 'string')
          || (input.titleMode !== undefined && input.titleMode !== 'auto')) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'create-project requires captureIds and titleMode auto.'))
          return
        }
        try {
          const service = new StagingProjectService(
            db,
            captureStaging,
            resources,
            process.env.LCOS_CAPTURE_STAGING_ROOT ?? join(homedir(), '.lcos', 'capture-staging', 'blobs'),
          )
          const result = await service.createProject({
            captureIds: input.captureIds as string[],
            titleMode: 'auto',
            ...(typeof input.parentPath === 'string' ? { parentPath: input.parentPath } : {}),
          })
          sendJson(response, 201, { ok: true, value: result })
        } catch (error: unknown) {
          sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Create project from staging failed.'))
        }
        return
      }

      const stagingResolveMatch = /^\/runtime\/captures\/([^/]+)\/resolve$/.exec(pathname)
      if (method === 'POST' && stagingResolveMatch !== null) {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        if (captureStaging === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture staging service is not configured.'))
          return
        }
        const captureId = decodeURIComponent(stagingResolveMatch[1] ?? '')
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
          return
        }
        if (!isRecord(input) || typeof input.projectId !== 'string') {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Resolve requires projectId.'))
          return
        }
        if (db.getProject(input.projectId) === undefined) {
          sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
          return
        }
        const resolved = captureStaging.resolve(captureId, input.projectId)
        if (!resolved) {
          sendJson(response, 404, failure('NOT_FOUND', 'Capture item not found or already resolved.'))
          return
        }
        sendJson(response, 200, { ok: true, value: { id: captureId, resolvedProjectId: input.projectId } })
        return
      }

      if (method === 'POST' && pathname === '/runtime/registry/browser-tab') {
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
          return
        }
        if (!isRecord(input) || typeof input.profileId !== 'string' || typeof input.tabId !== 'number'
          || (input.projectId !== null && typeof input.projectId !== 'string')) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'browser-tab requires profileId, tabId, projectId|null.'))
          return
        }
        const registry = runtimeRegistry.setBrowserTabBinding(input.profileId, input.tabId, input.projectId)
        sendJson(response, 200, { ok: true, value: registry })
        return
      }

      if (pathname === '/runtime/capture-watch/rules' && (method === 'GET' || method === 'POST' || method === 'DELETE')) {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        if (captureWatch === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Capture watch service is not configured.'))
          return
        }
        if (method === 'GET') {
          sendJson(response, 200, { ok: true, value: captureWatch.listRules() })
          return
        }
        if (method === 'DELETE') {
          const id = url.searchParams.get('id')
          if (id === null || id.length === 0) {
            sendJson(response, 400, failure('INVALID_ARGUMENT', 'DELETE requires ?id='))
            return
          }
          sendJson(response, 200, { ok: true, value: { deleted: captureWatch.deleteRule(id) } })
          return
        }
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
          return
        }
        if (!isRecord(input) || typeof input.id !== 'string' || typeof input.path !== 'string' || !Array.isArray(input.patterns)) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Watch rule requires id, path, patterns.'))
          return
        }
        captureWatch.upsertRule({
          id: input.id,
          path: input.path,
          patterns: input.patterns as string[],
          ...(typeof input.projectHint === 'string' ? { projectHint: input.projectHint } : {}),
          settleMs: typeof input.settleMs === 'number' ? input.settleMs : 750,
          enabled: input.enabled !== false,
        })
        sendJson(response, 200, { ok: true, value: captureWatch.listRules() })
        return
      }

      // ---- Phase D: Reorganize Proposals ----
      const sessionBindMatch = /^\/runtime\/sessions\/([^/]+)\/bind$/.exec(pathname)
      if (method === 'POST' && sessionBindMatch !== null) {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        const sessionId = decodeURIComponent(sessionBindMatch[1] ?? '')
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
          return
        }
        if (!isRecord(input) || typeof input.projectId !== 'string') {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Session bind requires projectId.'))
          return
        }
        if (db.getProject(input.projectId) === undefined) {
          sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
          return
        }
        const existing = db.getSessionContextRef(sessionId)
        db.upsertSessionContextRef({
          sessionId,
          projectId: input.projectId,
          selectedViewIds: Array.isArray(input.selectedViewIds) ? (input.selectedViewIds as string[]) : (existing?.selectedViewIds ?? []),
          retrievalEntityRefs: Array.isArray(input.retrievalEntityRefs) ? (input.retrievalEntityRefs as string[]) : (existing?.retrievalEntityRefs ?? []),
          sourceRefs: Array.isArray(input.sourceRefs) ? (input.sourceRefs as never) : (existing?.sourceRefs ?? []),
          status: input.status === 'working' || input.status === 'blocked' || input.status === 'closed' ? input.status : 'idle',
        })
        sendJson(response, 200, { ok: true, value: db.getSessionContextRef(sessionId) })
        return
      }

      const sessionContextMatch = /^\/runtime\/sessions\/([^/]+)\/context$/.exec(pathname)
      if (method === 'GET' && sessionContextMatch !== null) {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        const sessionId = decodeURIComponent(sessionContextMatch[1] ?? '')
        const ref = db.getSessionContextRef(sessionId)
        if (ref === undefined) {
          sendJson(response, 404, failure('NOT_FOUND', 'Session context not found.'))
          return
        }
        sendJson(response, 200, { ok: true, value: ref })
        return
      }

      const sessionCloseMatch = /^\/runtime\/sessions\/([^/]+)\/close$/.exec(pathname)
      if (method === 'POST' && sessionCloseMatch !== null) {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        const sessionId = decodeURIComponent(sessionCloseMatch[1] ?? '')
        const existing = db.getSessionContextRef(sessionId)
        if (existing === undefined) {
          sendJson(response, 404, failure('NOT_FOUND', 'Session context not found.'))
          return
        }
        db.upsertSessionContextRef({ ...existing, status: 'closed' })
        sendJson(response, 200, { ok: true, value: db.getSessionContextRef(sessionId) })
        return
      }

      if (method === 'GET' && pathname === '/runtime/sessions/contexts') {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        const projectId = url.searchParams.get('projectId')
        if (projectId === null || db.getProject(projectId) === undefined) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'projectId is required.'))
          return
        }
        sendJson(response, 200, { ok: true, value: db.listSessionContextRefs(projectId) })
        return
      }

      const reorganizeCreateMatch = /^\/projects\/([^/]+)\/reorganize\/proposals$/.exec(pathname)
      if (method === 'POST' && reorganizeCreateMatch !== null) {
        if (reorganize === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Reorganize service is not configured.'))
          return
        }
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 1 MiB.'))
          return
        }
        if (!isRecord(input) || typeof input.presentationId !== 'string' || typeof input.baseVersion !== 'number') {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Reorganize requires presentationId and baseVersion.'))
          return
        }
        try {
          const proposal = reorganize.create({
            projectId: decodeURIComponent(reorganizeCreateMatch[1] ?? ''),
            presentationId: input.presentationId,
            baseVersion: input.baseVersion,
            ...(Array.isArray(input.mergeCandidates) ? { mergeCandidates: input.mergeCandidates as never } : {}),
            ...(Array.isArray(input.removeMemberViewIds) ? { removeMemberViewIds: input.removeMemberViewIds as string[] } : {}),
            ...(Array.isArray(input.artifactDeleteCandidates) ? { artifactDeleteCandidates: input.artifactDeleteCandidates as never } : {}),
            ...(isRecord(input.hierarchyPatch) ? { hierarchyPatch: input.hierarchyPatch as never } : {}),
            ...(isRecord(input.relationPatch) ? { relationPatch: input.relationPatch as never } : {}),
            ...(isRecord(input.emphasisPatch) ? { emphasisPatch: input.emphasisPatch as never } : {}),
            ...(isRecord(input.layoutIntent) ? { layoutIntent: input.layoutIntent as never } : {}),
            ...(isRecord(input.positionPatch) ? { positionPatch: input.positionPatch as never } : {}),
          })
          sendJson(response, 201, { ok: true, value: proposal })
        } catch (error: unknown) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Failed to create reorganize proposal.'))
        }
        return
      }

      const reorganizeActionMatch = /^\/projects\/([^/]+)\/reorganize\/proposals\/([^/]+)\/(preview|apply|accept|rollback|reject)$/.exec(pathname)
      if (method === 'POST' && reorganizeActionMatch !== null) {
        if (reorganize === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Reorganize service is not configured.'))
          return
        }
        const proposalId = decodeURIComponent(reorganizeActionMatch[2] ?? '')
        const action = reorganizeActionMatch[3]
        try {
          if (action === 'preview') {
            sendJson(response, 200, { ok: true, value: reorganize.preview(proposalId) })
          } else if (action === 'apply') {
            let input: unknown = {}
            try { input = await readJsonBody(request, controller.signal) } catch { /* body optional */ }
            const confirm = isRecord(input) && input.confirmDestructive === true
            sendJson(response, 200, { ok: true, value: reorganize.apply(proposalId, { confirmDestructive: confirm }) })
          } else if (action === 'accept') {
            sendJson(response, 200, { ok: true, value: reorganize.accept(proposalId) })
          } else if (action === 'rollback') {
            sendJson(response, 200, { ok: true, value: reorganize.rollback(proposalId) })
          } else {
            sendJson(response, 200, { ok: true, value: reorganize.reject(proposalId) })
          }
        } catch (error: unknown) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Reorganize action failed.'))
        }
        return
      }

      if (method === 'GET' && /^\/projects\/[^/]+\/reorganize\/proposals$/.test(pathname)) {
        if (reorganize === undefined) {
          sendJson(response, 503, failure('UNAVAILABLE', 'Reorganize service is not configured.'))
          return
        }
        sendJson(response, 200, { ok: true, value: reorganize.list(decodeURIComponent(/^\/projects\/([^/]+)\/reorganize\/proposals$/.exec(pathname)?.[1] ?? '')) })
        return
      }

      const revealMatch = /^\/projects\/([^/]+)\/reveal$/.exec(pathname)
      if (method === 'POST' && revealMatch !== null) {
        const projectId = decodeURIComponent(revealMatch[1] ?? '')
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        const project = routeRequireProject(projectId, { metadata: db, response, helpers: routeHelpers }); if (project === undefined) return
        if (typeof project.rootPath !== 'string' || project.rootPath.length === 0) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Project has no registered root path.'))
          return
        }
        try {
          const result = await revealRegisteredPath(project.rootPath)
          if (!result.ok) {
            sendJson(response, 500, failure('INTERNAL', result.error ?? 'Failed to reveal project folder.'))
            return
          }
          sendJson(response, 200, { ok: true, value: { projectId, revealed: true } })
        } catch (error: unknown) {
          sendJson(response, 500, failure('INTERNAL', error instanceof Error ? error.message : 'Failed to reveal project folder.'))
        }
        return
      }

      const titleMatch = /^\/entities\/(project|workspace|artifact|scope)\/([^/]+)\/title$/.exec(pathname)
      if (method === 'POST' && titleMatch !== null) {
        const db = routeRequireMetadata({ metadata, response, helpers: routeHelpers }); if (db === undefined) return
        const entity = titleMatch[1] as 'project' | 'workspace' | 'artifact' | 'scope'
        const id = decodeURIComponent(titleMatch[2] ?? '')
        let input: unknown
        try { input = await readJsonBody(request, controller.signal) } catch {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 64 KiB.'))
          return
        }
        if (!isRecord(input) || typeof input.title !== 'string' || input.title.trim().length === 0) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'title is required.'))
          return
        }
        const mode = input.mode === 'manual' || input.mode === 'locked' ? input.mode : input.mode === 'auto' ? 'auto' : undefined
        if (mode === undefined) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', "mode must be 'auto' | 'manual' | 'locked'."))
          return
        }
        if (Object.keys(input).some((key) => !['title', 'mode', 'generatedBy'].includes(key))) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'Unexpected field in title update.'))
          return
        }
        try {
          db.updateEntityTitle(entity, id, {
            title: input.title,
            mode,
            ...(typeof input.generatedBy === 'string' && input.generatedBy.length > 0 ? { generatedBy: input.generatedBy } : {}),
          })
          sendJson(response, 200, { ok: true, value: { id, entity, title: input.title, mode } })
        } catch (error: unknown) {
          sendJson(response, 404, failure('NOT_FOUND', error instanceof Error ? error.message : `${entity} not found.`))
        }
        return
      }

      if (handleRealtimeDebugRoute({ method, pathname, url, request, response, controller, metadata, presentation, activeContext, projectEvents, projectMutations, helpers: routeHelpers })) return
      if (await handleProjectEventsRoute({ method, pathname, url, request, response, controller, metadata, presentation, activeContext, projectEvents, projectMutations, helpers: routeHelpers })) return
      if (await handleProjectsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        catalog,
        allowedRoot: options.allowedRoot,
        maxDocumentPreviewBytes: MAX_DOCUMENT_PREVIEW_BYTES,
        createProjectIdFn: createProjectId,
        helpers: routeHelpers,
      })) return
      if (await handleCanvasRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        activeContext,
        contextProposals,
        runtimeApplication,
        runEventListeners,
        projectMutations,
        helpers: routeHelpers,
      })) return
      if (await handleWorkbenchRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        helpers: routeHelpers,
        workbench: services.workbench,
      })) return
      if (await handleContextSnapshotsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        helpers: routeHelpers,
        contextSnapshots: services.contextSnapshots,
      })) return
      if (await handleHandoffsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        helpers: routeHelpers,
      })) return
      if (await handleContextProposalsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        activeContext,
        contextProposals,
        helpers: routeHelpers,
      })) return
      if (await handleRunsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        runtimeReview,
        runtimeApplication,
        contextManifest,
        previewWorker,
        helpers: routeHelpers,
      })) return
      if (await handleLcosprojRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        maxLcosprojBodyBytes: MAX_LCOSPROJ_BODY_BYTES,
        helpers: routeHelpers,
      })) return
      if (await handleArtifactsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        agentletRuntime,

        helpers: routeHelpers,
      })) return
      if (await handleWorkspaceStatesRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        mutationSafety,

        helpers: routeHelpers,
      })) return
      if (await handleColorPinsRoute({
        method, pathname, url, request, response, controller, metadata, mutationSafety, helpers: routeHelpers,
      })) return
      if (await handleNavigationMarkersRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        mutationSafety,

        helpers: routeHelpers,
      })) return
      if (await handlePresentationsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        presentation,
        projectMutations,
        mutationSafety,
        helpers: routeHelpers,
      })) return
      if (await handleWorkflowRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        presentation,
        maxImportBodyBytes: MAX_IMPORT_BODY_BYTES,
        helpers: routeHelpers,
      })) return
      if (await handleCurationRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        curation,
        curationCommand,
        search,
        sessionReadSet,
        helpers: routeHelpers,
      })) return
      if (await handleSpaceRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        spaceSandbox,
        helpers: routeHelpers,
      })) return
      if (metadata !== undefined && await handleCuratorRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        curatorDispatch,
        helpers: routeHelpers,
      })) return
      if (metadata !== undefined && await handleSkillAuthorRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        skillAuthorDispatch,
        helpers: routeHelpers,
      })) return
      if (metadata !== undefined && await handleEventsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        projectEvents,
        helpers: routeHelpers,
      })) return
      if (await handleAgentletsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        agentletRuntime,
        helpers: routeHelpers,
      })) return
      if (metadata !== undefined && await handleF6AssemblyRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        warehouse,
        resultSlots,
        assemblyApply,
        projectSummary,
        skillCatalog,
        skillPackages,
        skillProposals,
        companionProjections,
        conversationIdentity,
        helpers: routeHelpers,
      })) return
      if (await handleRetrievalRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        spatialRetrieval,
        helpers: routeHelpers,
      })) return
      if (await handleAttentionRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        attentionRuntime,
        boundaryEvaluator,
        helpers: routeHelpers,
      })) return
      if (await handleRuntimeRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        runtimeApplication,
        sessionLifecycle,
        planCodexDispatch,
        ocr,
        ...(semantic === undefined ? {} : { semantic }),
        helpers: routeHelpers,
      })) return
      if (runtimeReview !== undefined) {
        if (await handleRuntimeReviewRoute({
          pathname,
          request,
          response,
          controller,
          runtimeReview,
          runtimeApplication,
          maxBodyBytes: MAX_BODY_BYTES,
          sendJson,
          failure,
          readJsonBody,
          readRawBody,
          isRecord,
        })) return
      } else if (method === 'POST' && /^\/artifact-returns\/([^/]+)\/(accept|reject|retry)$/.test(pathname)) {
        sendJson(response, 503, failure('UNAVAILABLE', 'Runtime Review service is not configured.'))
        return
      }

      if (await handleImportsRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        fileRegistry,
        importCopy,
        resources,
        previewWorker,
        maxImportBodyBytes: MAX_IMPORT_BODY_BYTES,
        helpers: routeHelpers,
      })) return
      if (await handleResourcesRoute({
        method,
        pathname,
        url,
        request,
        response,
        controller,
        metadata,
        uploads,
        packages,
        importCopy,
        resources,
        resourceReader,
        matcher,
        activeContext,
        maxImportBodyBytes: MAX_IMPORT_BODY_BYTES,
        createProjectIdFn: createProjectId,
        helpers: routeHelpers,
      })) return
      // ==================== B5 reliable mutation routes ====================
      if (await handleChangeSetsRoute({
        method, pathname, url, request, response, signal: controller.signal, metadata, mutationSafety,
        helpers: routeHelpers,
      })) return
      if (await handleRelationsRoute({
        method, pathname, request, response, signal: controller.signal, metadata, mutationSafety,
        helpers: routeHelpers,
      })) return
      if (await handleRevisionWorkflowsRoute({
        method, pathname, request, response, signal: controller.signal, metadata, feedbackRevision,
        helpers: routeHelpers,
      })) return
      if (await handleContinuityRoute({
        method, pathname, url, request, response, signal: controller.signal, metadata, continuityRuntime,
        helpers: routeHelpers,
      })) return
      // ==================== RECEIVER-0 会话承接路由 ====================
      if (await handleReceiverRoute({
        method, pathname, url, request, response, signal: controller.signal, metadata, receiverRuntime,
        helpers: routeHelpers,
      })) return

      // ==================== Individual CRUD routes ====================

      const entityResult = await handleEntityRoute({
        method,
        pathname,
        metadata,
        mutationSafety,
        fileObservation,
        previewWorker,
        request,
        signal: controller.signal,
        helpers: { failure, readJsonBody },
      })
      if (entityResult !== undefined) {
        sendJson(response, entityResult.status, entityResult.body)
        return
      }

      // Fallback
      sendJson(response, 404, failure('INVALID_ARGUMENT', 'Route not found.'))
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError' && !response.headersSent && !response.destroyed) {
        sendJson(response, timedOut ? 408 : 499, failure('ABORTED', timedOut ? 'Request timed out.' : 'Request was aborted.'))
      } else if (!response.headersSent && !response.destroyed) {
        console.error('[LocalCore] Request failed:', error)
        sendJson(response, 500, failure('INTERNAL', 'Unexpected Local Core error.'))
      } else response.destroy()
    } finally {
      clearTimeout(timeout)
      request.removeListener('aborted', abort)
    }
  }

  const api: LocalCoreServer = {
    async start(signal?: AbortSignal): Promise<LocalCoreAddress> {
      if (signal?.aborted) throw new DOMException('Start aborted', 'AbortError')
      if (server !== undefined) throw new Error('Local Core server is already started.')

      const nextServer = createServer((request, response) => {
        void handleRequest(request, response)
      })
      server = nextServer

      let rejectStart: ((reason?: unknown) => void) | undefined
      const onAbort = () => { nextServer.close(); rejectStart?.(new DOMException('Start aborted', 'AbortError')) }
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        await new Promise<void>((resolvePromise, reject) => {
          rejectStart = reject
          nextServer.once('error', reject)
          nextServer.listen(options.port ?? 0, host, () => { nextServer.off('error', reject); resolvePromise() })
        })
      } catch (error: unknown) {
        server = undefined
        throw error
      } finally {
        rejectStart = undefined
        signal?.removeEventListener('abort', onAbort)
      }

      const bound = nextServer.address()
      if (bound === null || typeof bound === 'string') {
        await new Promise<void>((r) => nextServer.close(() => r()))
        server = undefined
        throw new Error('Local Core did not receive a TCP address.')
      }
      currentAddress = { host: LOOPBACK_HOST, port: bound.port }
      // 任务四 P3：agentlet 子进程需要实际地址做 Reachback 回调（ephemeral port 场景必需）
      agentletRuntime?.setAddress(currentAddress)
      // HU-1C: 启动 orphan sweep —— 归位/清理 LCOS staging 命名空间（不碰用户文件）。
      if (metadata !== undefined) {
        try {
          for (const project of metadata.listProjects()) {
            metadata.sweepStagedTextFiles(project.rootPath)
          }
        } catch { /* sweep 失败不阻塞启动 */ }
      }
      captureWatch?.start()
      if (signal !== undefined) {
        if (signal.aborted) { await api.close(); throw new DOMException('Start aborted', 'AbortError') }
        lifecycleSignal = signal
        lifecycleAbort = () => { void api.close() }
        signal.addEventListener('abort', lifecycleAbort, { once: true })
        if (signal.aborted) { await api.close(); throw new DOMException('Start aborted', 'AbortError') }
      }
      return currentAddress
    },

    async close(): Promise<void> {
      captureWatch?.stop()
      agentletRuntime?.close()
      const activeServer = server
      if (activeServer === undefined) return
      if (lifecycleSignal !== undefined && lifecycleAbort !== undefined) {
        lifecycleSignal.removeEventListener('abort', lifecycleAbort)
      }
      lifecycleSignal = undefined
      lifecycleAbort = undefined
      await new Promise<void>((resolvePromise, reject) => {
        activeServer.close((error) => { if (error) reject(error); else resolvePromise() })
        activeServer.closeAllConnections()
      })
      server = undefined
      currentAddress = undefined
      if (ownsConversationService) conversations?.close()
    },

    address(): LocalCoreAddress | undefined { return currentAddress },
  }

  return api
}

// ==================== Entity route handler ====================


function validBearerToken(header: string | undefined, expected: string): boolean {
  if (header === undefined || !header.startsWith('Bearer ')) return false
  const actual = Buffer.from(header.slice('Bearer '.length), 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes)
}
