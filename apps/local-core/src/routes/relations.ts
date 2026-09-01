import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Relation } from '@local-creative-os/domain'
import type { MutationSafetyService } from '../mutation-safety-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { FORBIDDEN_BROWSER_PATH_FIELDS, isRecord, routeRequireProject, type RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'

export interface RelationsRouteContext {
  readonly method: string
  readonly pathname: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly mutationSafety: MutationSafetyService | undefined
  readonly helpers: RouteHttpHelpers
}

function containsForbiddenPathKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenPathKey)
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, child]) => FORBIDDEN_BROWSER_PATH_FIELDS.has(key) || containsForbiddenPathKey(child))
}

function relationEntityBelongsToProject(metadata: SqliteMetadataRepository, projectId: string, entityType: unknown, entityId: unknown): boolean {
  if (typeof entityId !== 'string' || entityId.trim() === '') return false
  if (entityType === 'artifact') return String(metadata.getArtifact(entityId)?.projectId ?? '') === projectId
  if (entityType === 'note') return String(metadata.getNote(entityId)?.projectId ?? '') === projectId
  if (entityType === 'scope') return metadata.get(projectId)?.scopes.some((scope) => String(scope.id) === entityId) ?? false
  if (entityType === 'view') {
    const view = metadata.getArtifactView(entityId)
    return view !== undefined && String(metadata.getArtifact(String(view.artifactId))?.projectId ?? '') === projectId
  }
  if (entityType === 'workspace') return String(metadata.getWorkspace(entityId)?.projectId ?? '') === projectId
  return false
}

function isSafeRelationInput(metadata: SqliteMetadataRepository, projectId: string, value: unknown, relationId: string): value is Relation {
  if (!isRecord(value) || value.projectId !== projectId || value.id !== relationId || containsForbiddenPathKey(value)) return false
  if (typeof value.kind !== 'string' || value.kind.trim() === '' || value.kind.length > 80) return false
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false
  return relationEntityBelongsToProject(metadata, projectId, value.sourceEntityType, value.sourceEntityId)
    && relationEntityBelongsToProject(metadata, projectId, value.targetEntityType, value.targetEntityId)
}

export async function handleRelationsRoute(ctx: RelationsRouteContext): Promise<boolean> {
  const listMatch = /^\/projects\/([^/]+)\/relations$/.exec(ctx.pathname)
  const oneMatch = /^\/projects\/([^/]+)\/relations\/([^/]+)$/.exec(ctx.pathname)
  if (listMatch === null && oneMatch === null) return false
  if (ctx.metadata === undefined || ctx.mutationSafety === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Relation mutation service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent((listMatch ?? oneMatch)?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true

  if (listMatch !== null && ctx.method === 'GET') {
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: ctx.metadata.getRelations(projectId) })
    return true
  }

  if (oneMatch === null) return false
  const relationId = decodeURIComponent(oneMatch[2] ?? '')
  if (ctx.method === 'GET') {
    const relation = ctx.metadata.getRelation(relationId)
    if (relation === undefined || String(relation.projectId) !== projectId) ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Relation not found.'))
    else ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: relation })
    return true
  }

  if (ctx.method === 'PUT') {
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const wrapped = isRecord(raw) && 'relation' in raw ? raw : undefined
    const relationValue = wrapped?.relation ?? raw
    const origin = wrapped === undefined ? undefined : parseProjectEventOrigin(wrapped.origin)
    if (!isSafeRelationInput(ctx.metadata, projectId, relationValue, relationId)) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Relation identity, endpoints, kind, and route project must be valid.'))
      return true
    }
    const changeSet = ctx.mutationSafety.upsertRelation({ projectId, relation: relationValue, ...(origin === undefined ? {} : { origin }) })
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: relationValue, meta: { changeSetId: changeSet.id } })
    return true
  }

  if (ctx.method === 'DELETE') {
    let origin
    try {
      const raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal)
      origin = isRecord(raw) ? parseProjectEventOrigin(raw.origin) : undefined
    } catch { origin = undefined }
    try {
      const changeSet = ctx.mutationSafety.deleteRelation({ projectId, relationId, ...(origin === undefined ? {} : { origin }) })
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: null, meta: { changeSetId: changeSet.id } })
    } catch {
      ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Relation not found.'))
    }
    return true
  }

  return false
}
