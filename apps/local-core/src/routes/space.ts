/**
 * /space/ 虚拟命名空间路由（任务四 P1）。
 *
 *   POST /projects/{id}/space/ls      → 列出节点虚拟路径 + L1 扫描头
 *   POST /projects/{id}/space/read    → 按虚拟路径读全文（sessionId 存在则记 lease）
 *   POST /projects/{id}/space/search  → 关键词检索（标题+正文前缀，回片段；不记 lease）
 *
 * 只读通道：写不在此（走 CAS 守卫的 curation/text）。
 * 拒绝语义（huabu 同构）：前缀/穿越/allowlist → 400（消息可指导 agent 自纠）；
 * 路径存在性 → 404（提示 /space/ls 重发现）。
 */

import type { SpaceSandboxService } from '../space-sandbox-service.js'
import { SpacePathNotFoundError } from '../space-sandbox-service.js'
import { SpaceVfsError } from '../space-vfs.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'

export interface SpaceRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly spaceSandbox: SpaceSandboxService | undefined
}

export async function handleSpaceRoute(ctx: SpaceRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, metadata, spaceSandbox } = ctx
  const { sendJson, failure, readJsonBody } = ctx.helpers

  const lsMatch = /^\/projects\/([^/]+)\/space\/ls$/.exec(pathname)
  const readMatch = /^\/projects\/([^/]+)\/space\/read$/.exec(pathname)
  const searchMatch = /^\/projects\/([^/]+)\/space\/search$/.exec(pathname)
  if (lsMatch === null && readMatch === null && searchMatch === null) return false

  if (spaceSandbox === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Space sandbox service is not configured.'))
    return true
  }

  const projectId = decodeURIComponent((lsMatch ?? readMatch ?? searchMatch)?.[1] ?? '')
  if (metadata === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Metadata repository is not configured.'))
    return true
  }
  if (metadata.getProject(projectId) === undefined) {
    sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
    return true
  }

  if (lsMatch !== null && method === 'POST') {
    try {
      const value = await spaceSandbox.list(projectId)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Space ls failed.'))
    }
    return true
  }

  if (readMatch !== null && method === 'POST') {
    const body = await readJsonBody(request, controller.signal) as { path?: unknown; sessionId?: unknown }
    if (typeof body?.path !== 'string' || body.path.length === 0) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'path is required (e.g. "/space/nodes/foo.md").'))
      return true
    }
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : undefined
    try {
      const value = await spaceSandbox.read(projectId, body.path, sessionId)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      if (error instanceof SpaceVfsError) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', error.message))
        return true
      }
      if (error instanceof SpacePathNotFoundError) {
        sendJson(response, 404, failure('NOT_FOUND', error.message))
        return true
      }
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Space read failed.'))
    }
    return true
  }

  if (searchMatch !== null && method === 'POST') {
    const body = await readJsonBody(request, controller.signal) as { query?: unknown; limit?: unknown }
    if (typeof body?.query !== 'string' || body.query.trim().length === 0) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'query is required (space-separated terms, AND semantics).'))
      return true
    }
    const limit = typeof body?.limit === 'number' && Number.isInteger(body.limit) ? body.limit : undefined
    try {
      const value = await spaceSandbox.search(projectId, body.query, limit)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      if (error instanceof SpaceVfsError) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', error.message))
        return true
      }
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Space search failed.'))
    }
    return true
  }

  sendJson(response, 405, failure('INVALID_ARGUMENT', 'Space routes accept POST only.'))
  return true
}
