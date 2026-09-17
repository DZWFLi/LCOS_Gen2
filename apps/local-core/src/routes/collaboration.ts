import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CollaborationProjectionService } from '../collaboration-projection-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { routeRequireProject, type RouteHttpHelpers } from './route-context.js'

export interface CollaborationRouteContext {
  readonly method: string
  readonly pathname: string
  readonly url: URL
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly collaborationProjection: CollaborationProjectionService | undefined
  readonly helpers: RouteHttpHelpers
}

/**
 * Collaboration read 路由（收敛方案 V1 Gate 2）：
 * - GET /projects/:pid/connected-conversations/:cid/collaboration-session
 * - GET /projects/:pid/connected-conversations/:cid/collaboration-timeline?limit=N
 * conversation 不存在才 404；投影内部字段诚实缺席（partial 语义同 work-view）。
 */
export async function handleCollaborationRoute(ctx: CollaborationRouteContext): Promise<boolean> {
  const match = /^\/projects\/([^/]+)\/connected-conversations\/([^/]+)\/collaboration-(session|timeline)$/.exec(ctx.pathname)
  if (match === null) return false
  if (ctx.method !== 'GET') {
    ctx.helpers.sendJson(ctx.response, 405, ctx.helpers.failure('INVALID_ARGUMENT', 'Collaboration routes accept GET only.'))
    return true
  }
  if (ctx.metadata === undefined || ctx.collaborationProjection === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Collaboration projection service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent(match[1] ?? '')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true
  const connectedConversationId = decodeURIComponent(match[2] ?? '')
  const kind = match[3]

  if (kind === 'session') {
    const value = await ctx.collaborationProjection.getSession(projectId, connectedConversationId)
    if (value === undefined) {
      ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Connected conversation not found.'))
      return true
    }
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    return true
  }

  const limitRaw = ctx.url.searchParams.get('limit')
  const limit = limitRaw === null ? undefined : Number(limitRaw)
  if (limitRaw !== null && (!Number.isInteger(limit) || (limit ?? -1) < 1 || (limit ?? 0) > 200)) {
    ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'limit must be an integer between 1 and 200.'))
    return true
  }
  const items = ctx.collaborationProjection.getTimeline(projectId, connectedConversationId, limit === undefined ? {} : { limit })
  if (items === undefined) {
    ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Connected conversation not found.'))
    return true
  }
  ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: items })
  return true
}