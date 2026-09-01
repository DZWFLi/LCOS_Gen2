import type { ColorPinSnapshotV0, SpatialMarkerTargetRefV0 } from '@local-creative-os/contracts'
import type { ProjectId } from '@local-creative-os/domain'
import { NavigationMarkerService } from '../navigation-marker-service.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface ColorPinsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly mutationSafety: import('../mutation-safety-service.js').MutationSafetyService | undefined
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

export async function handleColorPinsRoute(ctx: ColorPinsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, mutationSafety } = ctx
  const { sendJson, failure, readJsonBody, isRecord } = ctx.helpers
  const listMatch = /^\/projects\/([^/]+)\/color-pins$/.exec(pathname)
  if (listMatch && method === 'GET') {
    const db = routeRequireMetadata(ctx); if (!db) return true
    const projectId = decodeURIComponent(listMatch[1] ?? '') as ProjectId
    if (!routeRequireProject(projectId, { metadata: db, response, helpers: ctx.helpers })) return true
    const value: ColorPinSnapshotV0 = { definitions: db.listColorPinDefinitions(projectId), memberships: db.listColorPinMemberships(projectId) }
    sendJson(response, 200, { ok: true, value }); return true
  }

  const assignMatch = /^\/projects\/([^/]+)\/color-pins\/memberships$/.exec(pathname)
  if (assignMatch && method === 'POST') {
    const db = routeRequireMetadata(ctx); if (!db) return true
    const projectId = decodeURIComponent(assignMatch[1] ?? '') as ProjectId
    if (!routeRequireProject(projectId, { metadata: db, response, helpers: ctx.helpers })) return true
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || !isRecord(input.targetRef)
      || String(input.targetRef.projectId) !== String(projectId)
      || !['view','entity','surface'].includes(String(input.targetRef.kind))
      || typeof input.targetRef.id !== 'string' || input.targetRef.id.length === 0
      || (input.colorPinId === undefined && (typeof input.color !== 'string' || !COLOR_RE.test(input.color)))
      || (input.colorPinId !== undefined && typeof input.colorPinId !== 'string')
      || (input.label !== undefined && typeof input.label !== 'string')
      || Object.keys(input).some((key) => !['targetRef','colorPinId','color','label'].includes(key))
      || Object.keys(input.targetRef).some((key) => !['projectId','kind','id'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Color Pin requires targetRef and either colorPinId or #RRGGBB color.')); return true
    }
    const targetRef = { projectId: String(projectId), kind: String(input.targetRef.kind) as SpatialMarkerTargetRefV0['kind'], id: String(input.targetRef.id) }
    const resolution = new NavigationMarkerService(db).resolveNavigationTarget(String(projectId), targetRef)
    if (resolution.status !== 'resolved') {
      sendJson(response, 422, failure('INVALID_ARGUMENT', 'Color Pin target must resolve to an existing canonical target in this project.')); return true
    }
    if (!mutationSafety) { sendJson(response, 503, failure('UNAVAILABLE', 'Mutation safety service is not configured.')); return true }
    try {
      const result = mutationSafety.assignColorPin({
        projectId: String(projectId),
        targetRef,
        ...(typeof input.colorPinId === 'string' ? { colorPinId: input.colorPinId } : {}),
        ...(typeof input.color === 'string' ? { color: input.color.toUpperCase() } : {}),
        ...(typeof input.label === 'string' ? { label: input.label } : {}),
        actorKind: 'web',
      })
      sendJson(response, result.changeSet ? 201 : 200, { ok: true, value: { definition: result.definition, membership: result.membership }, ...(result.changeSet ? { meta: { changeSetId: result.changeSet.id } } : {}) })
    } catch (error) { sendJson(response, 422, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Color Pin assignment failed.')) }
    return true
  }

  const deleteMatch = /^\/projects\/([^/]+)\/color-pins\/memberships\/([^/]+)$/.exec(pathname)
  if (deleteMatch && method === 'DELETE') {
    const db = routeRequireMetadata(ctx); if (!db) return true
    const projectId = decodeURIComponent(deleteMatch[1] ?? '') as ProjectId
    const membershipId = decodeURIComponent(deleteMatch[2] ?? '')
    if (!routeRequireProject(projectId, { metadata: db, response, helpers: ctx.helpers })) return true
    if (!mutationSafety) { sendJson(response, 503, failure('UNAVAILABLE', 'Mutation safety service is not configured.')); return true }
    const changeSet = mutationSafety.removeColorPinMembership({ projectId: String(projectId), membershipId, actorKind: 'web' })
    if (!changeSet) { sendJson(response, 404, failure('NOT_FOUND', 'Color Pin membership not found.')); return true }
    sendJson(response, 200, { ok: true, value: { deleted: true, membershipId }, meta: { changeSetId: changeSet.id } }); return true
  }
  return false
}
