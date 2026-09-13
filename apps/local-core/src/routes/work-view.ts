import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConversationWorkViewProjectionService } from '../conversation-work-view-projection-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { routeRequireProject, type RouteHttpHelpers } from './route-context.js'

export interface WorkViewRouteContext {
  readonly method: string
  readonly pathname: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly workView: ConversationWorkViewProjectionService | undefined
  readonly helpers: RouteHttpHelpers
}

/**
 * T6 canonical read：GET /projects/:pid/connected-conversations/:cid/work-view。
 * identity-only / content-pending 也返回 200（partial 语义，T4 §2.3）；
 * conversation 不存在才 404。
 */
export async function handleWorkViewRoute(ctx: WorkViewRouteContext): Promise<boolean> {
  const match = /^\/projects\/([^/]+)\/connected-conversations\/([^/]+)\/work-view$/.exec(ctx.pathname)
  if (match === null) return false
  if (ctx.method !== 'GET') {
    ctx.helpers.sendJson(ctx.response, 405, ctx.helpers.failure('INVALID_ARGUMENT', 'Work view route accepts GET only.'))
    return true
  }
  if (ctx.metadata === undefined || ctx.workView === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Work view service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent(match[1] ?? '')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true
  const connectedConversationId = decodeURIComponent(match[2] ?? '')
  const value = ctx.workView.get(projectId, connectedConversationId)
  if (value === undefined) {
    ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Connected conversation not found.'))
    return true
  }
  ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
  return true
}
