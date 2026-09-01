import type { ImportBatchRefV1, Project, RecordImportBatchRequestV1, RegisterTrustedSourceInput } from '@local-creative-os/contracts'
import type { ProjectId } from '@local-creative-os/domain'
import { ImportCopyConflictError, type ImportCopyService } from '../import-copy-service.js'
import type { FileRegistryService } from '../file-registry-service.js'
import type { PreviewWorkerService } from '../preview-worker-service.js'
import type { UniversalResourceImportService } from '../resources/universal-resource-import-service.js'
import { FORBIDDEN_BROWSER_PATH_FIELDS, routeRequireMetadata, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'
import { parseMultipartImport } from './multipart.js'
import { publicResourceImportResult } from './resources.js'

export interface ImportsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly fileRegistry: FileRegistryService | undefined
  readonly importCopy: ImportCopyService | undefined
  readonly resources: UniversalResourceImportService | undefined
  readonly previewWorker: PreviewWorkerService | undefined
  readonly maxImportBodyBytes: number
}

/**
 * /projects/:id/sources（不透明 selectionId 注册）与 /projects/:id/imports（拖入文件导入）。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleImportsRoute(ctx: ImportsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, metadata, fileRegistry, importCopy, resources, previewWorker, maxImportBodyBytes } = ctx
  const { sendJson, failure, readJsonBody, readRawBody, isRecord } = ctx.helpers

  // Browser supplies only an opaque trusted selection ID, never a path.
  const sourceMatch = /^\/projects\/([^/]+)\/sources$/.exec(pathname)
  if (method === 'POST' && sourceMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (fileRegistry === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Trusted file picker adapter is not configured.'))
      return true
    }
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Source registration body must be valid JSON.'))
      return true
    }
    if (!isRecord(input) || typeof input.selectionId !== 'string'
      || ('path' in input) || ('absolutePath' in input) || ('rootPath' in input)
      || (input.title !== undefined && typeof input.title !== 'string')) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Source registration requires only selectionId and optional title.'))
      return true
    }
    const projectId = decodeURIComponent(sourceMatch[1] ?? '')
    try {
      const result = await fileRegistry.registerSource(
        projectId as Project['id'],
        input as unknown as RegisterTrustedSourceInput,
        controller.signal,
      )
      sendJson(response, 201, { ok: true, value: result })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Source registration failed.'))
    }
    return true
  }

  const importBatchLatestMatch = /^\/projects\/([^/]+)\/import-batches\/latest$/.exec(pathname)
  if (method === 'GET' && importBatchLatestMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(importBatchLatestMatch[1] ?? '')
    if (db.getProject(projectId) === undefined) { sendJson(response, 404, failure('NOT_FOUND', 'Project not found.')); return true }
    sendJson(response, 200, { ok: true, value: db.getLatestImportBatch(projectId) ?? null })
    return true
  }

  const importBatchItemMatch = /^\/projects\/([^/]+)\/import-batches\/([^/]+)$/.exec(pathname)
  if (method === 'GET' && importBatchItemMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(importBatchItemMatch[1] ?? '')
    const batchId = decodeURIComponent(importBatchItemMatch[2] ?? '')
    const batch = db.getImportBatch(projectId, batchId)
    if (batch === undefined) { sendJson(response, 404, failure('NOT_FOUND', 'Import batch not found.')); return true }
    sendJson(response, 200, { ok: true, value: batch })
    return true
  }

  const importBatchCollectionMatch = /^\/projects\/([^/]+)\/import-batches$/.exec(pathname)
  if (method === 'GET' && importBatchCollectionMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(importBatchCollectionMatch[1] ?? '')
    const limitRaw = Number(ctx.url.searchParams.get('limit') ?? '20')
    sendJson(response, 200, { ok: true, value: db.listImportBatches(projectId, Number.isFinite(limitRaw) ? limitRaw : 20) })
    return true
  }
  if (method === 'POST' && importBatchCollectionMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(importBatchCollectionMatch[1] ?? '')
    let body: unknown
    try { body = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Import batch body must be valid JSON.'))
      return true
    }
    if (!isRecord(body)) { sendJson(response, 400, failure('INVALID_ARGUMENT', 'Import batch body is required.')); return true }
    const arrayOfStrings = (value: unknown): value is readonly string[] => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim() !== '')
    const validSource = ['file_drop', 'directory_drop', 'archive_drop', 'capture', 'other'].includes(String(body.sourceKind ?? ''))
    const validStatus = ['completed', 'partial', 'failed'].includes(String(body.status ?? ''))
    if (typeof body.batchId !== 'string' || !body.batchId.trim() || !validSource || !validStatus
      || !arrayOfStrings(body.importRequestIds) || !arrayOfStrings(body.artifactIds)
      || !arrayOfStrings(body.revisionIds) || !arrayOfStrings(body.viewIds)
      || (body.scopeId !== undefined && typeof body.scopeId !== 'string')
      || (body.createdAt !== undefined && typeof body.createdAt !== 'string')) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Invalid ImportBatchRef payload.'))
      return true
    }
    const now = new Date().toISOString()
    const requestBody = body as unknown as RecordImportBatchRequestV1
    const value: ImportBatchRefV1 = {
      schemaVersion: 1,
      id: requestBody.batchId,
      projectId,
      sourceKind: requestBody.sourceKind,
      status: requestBody.status,
      ...(requestBody.scopeId ? { scopeId: requestBody.scopeId } : {}),
      importRequestIds: [...new Set(requestBody.importRequestIds)],
      artifactIds: [...new Set(requestBody.artifactIds)],
      revisionIds: [...new Set(requestBody.revisionIds)],
      viewIds: [...new Set(requestBody.viewIds)],
      createdAt: requestBody.createdAt ?? now,
      completedAt: now,
    }
    try { db.saveImportBatch(value); sendJson(response, 201, { ok: true, value }) }
    catch (error: unknown) { sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Import batch could not be recorded.')) }
    return true
  }

  const importMatch = /^\/projects\/([^/]+)\/imports$/.exec(pathname)
  if (method === 'POST' && importMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (importCopy === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Import Copy service is not configured.'))
      return true
    }
    try {
      const body = await readRawBody(request, controller.signal, maxImportBodyBytes)
      const multipart = parseMultipartImport(request.headers['content-type'], body)
      const projectId = decodeURIComponent(importMatch[1] ?? '')
      const x = Number(multipart.fields['position.x'])
      const y = Number(multipart.fields['position.y'])
      const forbiddenPathField = Object.keys(multipart.fields).find((field) => FORBIDDEN_BROWSER_PATH_FIELDS.has(field))
      if (forbiddenPathField !== undefined) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', `Import Copy does not accept browser supplied path field: ${forbiddenPathField}.`))
        return true
      }
      if (!multipart.fields.importRequestId || !multipart.fields.scopeId || !Number.isFinite(x) || !Number.isFinite(y)) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Import Copy requires importRequestId, scopeId, position.x, position.y and file.'))
        return true
      }
      const result = await importCopy.importCopy(projectId as ProjectId, {
        importRequestId: multipart.fields.importRequestId,
        scopeId: multipart.fields.scopeId,
        position: { x, y },
        fileName: multipart.file.fileName,
        contentType: multipart.file.contentType,
        bytes: multipart.file.bytes,
      })
      const outcome = resources === undefined
        ? undefined
        : await resources.afterImport(projectId as ProjectId, result)
      if (previewWorker !== undefined) {
        try {
          await previewWorker.generate({
            projectId: projectId as ProjectId,
            revisionId: result.revision.id as Parameters<typeof previewWorker.generate>[0]['revisionId'],
            previewProfile: 'thumbnail',
          })
        } catch {
          // 预览生成失败不阻断导入；前端会按需重试或显示可读错误。
        }
      }
      sendJson(response, result.reused ? 200 : 201, {
        ok: true,
        value: {
          artifact: result.artifact,
          revision: result.revision,
          view: result.view,
          reused: result.reused,
          ...(outcome === undefined ? {} : { resource: publicResourceImportResult(outcome) }),
        },
      })
    } catch (error: unknown) {
      const status = error instanceof RangeError ? 413 : error instanceof ImportCopyConflictError ? 409 : 400
      sendJson(response, status, failure(error instanceof ImportCopyConflictError ? 'CONFLICT' : 'VALIDATION', error instanceof Error ? error.message : 'Import Copy failed.'))
    }
    return true
  }

  return false
}
