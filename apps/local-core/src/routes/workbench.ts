import type { ProjectId, ScopeId } from '@local-creative-os/domain'

import { routeRequireMetadata, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'
import type { WorkbenchService } from '../workbench-service.js'

/**
 * /projects/:id/workbench/merge —— Core 收口的 Workbench Merge。
 *
 * 把临时工作现场的稳定 View References 并入 Root Scope（不复制 Artifact、
 * 不删 Run/Revision/Session/Snapshot），并清除临时视图。
 */
export interface WorkbenchRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly workbench: WorkbenchService | undefined
}

export async function handleWorkbenchRoute(ctx: WorkbenchRouteContext): Promise<boolean> {
  const { method, pathname, request, response, helpers } = ctx
  const mergeMatch = /^\/projects\/([^/]+)\/workbench\/merge$/.exec(pathname)
  if (mergeMatch === null || method !== 'POST') return false

  const metadata = routeRequireMetadata(ctx)
  if (metadata === undefined) return true
  const workbench = ctx.workbench
  if (workbench === undefined) {
    helpers.sendJson(response, 400, helpers.failure('VALIDATION', 'Workbench service is unavailable.'))
    return true
  }

  const projectId = decodeURIComponent(mergeMatch[1] ?? '') as ProjectId
  let body: unknown
  try {
    body = await helpers.readJsonBody(request, ctx.controller.signal)
  } catch {
    helpers.sendJson(response, 400, helpers.failure('INVALID_ARGUMENT', 'Invalid JSON body.'))
    return true
  }
  const workbenchScopeId = (body as { workbenchScopeId?: unknown })?.workbenchScopeId
  if (typeof workbenchScopeId !== 'string' || workbenchScopeId.length === 0) {
    helpers.sendJson(response, 400, helpers.failure('INVALID_ARGUMENT', 'workbenchScopeId is required.'))
    return true
  }

  try {
    const value = workbench.merge(projectId, workbenchScopeId as ScopeId)
    helpers.sendJson(response, 200, { ok: true, value })
  } catch (error: unknown) {
    helpers.sendJson(response, 400, helpers.failure('VALIDATION', error instanceof Error ? error.message : 'Workbench merge failed.'))
  }
  return true
}
