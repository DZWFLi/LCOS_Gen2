import type { ProjectId } from '@local-creative-os/domain'
import type { SpatialMarkerIntentV0, StableSurfaceRefV0 } from '@local-creative-os/contracts'
import { NavigationMarkerService } from '../navigation-marker-service.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface NavigationMarkersRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  /** Marker 增删走 ChangeSet 纪律（用户持久 Project intent）。 */
  readonly mutationSafety: import('../mutation-safety-service.js').MutationSafetyService | undefined
}

function isStableSurfaceRef(value: string): value is StableSurfaceRefV0 {
  if (value === 'main' || value === 'assembly') return true
  return ['scope:', 'workspace:', 'conversation:'].some((prefix) => value.startsWith(prefix) && value.length > prefix.length)
}

/**
 * F6A2 后端小刀（20260829）：Spatial Marker 意图持久化 + 导航目标解析。
 * - GET    /projects/:id/spatial-markers            → 列出 marker intents
 * - POST   /projects/:id/spatial-markers            → 创建（ChangeSet-backed；跨 Project fail-close）
 * - DELETE /projects/:id/spatial-markers/:markerId  → 删除（ChangeSet-backed）
 * - POST   /projects/:id/navigation/resolve         → 解析 targetRef（unresolved 是合法结果不是错误）
 */
export async function handleNavigationMarkersRoute(ctx: NavigationMarkersRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, metadata, mutationSafety } = ctx
  const { sendJson, failure, readJsonBody, isRecord } = ctx.helpers

  const listMatch = /^\/projects\/([^/]+)\/spatial-markers$/.exec(pathname)
  if (listMatch !== null && method === 'GET') {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(listMatch[1] ?? '') as ProjectId
    if (routeRequireProject(projectId, { metadata: db, response, helpers: ctx.helpers }) === undefined) return true
    sendJson(response, 200, { ok: true, value: db.listSpatialMarkerIntents(projectId) })
    return true
  }

  const createMatch = /^\/projects\/([^/]+)\/spatial-markers$/.exec(pathname)
  if (createMatch !== null && method === 'POST') {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(createMatch[1] ?? '') as ProjectId
    if (routeRequireProject(projectId, { metadata: db, response, helpers: ctx.helpers }) === undefined) return true
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || !isRecord(input.targetRef)
      || !['view', 'entity', 'surface'].includes(String(input.targetRef.kind))
      || typeof input.targetRef.id !== 'string' || input.targetRef.id.length === 0
      || typeof input.targetRef.projectId !== 'string'
      || !['local', 'cross-surface'].includes(String(input.scope))
      || (String(input.scope) === 'local' && typeof input.sourceSurfaceRef !== 'string')
      || (input.sourceSurfaceRef !== undefined && (typeof input.sourceSurfaceRef !== 'string' || !isStableSurfaceRef(input.sourceSurfaceRef)))
      || Object.keys(input).some((key) => !['targetRef', 'scope', 'sourceSurfaceRef'].includes(key))
      || Object.keys(input.targetRef).some((key) => !['projectId', 'kind', 'id'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Spatial marker requires targetRef {projectId, kind, id} and scope.'))
      return true
    }
    // 跨 Project fail-close：marker 只能指向本 Project 的 canonical target。
    if (String(input.targetRef.projectId) !== String(projectId)) {
      sendJson(response, 422, failure('INVALID_ARGUMENT', 'Spatial marker target must belong to the same project. Cross-project marker is fail-close.'))
      return true
    }
    if (typeof input.sourceSurfaceRef === 'string') {
      const sourceResolution = new NavigationMarkerService(db).resolveNavigationTarget(String(projectId), { projectId: String(projectId), kind: 'surface', id: input.sourceSurfaceRef })
      if (sourceResolution.status !== 'resolved' || sourceResolution.target.surfaceRef !== input.sourceSurfaceRef) {
        sendJson(response, 422, failure('INVALID_ARGUMENT', 'Spatial marker sourceSurfaceRef must resolve to a stable surface in this project.'))
        return true
      }
    }
    if (mutationSafety === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Mutation safety service is not configured.'))
      return true
    }
    const { marker, changeSet } = mutationSafety.addSpatialMarker({
      projectId: String(projectId),
      targetRef: {
        projectId: String(input.targetRef.projectId),
        kind: String(input.targetRef.kind) as SpatialMarkerIntentV0['targetRef']['kind'],
        id: String(input.targetRef.id),
      },
      scope: String(input.scope) as SpatialMarkerIntentV0['scope'],
      ...(input.sourceSurfaceRef === undefined ? {} : { sourceSurfaceRef: input.sourceSurfaceRef as StableSurfaceRefV0 }),
      actorKind: 'web',
    })
    sendJson(response, 201, { ok: true, value: marker, meta: { changeSetId: changeSet.id } })
    return true
  }

  const deleteMatch = /^\/projects\/([^/]+)\/spatial-markers\/([^/]+)$/.exec(pathname)
  if (deleteMatch !== null && method === 'DELETE') {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(deleteMatch[1] ?? '') as ProjectId
    const markerId = decodeURIComponent(deleteMatch[2] ?? '')
    if (routeRequireProject(projectId, { metadata: db, response, helpers: ctx.helpers }) === undefined) return true
    if (mutationSafety === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Mutation safety service is not configured.'))
      return true
    }
    const changeSet = mutationSafety.removeSpatialMarker({ projectId: String(projectId), markerId, actorKind: 'web' })
    if (changeSet === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Spatial marker not found.'))
      return true
    }
    sendJson(response, 200, { ok: true, value: { deleted: true, markerId }, meta: { changeSetId: changeSet.id } })
    return true
  }

  const resolveMatch = /^\/projects\/([^/]+)\/navigation\/resolve$/.exec(pathname)
  if (resolveMatch !== null && method === 'POST') {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(resolveMatch[1] ?? '') as ProjectId
    if (routeRequireProject(projectId, { metadata: db, response, helpers: ctx.helpers }) === undefined) return true
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || !isRecord(input.targetRef)
      || typeof input.targetRef.projectId !== 'string'
      || typeof input.targetRef.kind !== 'string'
      || typeof input.targetRef.id !== 'string'
      || Object.keys(input).some((key) => key !== 'targetRef')
      || Object.keys(input.targetRef).some((key) => !['projectId', 'kind', 'id'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Navigation resolve requires targetRef {projectId, kind, id}.'))
      return true
    }
    const service = new NavigationMarkerService(db)
    // unresolved 是合法结果（unresolved 决不是 HTTP 错误——前端拿诚实状态渲染失效 marker）。
    const resolution = service.resolveNavigationTarget(String(projectId), {
      projectId: String(input.targetRef.projectId),
      kind: String(input.targetRef.kind) as SpatialMarkerIntentV0['targetRef']['kind'],
      id: String(input.targetRef.id),
    })
    sendJson(response, 200, { ok: true, value: resolution })
    return true
  }

  return false
}
