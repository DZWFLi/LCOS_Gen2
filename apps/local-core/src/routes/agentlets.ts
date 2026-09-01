/**
 * Agentlet 路由（任务四 P3）。
 *
 *   GET  /agentlets                          → 列出可用 agentlet（manifest 摘要）
 *   GET  /agentlets/runs[?projectId=]        → 运行记录（宿主内存态）
 *   POST /projects/{id}/agentlets/{name}/launch  → spawn 一个 agentlet run
 *                                               body: { instruction?, harness? }
 *
 * 宿主不理解 agentlet 内容；子进程经 Reachback（/space/ 读 + curation/text 写）
 * 自主作业，写安全由既有 CAS/ChangeSet 通道保证。
 */

import type { AgentletRuntimeService } from '../agentlet-runtime-service.js'
import { AgentletManifestError } from '../agentlet-runtime-service.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'
import { routeRequireProject } from './route-context.js'

export interface AgentletsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly agentletRuntime: AgentletRuntimeService | undefined
}

function statusForError(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('not found')) return 404
  if (error instanceof AgentletManifestError) return 400
  return 400
}

export async function handleAgentletsRoute(ctx: AgentletsRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, controller, metadata, agentletRuntime } = ctx
  const { sendJson, failure, readJsonBody } = ctx.helpers

  const listMatch = /^\/agentlets$/.exec(pathname)
  const runsMatch = /^\/agentlets\/runs$/.exec(pathname)
  const launchMatch = /^\/projects\/([^/]+)\/agentlets\/([^/]+)\/launch$/.exec(pathname)
  const progressMatch = /^\/agentlets\/runs\/([^/]+)\/progress$/.exec(pathname)
  if (listMatch === null && runsMatch === null && launchMatch === null && progressMatch === null) return false

  if (agentletRuntime === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Agentlet runtime is not configured.'))
    return true
  }

  if (listMatch !== null && method === 'GET') {
    sendJson(response, 200, { ok: true, value: agentletRuntime.list() })
    return true
  }

  if (runsMatch !== null && method === 'GET') {
    const projectId = url.searchParams.get('projectId') ?? undefined
    sendJson(response, 200, { ok: true, value: agentletRuntime.runs(projectId) })
    return true
  }

  if (launchMatch !== null && method === 'POST') {
    if (metadata === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Metadata repository is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(launchMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const name = decodeURIComponent(launchMatch[2] ?? '')
    let body: { instruction?: unknown; harness?: unknown } = {}
    try {
      body = await readJsonBody(request, controller.signal) as { instruction?: unknown; harness?: unknown }
    } catch {
      body = {}
    }
    if ((body.instruction !== undefined && (typeof body.instruction !== 'string' || body.instruction.length > 8_000))
      || (body.harness !== undefined && (typeof body.harness !== 'string' || body.harness.length > 64))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Launch accepts optional instruction (string) and harness (string).'))
      return true
    }
    try {
      const run = agentletRuntime.launch(projectId, name, {
        ...(typeof body.instruction === 'string' && body.instruction !== '' ? { instruction: body.instruction } : {}),
        ...(typeof body.harness === 'string' && body.harness !== '' ? { harness: body.harness } : {}),
      })
      sendJson(response, 201, { ok: true, value: run })
    } catch (error: unknown) {
      const status = statusForError(error)
      const code = status === 404 ? 'NOT_FOUND' : 'INVALID_ARGUMENT'
      sendJson(response, status, failure(code, error instanceof Error ? error.message : 'Agentlet launch failed.'))
    }
    return true
  }


  if (progressMatch !== null && method === "POST") {
    const runId = decodeURIComponent(progressMatch[1] ?? "")
    let body: unknown
    try { body = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Progress requires a JSON body.'))
      return true
    }
    const progress = Number((body as { progress?: unknown })?.progress)
    if (!Number.isFinite(progress)) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'progress must be a finite number (0-1).'))
      return true
    }
    const projectId = String((body as { projectId?: unknown })?.projectId ?? "")
    agentletRuntime.reportProgress(runId, projectId, progress)
    sendJson(response, 200, { ok: true, value: { runId, progress } })
    return true
  }
  sendJson(response, 405, failure('INVALID_ARGUMENT', 'Agentlet routes accept GET/POST only.'))
  return true
}