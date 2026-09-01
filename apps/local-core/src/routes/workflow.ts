import type { ProjectId } from '@local-creative-os/domain'
import type { PresentationApplicationService } from '../presentation-application-service.js'
import { WorkflowExportService } from '../workflow-export-service.js'
import { parseMultipartImport } from './multipart.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface WorkflowRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly presentation: PresentationApplicationService | undefined
  readonly maxImportBodyBytes: number
}

/** /projects/:id/workflow/export|import —— .lcos-workflow.zip（Phase 4 §7.6）。 */
export async function handleWorkflowRoute(ctx: WorkflowRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, url, metadata, presentation, maxImportBodyBytes, helpers } = ctx
  const { sendJson, failure, readRawBody, sendBinary } = helpers

  const exportMatch = /^\/projects\/([^/]+)\/workflow\/export$/.exec(pathname)
  const importMatch = /^\/projects\/([^/]+)\/workflow\/import$/.exec(pathname)
  if (exportMatch === null && importMatch === null) return false
  if (presentation === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Presentation service is not configured.'))
    return true
  }
  if (method === 'GET' && exportMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(exportMatch[1] ?? '') as ProjectId
    const project = routeRequireProject(String(projectId), { metadata: db, response, helpers })
    if (project === undefined) return true
    const scopeId = url.searchParams.get('scopeId') ?? String(db.get(projectId)?.scopes.find((scope) => scope.kind === 'root')?.id ?? 'scope-root')
    try {
      const zip = new WorkflowExportService(db, presentation).export(String(projectId), scopeId)
      const safeName = `${project.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'}-workflow.lcos-workflow.zip`
      sendBinary(response, 200, Buffer.from(zip), safeName, 'application/zip')
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Workflow export failed.'))
    }
    return true
  }

  if (method === 'POST' && importMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(importMatch[1] ?? '') as ProjectId
    const project = routeRequireProject(String(projectId), { metadata: db, response, helpers })
    if (project === undefined) return true
    const scopeId = url.searchParams.get('scopeId') ?? String(db.get(projectId)?.scopes.find((scope) => scope.kind === 'root')?.id ?? 'scope-root')
    try {
      const raw = await readRawBody(request, controller.signal, maxImportBodyBytes)
      const multipart = parseMultipartImport(request.headers['content-type'], raw)
      if (!/\.(zip|lcos-workflow\.zip)$/i.test(multipart.file.fileName)) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', '请选择 .lcos-workflow.zip 工作流文件。'))
        return true
      }
      const result = new WorkflowExportService(db, presentation).import(String(projectId), scopeId, new Uint8Array(multipart.file.bytes))
      sendJson(response, 200, { ok: true, value: result })
    } catch (error: unknown) {
      const isSize = error instanceof RangeError
      sendJson(response, isSize ? 413 : 409, failure(isSize ? 'INVALID_ARGUMENT' : 'CONFLICT', error instanceof Error ? error.message : 'Workflow import failed.'))
    }
    return true
  }

  return false
}
