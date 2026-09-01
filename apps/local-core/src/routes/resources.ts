import type { ImportResourceResultV1 } from '@local-creative-os/contracts'
import type { ProjectId } from '@local-creative-os/domain'
import type { ActiveContextStore } from '../active-context-store.js'
import { ImportCopyConflictError, type ImportCopyService } from '../import-copy-service.js'
import type { ResourceMatcher } from '../resources/resource-matcher.js'
import { ResourcePackageConflictError, type ResourcePackageService } from '../resources/resource-package-service.js'
import type { ResourceReader } from '../resources/resource-reader.js'
import type { ResourceUploadSessionService } from '../resources/resource-upload-session-service.js'
import type { UniversalResourceImportService } from '../resources/universal-resource-import-service.js'
import { routeRequireMetadata, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'
import { parseMultipartImport } from './multipart.js'

export function publicResourceImportResult(value: ImportResourceResultV1): ImportResourceResultV1 {
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

export interface ResourcesRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly uploads: ResourceUploadSessionService | undefined
  readonly packages: ResourcePackageService | undefined
  readonly importCopy: ImportCopyService | undefined
  readonly resources: UniversalResourceImportService | undefined
  readonly resourceReader: ResourceReader | undefined
  readonly matcher: ResourceMatcher
  readonly activeContext: ActiveContextStore
  readonly maxImportBodyBytes: number
  readonly createProjectIdFn: (name: string) => string
}

/**
 * resource-upload-sessions、resources 导入（目录/归档/URL）、match、
 * descriptor/content/reanalyze/list/one。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleResourcesRoute(ctx: ResourcesRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, url, metadata, uploads, packages, importCopy, resources, resourceReader, matcher, activeContext, maxImportBodyBytes, createProjectIdFn } = ctx
  const { sendJson, failure, readJsonBody, readRawBody, isRecord, isStringArray } = ctx.helpers

  const resourceUrlImportMatch = /^\/projects\/([^/]+)\/resources\/import-url$/.exec(pathname)
  const uploadSessionCreateMatch = /^\/projects\/([^/]+)\/resource-upload-sessions$/.exec(pathname)
  const uploadSessionFileMatch = /^\/projects\/([^/]+)\/resource-upload-sessions\/([^/]+)\/files$/.exec(pathname)
  const uploadSessionCompleteMatch = /^\/projects\/([^/]+)\/resource-upload-sessions\/([^/]+)\/complete$/.exec(pathname)
  if (method === 'POST' && uploadSessionCreateMatch !== null) {
    if (uploads === undefined || routeRequireMetadata(ctx) === undefined) return true
    try {
      const projectId = decodeURIComponent(uploadSessionCreateMatch[1] ?? '')
      const body = await readJsonBody(request, controller.signal) as Record<string, unknown>
      if (typeof body.importRequestId !== 'string' || typeof body.rootName !== 'string' || typeof body.scopeId !== 'string'
        || typeof body.x !== 'number' || typeof body.y !== 'number') throw new Error('Upload session metadata is invalid.')
      sendJson(response, 201, { ok: true, value: await uploads.start({ projectId, importRequestId: body.importRequestId, rootName: body.rootName, scopeId: body.scopeId, x: body.x, y: body.y, ...(typeof body.note === 'string' ? { note: body.note } : {}) }) })
    } catch (error) { sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Upload session failed.')) }
    return true
  }
  if (method === 'PUT' && uploadSessionFileMatch !== null) {
    if (uploads === undefined || routeRequireMetadata(ctx) === undefined) return true
    try {
      const relativePath = url.searchParams.get('path')
      if (relativePath === null) throw new Error('Relative path is required.')
      await uploads.putFile(decodeURIComponent(uploadSessionFileMatch[1] ?? ''), decodeURIComponent(uploadSessionFileMatch[2] ?? ''), relativePath, request)
      sendJson(response, 200, { ok: true, value: null })
    } catch (error) { sendJson(response, error instanceof RangeError ? 413 : 400, failure('VALIDATION', error instanceof Error ? error.message : 'Upload failed.')) }
    return true
  }
  if (method === 'POST' && uploadSessionCompleteMatch !== null) {
    if (uploads === undefined || routeRequireMetadata(ctx) === undefined) return true
    try {
      const outcome = await uploads.complete(decodeURIComponent(uploadSessionCompleteMatch[1] ?? ''), decodeURIComponent(uploadSessionCompleteMatch[2] ?? ''))
      sendJson(response, outcome.reused ? 200 : 201, { ok: true, value: publicResourceImportResult(outcome) })
    } catch (error) { sendJson(response, error instanceof ResourcePackageConflictError ? 409 : error instanceof RangeError ? 413 : 400, failure('VALIDATION', error instanceof Error ? error.message : 'Upload completion failed.')) }
    return true
  }
  const resourceDirectoryImportMatch = /^\/projects\/([^/]+)\/resources\/import-directory$/.exec(pathname)
  const resourceArchiveImportMatch = /^\/projects\/([^/]+)\/resources\/import-archive$/.exec(pathname)
  if (method === 'POST' && resourceDirectoryImportMatch !== null) {
    sendJson(response, 410, failure('VALIDATION', 'Base64 directory import was removed; use resource-upload-sessions.'))
    return true
  }
  if (method === 'POST' && resourceArchiveImportMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (packages === undefined || importCopy === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Resource Package service is not configured.'))
      return true
    }
    try {
      const raw = await readRawBody(request, controller.signal, maxImportBodyBytes)
      const multipart = parseMultipartImport(request.headers['content-type'], raw)
      const projectId = decodeURIComponent(resourceArchiveImportMatch[1] ?? '')
      const x = Number(multipart.fields['position.x'])
      const y = Number(multipart.fields['position.y'])
      if (!multipart.fields.importRequestId || !multipart.fields.scopeId || !Number.isFinite(x) || !Number.isFinite(y)) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Archive import requires importRequestId, scopeId, position and file.'))
        return true
      }
      const outcome = await packages.importArchive(projectId as ProjectId, {
        importRequestId: multipart.fields.importRequestId,
        fileName: multipart.file.fileName,
        bytes: multipart.file.bytes,
        scopeId: multipart.fields.scopeId,
        position: { x, y },
        ...(multipart.fields.note === undefined ? {} : { userNote: multipart.fields.note }),
      })
      sendJson(response, outcome.reused ? 200 : 201, { ok: true, value: publicResourceImportResult(outcome) })
    } catch (error: unknown) {
      const status = error instanceof RangeError ? 413 : error instanceof ResourcePackageConflictError ? 409 : 400
      sendJson(response, status, failure(error instanceof ResourcePackageConflictError ? 'CONFLICT' : 'VALIDATION', error instanceof Error ? error.message : 'Archive import failed.'))
    }
    return true
  }
  if (method === 'POST' && resourceUrlImportMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (resources === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Universal Resource Import service is not configured.'))
      return true
    }
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Import URL body must be valid JSON.'))
      return true
    }
    const body = input as {
      url?: unknown
      title?: unknown
      note?: unknown
      importRequestId?: unknown
      scopeId?: unknown
      x?: unknown
      y?: unknown
    }
    if (typeof body?.url !== 'string' || body.url.trim() === '' || body.url.length > 2048) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'url must be a non-empty string under 2048 characters.'))
      return true
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'title must be a string when provided.'))
      return true
    }
    if (body.note !== undefined && typeof body.note !== 'string') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'note must be a string when provided.'))
      return true
    }
    const projectId = decodeURIComponent(resourceUrlImportMatch[1] ?? '')
    const project = db.getProject(projectId)
    if (project === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
      return true
    }
    const graph = db.get(projectId)
    const rootScope = graph?.scopes.find((scope) => scope.kind === 'root') ?? graph?.scopes[0]
    const scopeId = typeof body.scopeId === 'string' && body.scopeId.trim() !== ''
      ? body.scopeId
      : String(rootScope?.id ?? '')
    const x = typeof body.x === 'number' && Number.isFinite(body.x) ? body.x : 180
    const y = typeof body.y === 'number' && Number.isFinite(body.y) ? body.y : 160
    try {
      const outcome = await resources.importUrl(projectId as ProjectId, {
        importRequestId: typeof body.importRequestId === 'string' && body.importRequestId.trim() !== ''
          ? body.importRequestId
          : `url-${createProjectIdFn(body.url).slice('project-'.length)}`,
        url: body.url,
        ...(body.title === undefined ? {} : { title: body.title }),
        ...(body.note === undefined ? {} : { userNote: body.note }),
        scopeId,
        position: { x, y },
      })
      sendJson(response, outcome.reused === undefined || !outcome.reused ? 201 : 200, { ok: true, value: publicResourceImportResult(outcome) })
    } catch (error: unknown) {
      const status = error instanceof ImportCopyConflictError ? 409 : 400
      sendJson(response, status, failure(error instanceof ImportCopyConflictError ? 'CONFLICT' : 'VALIDATION', error instanceof Error ? error.message : 'URL import failed.'))
    }
    return true
  }

  const resourceDescriptorMatch = /^\/projects\/([^/]+)\/resources\/([^/]+)\/descriptor$/.exec(pathname)
  const resourceReanalyzeMatch = /^\/projects\/([^/]+)\/resources\/([^/]+)\/reanalyze$/.exec(pathname)
  const resourceContentMatch = /^\/projects\/([^/]+)\/resources\/([^/]+)\/content$/.exec(pathname)
  const resourceListMatch = /^\/projects\/([^/]+)\/resources$/.exec(pathname)
  const resourceOneMatch = /^\/projects\/([^/]+)\/resources\/([^/]+)$/.exec(pathname)
  const resourceMatchRoute = /^\/projects\/([^/]+)\/resources\/match$/.exec(pathname)
  if (method === 'POST' && resourceMatchRoute !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (resources === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Universal Resource Import service is not configured.'))
      return true
    }
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Match body must be valid JSON.'))
      return true
    }
    const body = input as {
      instruction?: unknown
      outputIntent?: unknown
      mediaTypes?: unknown
      limit?: unknown
    }
    if (typeof body?.instruction !== 'string' || body.instruction.trim() === '') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'instruction is required.'))
      return true
    }
    if (body.outputIntent !== undefined && body.outputIntent !== 'create' && body.outputIntent !== 'revise' && body.outputIntent !== 'analyze') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'outputIntent must be create, revise or analyze.'))
      return true
    }
    if (body.mediaTypes !== undefined && (!Array.isArray(body.mediaTypes) || body.mediaTypes.some((item) => typeof item !== 'string'))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'mediaTypes must be an array of strings.'))
      return true
    }
    const projectId = decodeURIComponent(resourceMatchRoute[1] ?? '')
    const graph = db.get(projectId)
    const active = graph === undefined ? undefined : activeContext.get(projectId, graph)
    const viewToArtifact = new Map((graph?.artifactViews ?? []).map((view) => [String(view.id), String(view.artifactId)]))
    const descriptors = resources.list(projectId)
    const artifactToResource = new Map(descriptors.map((descriptor) => [descriptor.artifactId, descriptor.resourceId]))
    const mapViews = (viewIds: readonly string[] | undefined): string[] => (viewIds ?? [])
      .map((viewId) => viewToArtifact.get(String(viewId)))
      .filter((artifactId): artifactId is string => artifactId !== undefined)
    const excludedResourceIds = mapViews(active?.excludedContextIds)
      .map((artifactId) => artifactToResource.get(artifactId))
      .filter((resourceId): resourceId is string => resourceId !== undefined)
    const pinnedResourceIds = mapViews(active?.pinnedContextIds)
      .map((artifactId) => artifactToResource.get(artifactId))
      .filter((resourceId): resourceId is string => resourceId !== undefined)
    const activeContextArtifactIds = mapViews(active?.selectedViewIds)
    const matches = matcher.match(descriptors, {
      projectId,
      instruction: body.instruction,
      ...(body.outputIntent === undefined ? {} : { outputIntent: body.outputIntent as 'create' | 'revise' | 'analyze' }),
      ...(body.mediaTypes === undefined ? {} : { mediaTypes: body.mediaTypes as readonly string[] }),
      ...(body.limit === undefined ? {} : { limit: Number(body.limit) }),
    }, {
      ...(excludedResourceIds.length === 0 ? {} : { excludedResourceIds }),
      ...(pinnedResourceIds.length === 0 ? {} : { pinnedResourceIds }),
      ...(activeContextArtifactIds.length === 0 ? {} : { activeContextArtifactIds }),
    })
    sendJson(response, 200, { ok: true, value: matches })
    return true
  }
  if (resources !== undefined) {
    if (method === 'GET' && resourceListMatch !== null) {
      const db = routeRequireMetadata(ctx); if (db === undefined) return true
      const projectId = decodeURIComponent(resourceListMatch[1] ?? '')
      const descriptors = resources.list(projectId)
      sendJson(response, 200, {
        ok: true,
        value: descriptors.map((descriptor) => ({
          resourceId: descriptor.resourceId,
          artifactId: descriptor.artifactId,
          title: descriptor.display.title,
          sourceKind: descriptor.source.kind,
          status: descriptor.understanding.status,
          analyzerVersion: descriptor.understanding.analyzerVersion,
        })),
      })
      return true
    }
    if (method === 'GET' && resourceDescriptorMatch !== null) {
      const db = routeRequireMetadata(ctx); if (db === undefined) return true
      const projectId = decodeURIComponent(resourceDescriptorMatch[1] ?? '')
      const resourceId = decodeURIComponent(resourceDescriptorMatch[2] ?? '')
      const descriptor = resources.getDescriptor(projectId, resourceId)
      if (descriptor === undefined) {
        sendJson(response, 404, failure('NOT_FOUND', 'Resource descriptor not found.'))
        return true
      }
      sendJson(response, 200, { ok: true, value: descriptor })
      return true
    }
    if (method === 'GET' && resourceContentMatch !== null) {
      const db = routeRequireMetadata(ctx); if (db === undefined) return true
      if (resourceReader === undefined) {
        sendJson(response, 503, failure('UNAVAILABLE', 'Resource Reader is not configured.'))
        return true
      }
      const projectId = decodeURIComponent(resourceContentMatch[1] ?? '')
      const resourceId = decodeURIComponent(resourceContentMatch[2] ?? '')
      const params = url.searchParams
      const format = params.get('format') ?? 'text'
      if (format !== 'raw' && format !== 'text' && format !== 'json_tree') {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'format must be raw, text or json_tree.'))
        return true
      }
      const offset = params.get('offset') === null ? undefined : Number(params.get('offset'))
      const limit = params.get('limit') === null ? undefined : Number(params.get('limit'))
      if ((offset !== undefined && !Number.isFinite(offset)) || (limit !== undefined && !Number.isFinite(limit))) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'offset and limit must be numbers.'))
        return true
      }
      try {
        const result = await resourceReader.read(projectId, resourceId, {
          ...(params.get('path') === null ? {} : { path: String(params.get('path')) }),
          ...(offset === undefined ? {} : { offset }),
          ...(limit === undefined ? {} : { limit }),
          format: format as 'raw' | 'text' | 'json_tree',
        })
        sendJson(response, 200, { ok: true, value: result })
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Resource content read failed.'
        sendJson(response, message.includes('not found') ? 404 : 400, failure(message.includes('not found') ? 'NOT_FOUND' : 'VALIDATION', message))
      }
      return true
    }
    if (method === 'POST' && resourceReanalyzeMatch !== null) {
      const db = routeRequireMetadata(ctx); if (db === undefined) return true
      const projectId = decodeURIComponent(resourceReanalyzeMatch[1] ?? '')
      const resourceId = decodeURIComponent(resourceReanalyzeMatch[2] ?? '')
      const descriptor = await resources.reanalyze(projectId, resourceId)
      if (descriptor === undefined) {
        sendJson(response, 404, failure('NOT_FOUND', 'Resource descriptor not found.'))
        return true
      }
      sendJson(response, 200, { ok: true, value: descriptor })
      return true
    }
    if (method === 'GET' && resourceOneMatch !== null) {
      const db = routeRequireMetadata(ctx); if (db === undefined) return true
      const projectId = decodeURIComponent(resourceOneMatch[1] ?? '')
      const resourceId = decodeURIComponent(resourceOneMatch[2] ?? '')
      const descriptor = resources.getDescriptor(projectId, resourceId)
      if (descriptor === undefined) {
        sendJson(response, 404, failure('NOT_FOUND', 'Resource not found.'))
        return true
      }
      const artifact = db.getArtifact(descriptor.artifactId)
      sendJson(response, 200, { ok: true, value: { resourceId, artifact: artifact ?? null, descriptor } })
      return true
    }
  }

  return false
}
