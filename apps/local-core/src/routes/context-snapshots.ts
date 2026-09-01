import type { ProjectId, ScopeId, WorkspaceId } from '@local-creative-os/domain'

import type { ContextSnapshotService } from '../context-snapshot-service.js'
import { routeRequireMetadata, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface ContextSnapshotsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly contextSnapshots: ContextSnapshotService | undefined
}

/**
 * /projects/:id/context-snapshots —— B5 上下文快照：历史列表、创建、
 * 快照对比（compare）、从快照分支为工作集合（branch）。
 */
export async function handleContextSnapshotsRoute(ctx: ContextSnapshotsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, helpers, url } = ctx
  const service = ctx.contextSnapshots

  const listOrCreateMatch = /^\/projects\/([^/]+)\/context-snapshots$/.exec(pathname)
  if (listOrCreateMatch !== null && (method === 'GET' || method === 'POST')) {
    if (service === undefined) {
      helpers.sendJson(response, 400, helpers.failure('VALIDATION', 'ContextSnapshot service is unavailable.'))
      return true
    }
    const projectId = decodeURIComponent(listOrCreateMatch[1] ?? '') as ProjectId
    if (method === 'GET') {
      const workspaceRaw = url.searchParams.get('workspaceId')
      const workspaceId = workspaceRaw === null || workspaceRaw === '' ? undefined : workspaceRaw as WorkspaceId
      try {
        helpers.sendJson(response, 200, { ok: true, value: service.list(projectId, workspaceId) })
      } catch (error: unknown) {
        helpers.sendJson(response, 400, helpers.failure('VALIDATION', error instanceof Error ? error.message : 'List failed.'))
      }
      return true
    }
    try {
      const body = await helpers.readJsonBody(request, ctx.controller.signal) as { label?: unknown; workspaceId?: unknown }
      if (typeof body?.label !== 'string' || body.label.trim() === '' || body.label.length > 120) {
        helpers.sendJson(response, 400, helpers.failure('INVALID_ARGUMENT', 'label is required (under 120 chars).'))
        return true
      }
      const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId.length > 0 ? body.workspaceId as WorkspaceId : undefined
      const value = service.create(projectId, body.label.trim(), workspaceId)
      helpers.sendJson(response, 201, { ok: true, value })
    } catch (error: unknown) {
      helpers.sendJson(response, 400, helpers.failure('VALIDATION', error instanceof Error ? error.message : 'Create snapshot failed.'))
    }
    return true
  }

  const compareMatch = /^\/projects\/([^/]+)\/context-snapshots\/([^/]+)\/compare$/.exec(pathname)
  if (compareMatch !== null && method === 'POST') {
    if (service === undefined) {
      helpers.sendJson(response, 400, helpers.failure('VALIDATION', 'ContextSnapshot service is unavailable.'))
      return true
    }
    const projectId = decodeURIComponent(compareMatch[1] ?? '') as ProjectId
    const snapshotId = decodeURIComponent(compareMatch[2] ?? '')
    try {
      const body = await helpers.readJsonBody(request, ctx.controller.signal) as { otherSnapshotId?: unknown }
      if (typeof body?.otherSnapshotId !== 'string' || body.otherSnapshotId.length === 0) {
        helpers.sendJson(response, 400, helpers.failure('INVALID_ARGUMENT', 'otherSnapshotId is required.'))
        return true
      }
      const value = service.compare(projectId, snapshotId, body.otherSnapshotId)
      helpers.sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      helpers.sendJson(response, 400, helpers.failure('VALIDATION', error instanceof Error ? error.message : 'Compare failed.'))
    }
    return true
  }

  const branchMatch = /^\/projects\/([^/]+)\/context-snapshots\/([^/]+)\/branch$/.exec(pathname)
  if (branchMatch !== null && method === 'POST') {
    if (service === undefined) {
      helpers.sendJson(response, 400, helpers.failure('VALIDATION', 'ContextSnapshot service is unavailable.'))
      return true
    }
    const projectId = decodeURIComponent(branchMatch[1] ?? '') as ProjectId
    const snapshotId = decodeURIComponent(branchMatch[2] ?? '')
    try {
      const body = await helpers.readJsonBody(request, ctx.controller.signal) as { label?: unknown; targetScopeId?: unknown }
      if (typeof body?.label !== 'string' || body.label.trim() === '') {
        helpers.sendJson(response, 400, helpers.failure('INVALID_ARGUMENT', 'label is required.'))
        return true
      }
      const targetScopeId = typeof body.targetScopeId === 'string' && body.targetScopeId.length > 0 ? body.targetScopeId as ScopeId : undefined
      const value = service.branch(projectId, snapshotId, body.label.trim(), targetScopeId)
      helpers.sendJson(response, 201, { ok: true, value })
    } catch (error: unknown) {
      helpers.sendJson(response, 400, helpers.failure('VALIDATION', error instanceof Error ? error.message : 'Branch failed.'))
    }
    return true
  }

  return false
}
