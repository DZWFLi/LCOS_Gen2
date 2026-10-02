import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ProjectionBindingRecord, SqliteMetadataRepository } from '../metadata-repository.js'
import type { RouteHttpHelpers } from './route-context.js'
import { routeRequireProject } from './route-context.js'

export interface SpatialBindingsRouteContext {
  readonly method: string
  readonly pathname: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly controller: AbortController
  readonly metadata: SqliteMetadataRepository | undefined
  readonly helpers: RouteHttpHelpers
}

const SPATIAL_KINDS = new Set(['node', 'edge'])

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isValidBindingFields(value: Record<string, unknown>): value is Record<string, unknown> {
  return isNonEmptyString(value.canvasId)
    && SPATIAL_KINDS.has(String(value.spatialKind))
    && isNonEmptyString(value.spatialId)
    && isNonEmptyString(value.entityType)
    && isNonEmptyString(value.entityId)
}

function isValidBindingKey(value: Record<string, unknown>): value is Record<string, unknown> {
  return isNonEmptyString(value.canvasId)
    && SPATIAL_KINDS.has(String(value.spatialKind))
    && isNonEmptyString(value.entityType)
    && isNonEmptyString(value.entityId)
}

/**
 * Gen2 G0.8: ProjectionBinding CRUD over Core SQLite. Only identity bridge fields;
 * geometry is never accepted here (spatial truth lives in Huabu).
 *   GET    /projects/:id/spatial/bindings        -> list bindings for the project
 *   PUT    /projects/:id/spatial/bindings        -> upsert one binding (full record)
 *   DELETE /projects/:id/spatial/bindings        -> delete one binding (key only)
 */
export async function handleSpatialBindingsRoute(ctx: SpatialBindingsRouteContext): Promise<boolean> {
  const match = /^\/projects\/([^/]+)\/spatial\/bindings$/.exec(ctx.pathname)
  const materializeMatch = /^\/projects\/([^/]+)\/spatial\/result-slots\/([^/]+)\/materialize$/.exec(ctx.pathname)
  const portalMatch = /^\/projects\/([^/]+)\/spatial\/portals\/([^/]+)$/.exec(ctx.pathname)
  if (match === null && materializeMatch === null && portalMatch === null) return false
  if (ctx.metadata === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Metadata repository is not configured.'))
    return true
  }
  const metadata: SqliteMetadataRepository = ctx.metadata
  const projectId = decodeURIComponent(match?.[1] ?? materializeMatch?.[1] ?? portalMatch?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true

  if (portalMatch !== null) {
    if (ctx.method !== 'POST') return false
    try {
      const body = await ctx.helpers.readJsonBody(ctx.request,ctx.controller.signal)
      if (!ctx.helpers.isRecord(body) || !isNonEmptyString(body.canvasId) || !isNonEmptyString(body.spatialId)
        || !isNonEmptyString(body.expectedCanvasId) || Object.keys(body).some((k) => !['canvasId','spatialId','expectedCanvasId'].includes(k))) {
        ctx.helpers.sendJson(ctx.response,400,ctx.helpers.failure('INVALID_ARGUMENT','需要准确的来源、节点与目标画布。'))
        return true
      }
      if (ctx.controller.signal.aborted) throw new Error('入口绑定已取消。')
      const value = metadata.claimWorkspacePortalBinding(projectId,decodeURIComponent(portalMatch[2]!),body.canvasId,body.spatialId,body.expectedCanvasId)
      ctx.helpers.sendJson(ctx.response,200,{ok:true,value})
    } catch (error) {
      ctx.helpers.sendJson(ctx.response,409,ctx.helpers.failure('CONFLICT',error instanceof Error ? error.message : '入口绑定未确认。'))
    }
    return true
  }

  if (materializeMatch !== null) {
    if (ctx.method !== 'POST') return false
    try {
      const body = await ctx.helpers.readJsonBody(ctx.request, ctx.controller.signal)
      if (!ctx.helpers.isRecord(body) || !isNonEmptyString(body.canvasId) || !isNonEmptyString(body.spatialId)
        || Object.keys(body).some((key) => key !== 'canvasId' && key !== 'spatialId')) {
        ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Expected canvasId and spatialId only.'))
        return true
      }
      const value = metadata.materializeResultSlotBinding(projectId, decodeURIComponent(materializeMatch[2] ?? ''), body.canvasId, body.spatialId)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Projection identity could not be materialized.'))
    }
    return true
  }

  if (ctx.method === 'GET') {
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: metadata.getProjectionBindings(projectId) })
    return true
  }

  if (ctx.method === 'PUT' || ctx.method === 'DELETE') {
    let raw: unknown
    try {
      raw = await ctx.helpers.readJsonBody(ctx.request, ctx.controller.signal)
    } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (!ctx.helpers.isRecord(raw)) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be an object.'))
      return true
    }
    const body = raw as Record<string, unknown>
    if (ctx.method === 'PUT') {
      if (body.projectId !== projectId || !isValidBindingFields(body)) {
        ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Binding fields (canvasId/spatialKind/spatialId/entityType/entityId) must be valid.'))
        return true
      }
      const binding: ProjectionBindingRecord = {
        projectId,
        canvasId: String(body.canvasId),
        spatialKind: String(body.spatialKind) as ProjectionBindingRecord['spatialKind'],
        spatialId: String(body.spatialId),
        entityType: String(body.entityType),
        entityId: String(body.entityId),
      }
      metadata.upsertProjectionBinding(binding)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: binding })
      return true
    }
    if (!isValidBindingKey(body)) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Binding key (canvasId/spatialKind/entityType/entityId) must be valid.'))
      return true
    }
    metadata.deleteProjectionBinding(projectId, String(body.canvasId), String(body.spatialKind), String(body.entityType), String(body.entityId))
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: null })
    return true
  }

  return false
}
