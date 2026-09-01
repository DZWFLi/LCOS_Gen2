/**
 * Skill Author 路由（P0-D semantic execution bridge）。
 *
 *   POST /projects/{id}/skill-author/execute   → dispatch：创建 lcos-skill-author agentlet run
 *   POST /projects/{id}/skill-author/ingest    → ingest：接收 harness 结构化结果 → 校验 → SkillProposal 持久化
 *   POST /projects/{id}/skill-author/semantic  → semantic：harness 经 Core 调真实 LLM（凭证在 Core），供语义生成
 *
 * 边界：本 route 只做 dispatch/ingest/semantic 缝合。proposal review / accept / install
 * 全部走既有 SkillProposalService + SkillPackageService（CAS）。
 */

import type { SkillAuthorDispatchService } from '../skill-author-dispatch-service.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'
import { routeRequireProject } from './route-context.js'

export interface SkillAuthorRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly skillAuthorDispatch: SkillAuthorDispatchService | undefined
}

export async function handleSkillAuthorRoute(ctx: SkillAuthorRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, metadata, skillAuthorDispatch } = ctx
  const { sendJson, failure, readJsonBody } = ctx.helpers

  const executeMatch = /^\/projects\/([^/]+)\/skill-author\/execute$/.exec(pathname)
  const ingestMatch = /^\/projects\/([^/]+)\/skill-author\/ingest$/.exec(pathname)
  const semanticMatch = /^\/projects\/([^/]+)\/skill-author\/semantic$/.exec(pathname)
  if (executeMatch === null && ingestMatch === null && semanticMatch === null) return false

  if (metadata === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Metadata repository is not configured.'))
    return true
  }
  if (skillAuthorDispatch === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Skill author dispatch service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent((executeMatch ?? ingestMatch ?? semanticMatch)?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true

  if (executeMatch !== null && method === 'POST') {
    let body: unknown
    try {
      body = await readJsonBody(request, controller.signal)
    } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Execute requires a JSON body.'))
      return true
    }
    try {
      const intent = normalizeExecuteIntent(body, projectId)
      const value = skillAuthorDispatch.dispatch(intent)
      sendJson(response, 201, { ok: true, value })
    } catch (error: unknown) {
      const code = error instanceof Error && error.message.startsWith('INVALID_ARGUMENT') ? 'INVALID_ARGUMENT' : 'UNAVAILABLE'
      const status = code === 'INVALID_ARGUMENT' ? 400 : 503
      sendJson(response, status, failure(code, error instanceof Error ? error.message : 'Skill author dispatch failed.'))
    }
    return true
  }

  if (ingestMatch !== null && method === 'POST') {
    let body: unknown
    try {
      body = await readJsonBody(request, controller.signal)
    } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Ingest requires a JSON body.'))
      return true
    }
    const sessionId = String((body as { sessionId?: unknown })?.sessionId ?? '')
    try {
      const value = skillAuthorDispatch.ingest(projectId, sessionId, body)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Skill author ingest failed.'
      if (message.startsWith('SKILL_AUTHOR_INVALID_OUTPUT')) {
        sendJson(response, 422, failure('VALIDATION', message))
      } else if (message.startsWith('INVALID_ARGUMENT')) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', message))
      } else {
        sendJson(response, 503, failure('UNAVAILABLE', message))
      }
    }
    return true
  }

  if (semanticMatch !== null && method === 'POST') {
    let body: unknown
    try {
      body = await readJsonBody(request, controller.signal)
    } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Semantic requires a JSON body.'))
      return true
    }
    const value = await skillAuthorDispatch.semanticGenerate(body as { schemaName: string; schema: Record<string, unknown>; system: string; input: unknown })
    if (value.ok && value.value !== undefined) {
      sendJson(response, 200, { ok: true, value: value.value })
    } else {
      sendJson(response, 200, { ok: false, value: null, error: { code: 'SEMANTIC_UNAVAILABLE', message: 'Semantic source unavailable; harness should fall back honestly.' } })
    }
    return true
  }

  sendJson(response, 405, failure('INVALID_ARGUMENT', 'Skill author routes accept POST only.'))
  return true
}

function normalizeExecuteIntent(body: unknown, projectId: string): import('@local-creative-os/contracts').SkillAuthorExecuteIntentV1 {
  if (typeof body !== 'object' || body === null) throw new Error('INVALID_ARGUMENT: body must be an object.')
  const input = body as Record<string, unknown>
  const runId = String(input.runId ?? '')
  const intent = typeof input.intent === 'string' ? input.intent : undefined
  return {
    schemaVersion: 1,
    projectId,
    runId,
    ...(intent === undefined || intent.length === 0 ? {} : { intent }),
  }
}