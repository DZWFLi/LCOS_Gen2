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
  if (match === null) return false
  if (ctx.metadata === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Metadata repository is not configured.'))
    return true
  }
  const metadata: SqliteMetadataRepository = ctx.metadata
  const projectId = decodeURIComponent(match[1] ?? '')
  if (routeRequireProject(projectId, { metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true

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
