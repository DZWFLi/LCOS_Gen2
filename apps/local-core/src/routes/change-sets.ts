import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MutationSafetyService } from '../mutation-safety-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { isRecord, routeRequireProject, type RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'

export interface ChangeSetsRouteContext {
  readonly method: string
  readonly pathname: string
  readonly url: URL
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly mutationSafety: MutationSafetyService | undefined
  readonly helpers: RouteHttpHelpers
}

export async function handleChangeSetsRoute(ctx: ChangeSetsRouteContext): Promise<boolean> {
  const listMatch = /^\/projects\/([^/]+)\/change-sets$/.exec(ctx.pathname)
  const oneMatch = /^\/projects\/([^/]+)\/change-sets\/([^/]+)$/.exec(ctx.pathname)
  const actionMatch = /^\/projects\/([^/]+)\/change-sets\/([^/]+)\/(revert|reapply)$/.exec(ctx.pathname)
  if (listMatch === null && oneMatch === null && actionMatch === null) return false
  if (ctx.metadata === undefined || ctx.mutationSafety === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Mutation safety service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent((listMatch ?? oneMatch ?? actionMatch)?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true

  if (listMatch !== null && ctx.method === 'GET') {
    const limitRaw = Number(ctx.url.searchParams.get('limit') ?? '50')
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 50
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: ctx.mutationSafety.list(projectId, limit) })
    return true
  }

  if (oneMatch !== null && ctx.method === 'GET') {
    const changeSetId = decodeURIComponent(oneMatch[2] ?? '')
    const value = ctx.mutationSafety.get(changeSetId)
    if (value === undefined || value.projectId !== projectId) {
      ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Change set not found.'))
    } else {
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    }
    return true
  }

  if (actionMatch !== null && ctx.method === 'POST') {
    const changeSetId = decodeURIComponent(actionMatch[2] ?? '')
    const existing = ctx.mutationSafety.get(changeSetId)
    if (existing === undefined || existing.projectId !== projectId) {
      ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Change set not found.'))
      return true
    }
    let body: unknown = {}
    try { body = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch { body = {} }
    const origin = isRecord(body) ? parseProjectEventOrigin(body.origin) : undefined
    try {
      const result = actionMatch[3] === 'revert'
        ? ctx.mutationSafety.revert(changeSetId, origin)
        : ctx.mutationSafety.reapply(changeSetId, origin)
      if (!result.revertable) {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', result.reason === 'FORWARD_STATE_UNAVAILABLE'
          ? 'This older change set can be safely undone but does not contain enough forward state to redo.'
          : 'Touched state changed after this change set; refusing to overwrite newer work.'))
        return true
      }
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: ctx.mutationSafety.get(changeSetId) })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Change set action failed.'))
    }
    return true
  }

  return false
}
