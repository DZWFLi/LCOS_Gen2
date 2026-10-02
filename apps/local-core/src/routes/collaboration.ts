import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CollaborationProjectionService } from '../collaboration-projection-service.js'
import type { ConversationContinuationService } from '../conversation-continuation-service.js'
import type { ConversationImportService } from '../conversation-import-service.js'
import type { ContinuationProviderAdapterV1 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { routeRequireProject, type RouteHttpHelpers } from './route-context.js'
import { parseOrderedReferences } from './ordered-references.js'

export interface CollaborationRouteContext {
  readonly method: string
  readonly pathname: string
  readonly url: URL
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly collaborationProjection: CollaborationProjectionService | undefined
  readonly continuation: ConversationContinuationService | undefined
  readonly conversations: ConversationImportService | undefined
  readonly adapter: ContinuationProviderAdapterV1 | undefined
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
  const sendMatch = /^\/projects\/([^/]+)\/connected-conversations\/([^/]+)\/collaboration-send$/.exec(ctx.pathname)
  if (match === null && sendMatch === null) return false
  if (sendMatch !== null) {
    if (ctx.method !== 'POST') {
      ctx.helpers.sendJson(ctx.response, 405, ctx.helpers.failure('INVALID_ARGUMENT', 'Collaboration send accepts POST only.'))
      return true
    }
    if (ctx.metadata === undefined || ctx.continuation === undefined || ctx.conversations === undefined || ctx.adapter === undefined) {
      ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Collaboration send service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(sendMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true
    const connectedConversationId = decodeURIComponent(sendMatch[2] ?? '')
    const connected = ctx.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (connected === undefined) {
      ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Connected conversation not found.'))
      return true
    }
    if (connected.conversationSessionId === undefined) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', 'Connected conversation has no explicit canonical conversation session.'))
      return true
    }
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (!ctx.helpers.isRecord(raw)
      || (raw.conversationId !== undefined && typeof raw.conversationId !== 'string')
      || typeof raw.messageId !== 'string'
      || typeof raw.continuationOperationId !== 'string'
      || typeof raw.text !== 'string') {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'conversationId, messageId, continuationOperationId and text are required.'))
      return true
    }
    if ((raw.conversationId !== undefined && raw.conversationId !== connectedConversationId) || raw.messageId.trim() === '' || raw.continuationOperationId.trim() === '' || raw.text.trim() === '') {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'conversationId must match the route and ids/text must be non-empty.'))
      return true
    }
    if (raw.messageId.length > 200 || raw.continuationOperationId.length > 200 || raw.text.length > 200_000) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'messageId/continuationOperationId/text exceeds the length limit.'))
      return true
    }
    if (raw.targetRefs !== undefined && (!Array.isArray(raw.targetRefs) || raw.targetRefs.some((ref) => typeof ref !== 'string'))) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'targetRefs must be an array of strings when present.'))
      return true
    }
    if (Array.isArray(raw.targetRefs) && raw.targetRefs.length > 0) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', 'Continuation context must use typed orderedReferences; display refs were not dropped.'))
      return true
    }
    let orderedReferences: readonly import('@local-creative-os/contracts').OrderedRunReferenceV2[] | undefined
    if (raw.orderedReferences !== undefined) {
      const parsed = parseOrderedReferences(raw.orderedReferences)
      if ('error' in parsed) {
        ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', parsed.error))
        return true
      }
      orderedReferences = parsed.value
    }
    if (Object.keys(raw).some((key) => !['conversationId', 'messageId', 'continuationOperationId', 'text', 'targetRefs', 'orderedReferences'].includes(key))) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Unexpected field in collaboration send input.'))
      return true
    }
    const operation = ctx.continuation.read(projectId, raw.continuationOperationId)
    if (operation === undefined) {
      ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Continuation operation not found.'))
      return true
    }
    if (operation.connectedConversationId !== connectedConversationId) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', 'Continuation operation is not bound to this connected conversation.'))
      return true
    }
    if (operation.externalEvidence === undefined || operation.cancel !== 'none' || operation.status === 'outcome_unknown' || operation.status === 'cancelled') {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', 'Continuation operation has no confirmed sendable provider owner.'))
      return true
    }
    if (ctx.conversations.getProjection(projectId, connected.conversationSessionId) === undefined) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', 'Connected conversation session is missing from Core.'))
      return true
    }
    // Completed-turn fast paths still have to agree with the original explicit input.
    // The continuation service checks this too, but an already complete turn returns before it.
    const original = ctx.metadata.getContinuationOperationJournal(projectId, raw.continuationOperationId)
      ?.promptReceipts?.find((item) => item.messageId === raw.messageId)
    if (original !== undefined && JSON.stringify(original.explicitReferences ?? original.orderedReferences) !== JSON.stringify(orderedReferences ?? [])) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', 'This messageId already belongs to a different reference set; the original send was not changed.'))
      return true
    }
    try {
      const reserved = ctx.conversations.reserveContinuationPrompt(projectId, connected.conversationSessionId, { messageId: raw.messageId, userText: raw.text })
      if (reserved.status === 'complete' && reserved.assistant !== undefined) {
        ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: { schemaVersion: 1, command: 'send', acceptedAt: reserved.assistant.createdAt, continuationOperationId: raw.continuationOperationId, conversationId: connectedConversationId, messages: { user: reserved.user, assistant: reserved.assistant } } })
        return true
      }
      if (reserved.status === 'pending') {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', 'This prompt already crossed the provider boundary and its outcome is unknown; reconcile before retrying.'))
        return true
      }
      const sent = await ctx.continuation.sendPrompt(
        projectId,
        raw.continuationOperationId,
        { kind: 'prompt', text: raw.text },
        ctx.adapter,
        raw.messageId,
        { ...(orderedReferences === undefined ? {} : { orderedReferences }), messageId: raw.messageId },
      )
      if (sent.outcome === 'outcome_unknown' || sent.outcome === 'unresolved') {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', `${sent.error?.message ?? 'Prompt outcome is unknown; reconcile before retrying.'} Receipt: ${sent.action}/${sent.outcome}/${sent.observedAt}.`))
        return true
      }
      if (sent.outcome !== 'sent') {
        // Only an explicit provider failure/unsupported result is safe to
        // retry. Unknown/unresolved outcomes keep the reservation so a retry
        // cannot cross the provider boundary twice.
        if (sent.outcome === 'failed' || sent.outcome === 'unsupported') {
          ctx.conversations.releaseContinuationPrompt(projectId, connected.conversationSessionId, raw.messageId)
        }
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', `${sent.error?.message ?? 'Provider did not accept the prompt.'} Receipt: ${sent.action}/${sent.outcome}/${sent.observedAt}.`))
        return true
      }
      if (sent.responseText === undefined || sent.responseText.trim() === '') {
        // The provider accepted the prompt but returned no assistant text.
        // Keep the reservation: the external side effect may already exist;
        // recovery/reconcile must resolve it before another send is allowed.
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', 'Provider accepted the prompt but returned no assistant message; reconcile before retrying.'))
        return true
      }
      const messages = ctx.conversations.appendContinuationTurn(projectId, connected.conversationSessionId, {
        messageId: raw.messageId,
        userText: raw.text,
        assistantText: sent.responseText,
        occurredAt: sent.observedAt,
      })
      ctx.continuation.publishTimelineAppended(projectId, connectedConversationId, raw.messageId)
      ctx.helpers.sendJson(ctx.response, 200, {
        ok: true,
        value: {
          schemaVersion: 1,
          command: 'send',
          acceptedAt: sent.observedAt,
          continuationOperationId: raw.continuationOperationId,
          conversationId: connectedConversationId,
          messages,
        },
      })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Collaboration send failed.'))
    }
    return true
  }
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
