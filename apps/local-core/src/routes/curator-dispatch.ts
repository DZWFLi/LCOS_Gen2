/**
 * Curator 路由（P0-C semantic execution bridge）。
 *
 *   POST /projects/{id}/curator/reorganize   → dispatch：创建 lcos-project-curator agentlet run
 *   POST /projects/{id}/curator/ingest       → ingest：接收 harness 结构化结果 → 校验 → ReorganizeService 持久化
 *   POST /projects/{id}/curator/semantic     → semantic：harness 经 Core 调真实 LLM（凭证在 Core），供语义生成
 *
 * 边界：本 route 只做 dispatch/ingest/semantic 缝合。proposal lifecycle（ghost/apply/accept/rollback）
 * 全部走既有 ReorganizeService；运行态唯一投影 ExecutionItemV1。
 */

import type { CuratorDispatchService } from '../curator-dispatch-service.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'
import { routeRequireProject } from './route-context.js'

export interface CuratorRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly curatorDispatch: CuratorDispatchService | undefined
}

export async function handleCuratorRoute(ctx: CuratorRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, metadata, curatorDispatch } = ctx
  const { sendJson, failure, readJsonBody } = ctx.helpers

  const reorganizeMatch = /^\/projects\/([^/]+)\/curator\/reorganize$/.exec(pathname)
  const ingestMatch = /^\/projects\/([^/]+)\/curator\/ingest$/.exec(pathname)
  const semanticMatch = /^\/projects\/([^/]+)\/curator\/semantic$/.exec(pathname)
  if (reorganizeMatch === null && ingestMatch === null && semanticMatch === null) return false

  if (metadata === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Metadata repository is not configured.'))
    return true
  }
  if (curatorDispatch === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Curator dispatch service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent((reorganizeMatch ?? ingestMatch ?? semanticMatch)?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true

  if (reorganizeMatch !== null && method === 'POST') {
    let body: unknown
    try {
      body = await readJsonBody(request, controller.signal)
    } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Reorganize requires a JSON body.'))
      return true
    }
    try {
      const intent = normalizeReorganizeIntent(body, projectId)
      const value = curatorDispatch.dispatch(intent)
      sendJson(response, 201, { ok: true, value })
    } catch (error: unknown) {
      const code = error instanceof Error && error.message.startsWith('INVALID_ARGUMENT') ? 'INVALID_ARGUMENT' : 'UNAVAILABLE'
      const status = code === 'INVALID_ARGUMENT' ? 400 : 503
      sendJson(response, status, failure(code, error instanceof Error ? error.message : 'Curator dispatch failed.'))
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
      const value = curatorDispatch.ingest(projectId, sessionId, body)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Curator ingest failed.'
      if (message.startsWith('CURATOR_INVALID_OUTPUT')) {
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
    const value = await curatorDispatch.semanticGenerate(body as { schemaName: string; schema: Record<string, unknown>; system: string; input: unknown })
    if (value.ok && value.value !== undefined) {
      sendJson(response, 200, { ok: true, value: value.value })
    } else {
      sendJson(response, 200, { ok: false, value: null, error: { code: 'SEMANTIC_UNAVAILABLE', message: 'Semantic source unavailable; harness should fall back honestly.' } })
    }
    return true
  }

  sendJson(response, 405, failure('INVALID_ARGUMENT', 'Curator routes accept POST only.'))
  return true
}

function normalizeReorganizeIntent(body: unknown, projectId: string): import('@local-creative-os/contracts').CuratorReorganizeIntentV1 {
  if (typeof body !== 'object' || body === null) throw new Error('INVALID_ARGUMENT: body must be an object.')
  const input = body as Record<string, unknown>
  const presentationId = String(input.presentationId ?? '')
  const surfaceKind = String(input.surfaceKind ?? 'main')
  const surfaceId = String(input.surfaceId ?? '')
  const intent = String(input.intent ?? '')
  const selectionViewIds = Array.isArray(input.selectionViewIds) ? input.selectionViewIds.map(String) : []
  const lockedViewIds = Array.isArray(input.lockedViewIds) ? input.lockedViewIds.map(String) : undefined
  if (!['main', 'context', 'workflow'].includes(surfaceKind)) throw new Error('INVALID_ARGUMENT: surfaceKind must be main|context|workflow.')
  return {
    schemaVersion: 1,
    projectId,
    presentationId,
    surfaceKind: surfaceKind as 'main' | 'context' | 'workflow',
    surfaceId,
    selectionViewIds,
    intent,
    ...(lockedViewIds === undefined ? {} : { lockedViewIds }),
  }
}