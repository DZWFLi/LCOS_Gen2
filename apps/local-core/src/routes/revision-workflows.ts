import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PrepareRevisionRequestV1 } from '@local-creative-os/contracts'
import type { FeedbackRevisionService } from '../feedback-revision-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { isRecord, isStringArray, routeRequireProject, type RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'

export interface RevisionWorkflowsRouteContext {
  readonly method: string
  readonly pathname: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly feedbackRevision: FeedbackRevisionService | undefined
  readonly helpers: RouteHttpHelpers
}

function isPrepareInput(value: unknown): value is PrepareRevisionRequestV1 {
  if (!isRecord(value)) return false
  return typeof value.targetArtifactId === 'string'
    && (value.baseRevisionId === undefined || typeof value.baseRevisionId === 'string')
    && isStringArray(value.feedbackArtifactIds)
    && typeof value.decision === 'string'
    && isStringArray(value.changeItems)
    && isStringArray(value.preserveItems)
    && typeof value.scopeId === 'string'
    && (value.workspaceId === undefined || typeof value.workspaceId === 'string')
    && (value.requestedProvider === undefined || typeof value.requestedProvider === 'string')
}

export async function handleRevisionWorkflowsRoute(ctx: RevisionWorkflowsRouteContext): Promise<boolean> {
  const match = /^\/projects\/([^/]+)\/revision-workflows\/prepare$/.exec(ctx.pathname)
  if (match === null) return false
  if (ctx.method !== 'POST') return false
  if (ctx.metadata === undefined || ctx.feedbackRevision === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Feedback revision service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent(match[1] ?? '')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true

  let raw: unknown
  try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
    ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
    return true
  }
  if (!isRecord(raw)) {
    ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Revision workflow input is invalid.'))
    return true
  }
  const candidate = 'input' in raw ? raw.input : raw
  if (!isPrepareInput(candidate)) {
    ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Revision workflow requires target, feedback, decision, changeItems, preserveItems and scopeId.'))
    return true
  }
  const origin = parseProjectEventOrigin(raw.origin)
  try {
    const value = await ctx.feedbackRevision.prepare(projectId, candidate, origin)
    ctx.helpers.sendJson(ctx.response, 201, { ok: true, value })
  } catch (error: unknown) {
    ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Revision workflow preparation failed.'))
  }
  return true
}
