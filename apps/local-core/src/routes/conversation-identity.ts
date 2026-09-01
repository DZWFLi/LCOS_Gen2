import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ConversationIdentityService } from '../conversation-identity-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { isRecord, routeRequireProject, type RouteHttpHelpers } from './route-context.js'

/**
 * Conversation Identity Bridge REST 面（20260827 P0）：
 *   GET  /projects/{id}/active-receiver-identity                     → Active Receiver 全链（含 lifecycle）
 *   GET  /projects/{id}/connected-conversations/{cid}/identity       → 单条承接会话身份链
 *   POST /projects/{id}/connected-conversations/{cid}/link-session   → 显式建立 canonical 链接
 *   GET  /projects/{id}/artifacts/{aid}/birth                        → Artifact 出生谱系全链
 *
 * 解析纪律：不猜。未链接/未出生的字段诚实缺席（undefined），错误一律 404/400 说明。
 */
export interface ConversationIdentityRouteContext {
  readonly method: string
  readonly pathname: string
  readonly url: URL
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly identity: ConversationIdentityService | undefined
  readonly helpers: RouteHttpHelpers
}


const MAX_ID_LENGTH = 256

export async function handleConversationIdentityRoute(ctx: ConversationIdentityRouteContext): Promise<boolean> {
  const { method, pathname, request, response, signal, metadata, identity } = ctx
  const { sendJson, failure, readJsonBody } = ctx.helpers

  const activeMatch = /^\/projects\/([^/]+)\/active-receiver-identity$/.exec(pathname)
  const chainMatch = /^\/projects\/([^/]+)\/connected-conversations\/([^/]+)\/identity$/.exec(pathname)
  const linkMatch = /^\/projects\/([^/]+)\/connected-conversations\/([^/]+)\/link-session$/.exec(pathname)
  const birthMatch = /^\/projects\/([^/]+)\/artifacts\/([^/]+)\/birth$/.exec(pathname)
  if (activeMatch === null && chainMatch === null && linkMatch === null && birthMatch === null) return false

  if (metadata === undefined || identity === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Conversation identity service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent((activeMatch ?? chainMatch ?? linkMatch ?? birthMatch)?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true

  if (activeMatch !== null && method === 'GET') {
    sendJson(response, 200, { ok: true, value: identity.resolveActiveReceiver(projectId) })
    return true
  }

  if (chainMatch !== null && method === 'GET') {
    const connectedConversationId = decodeURIComponent(chainMatch[2] ?? '')
    const chain = identity.resolveChain(projectId, connectedConversationId)
    if (chain === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Connected conversation not found.'))
      return true
    }
    sendJson(response, 200, { ok: true, value: chain })
    return true
  }

  if (linkMatch !== null && method === 'POST') {
    const connectedConversationId = decodeURIComponent(linkMatch[2] ?? '')
    let raw: unknown
    try { raw = await readJsonBody(request, signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const input = isRecord(raw) && 'input' in raw && isRecord(raw.input) ? raw.input : raw
    if (!isRecord(input) || typeof input.conversationSessionId !== 'string'
      || input.conversationSessionId.length < 1 || input.conversationSessionId.length > MAX_ID_LENGTH) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'conversationSessionId is required (string).'))
      return true
    }
    const origin = isRecord(raw) && typeof raw.origin === 'string' ? raw.origin : undefined
    try {
      const chain = identity.linkSession(projectId, connectedConversationId, input.conversationSessionId, origin)
      sendJson(response, 200, { ok: true, value: chain })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Link failed.'
      const status = message.includes('Connected conversation') || message.includes('Conversation session') ? 404 : 409
      sendJson(response, status, failure(status === 404 ? 'NOT_FOUND' : 'CONFLICT', message))
    }
    return true
  }

  if (birthMatch !== null && method === 'GET') {
    const artifactId = decodeURIComponent(birthMatch[2] ?? '')
    const birth = identity.resolveBirth(projectId, artifactId)
    if (birth === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Artifact not found.'))
      return true
    }
    sendJson(response, 200, { ok: true, value: birth })
    return true
  }

  sendJson(response, 405, failure('INVALID_ARGUMENT', 'Conversation identity routes accept GET/POST only.'))
  return true
}
