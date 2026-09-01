import type { PresentationViewV0 } from '@local-creative-os/contracts'

import { PresentationConflictError, type PresentationApplicationService } from '../presentation-application-service.js'
import type { ProjectMutationCoordinator } from '../project-events/project-mutation-coordinator.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'

export interface PresentationsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly presentation: PresentationApplicationService | undefined
  readonly projectMutations: ProjectMutationCoordinator
  /** F6 B6（P1-B census）：前端 bridge 的 membership 写入也进 semantic ChangeSet（placement-only 不进）。 */
  readonly mutationSafety: import('../mutation-safety-service.js').MutationSafetyService | undefined
}

/**
 * Presentation routes — Phase B.
 * GET list / GET one / PUT (contract + expectedVersion) / DELETE / SSE stream.
 * PUT never touches project graphVersion.
 */
export async function handlePresentationsRoute(ctx: PresentationsRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, controller, presentation, projectMutations, mutationSafety } = ctx
  const { sendJson, failure, readJsonBody } = ctx.helpers

  const listMatch = /^\/projects\/([^/]+)\/presentations$/.exec(pathname)
  const projectStreamMatch = /^\/projects\/([^/]+)\/presentations\/stream$/.exec(pathname)
  const oneMatch = /^\/projects\/([^/]+)\/presentations\/([^/]+)$/.exec(pathname)
  const streamMatch = /^\/projects\/([^/]+)\/presentations\/([^/]+)\/stream$/.exec(pathname)
  if (listMatch === null && projectStreamMatch === null && oneMatch === null && streamMatch === null) return false
  if (presentation === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Presentation service is not configured.'))
    return true
  }

  if (listMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(listMatch[1] ?? '')
    sendJson(response, 200, { ok: true, value: presentation.list(projectId) })
    return true
  }

  if (projectStreamMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(projectStreamMatch[1] ?? '')
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.flushHeaders()
    let closed = false
    const heartbeat = setInterval(() => {
      if (!closed && !response.writableEnded) response.write(': ping\n\n')
    }, 15_000)
    const sendEvent = (event: string, value: unknown): void => {
      if (!closed && !response.writableEnded) response.write(`event: ${event}\ndata: ${JSON.stringify({ ok: true, value })}\n\n`)
    }
    const unsubscribe = presentation.subscribeProject(projectId, (change) => sendEvent('update', change))
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
      if (!response.writableEnded) response.end()
    }
    request.on('close', close)
    request.on('error', close)
    response.on('close', close)
    sendEvent('snapshot', presentation.list(projectId).map(({ id: presentationId, version, updatedAt, updatedBy }) => ({ presentationId, version, updatedAt, updatedBy })))
    return true
  }

  if (streamMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(streamMatch[1] ?? '')
    const presentationId = decodeURIComponent(streamMatch[2] ?? '')
    const afterRaw = url.searchParams.get('afterVersion')
    const afterVersion = afterRaw === null ? undefined : Number(afterRaw)
    if (afterRaw !== null && (!Number.isInteger(afterVersion) || (afterVersion ?? -1) < 0)) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'afterVersion must be a non-negative integer.'))
      return true
    }
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.flushHeaders()
    let closed = false
    const heartbeat = setInterval(() => {
      if (!closed && !response.writableEnded) response.write(': ping\n\n')
    }, 15_000)
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      if (!response.writableEnded) response.end()
    }
    request.on('close', close)
    request.on('error', close)
    response.on('close', close)
    const sendEvent = (event: string, value: unknown): void => {
      if (closed || response.writableEnded) return
      response.write(`event: ${event}\ndata: ${JSON.stringify({ ok: true, value })}\n\n`)
    }
    const unsubscribe = presentation.subscribe(projectId, presentationId, (change) => {
      if (afterVersion !== undefined && change.version <= afterVersion) return
      sendEvent('update', change)
    })
    response.on('close', unsubscribe)
    request.on('close', unsubscribe)
    const current = presentation.get(projectId, presentationId)
    if (current !== undefined) sendEvent('snapshot', { presentationId, version: current.version, updatedAt: current.updatedAt, updatedBy: current.updatedBy })
    return true
  }

  if (oneMatch !== null) {
    const projectId = decodeURIComponent(oneMatch[1] ?? '')
    const presentationId = decodeURIComponent(oneMatch[2] ?? '')
    if (method === 'GET') {
      const value = presentation.get(projectId, presentationId)
      if (value === undefined) {
        sendJson(response, 404, failure('NOT_FOUND', 'Presentation not found.'))
        return true
      }
      sendJson(response, 200, { ok: true, value })
      return true
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request, controller.signal) as { contract?: PresentationViewV0; expectedVersion?: number; origin?: unknown }
      const contract = body?.contract
      if (contract === undefined || typeof contract !== 'object' || contract.id !== presentationId) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'PUT requires a contract whose id matches the route.'))
        return true
      }
      const expectedVersion = body.expectedVersion
      if (!Number.isInteger(expectedVersion) || (expectedVersion ?? -1) < 0) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'expectedVersion must be a non-negative integer.'))
        return true
      }
      if (body.origin !== undefined && parseProjectEventOrigin(body.origin) === undefined) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'origin must contain clientId, sessionId, clientSeq and operationId.'))
        return true
      }
      try {
        const origin = parseProjectEventOrigin(body.origin)
        // F6 B6 diff-gate：membership 变化 → semantic ChangeSet（placement-only 保存不记账）。
        const before = presentation.get(projectId, presentationId)
        const persist = () => presentation.save(projectId, {
          presentationId: contract.id,
          scopeId: contract.scopeId,
          capability: contract.capability,
          renderer: contract.renderer,
          state: contract.state,
          expectedVersion: Number(expectedVersion),
          updatedBy: contract.updatedBy ?? 'web',
          ...(origin === undefined ? {} : { origin }),
        })
        const value = origin === undefined
          ? persist()
          : projectMutations.commit({ projectId, origin, persist: () => { const response = persist(); return { response, resultingVersion: response.version } } }).response
        recordMembershipChangeSet({ projectId, presentationId, before, saved: value, mutationSafety, origin })
        sendJson(response, 200, { ok: true, value })
      } catch (error: unknown) {
        if (error instanceof PresentationConflictError) {
          sendJson(response, 409, failure('STALE_PRESENTATION_VERSION', error.message))
          return true
        }
        sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Presentation save failed.'))
      }
      return true
    }
    if (method === 'DELETE') {
      presentation.delete(projectId, presentationId)
      sendJson(response, 200, { ok: true, value: null })
      return true
    }
  }
  return false
}

/**
 * F6 B6（P1-B census）：presentationSave 的 membership diff-gate。
 * memberViewIds / memberEntityRefs 任一变化 → 记一条 presentation_state ChangeSet
 * （inverse = before 全量快照；forward = after 快照）；纯 placement / hierarchy /
 * emphasis 变化不产生 semantic ChangeSet（补充冻结 §7）。save 已 CAS 提交后记账
 * （与 curation createText 的 record() 模式一致，非复合事务——census 如实标注）。
 */
function recordMembershipChangeSet(input: {
  readonly projectId: string
  readonly presentationId: string
  readonly before: PresentationViewV0 | undefined
  readonly saved: PresentationViewV0
  readonly mutationSafety: import('../mutation-safety-service.js').MutationSafetyService | undefined
  readonly origin: ReturnType<typeof parseProjectEventOrigin>
}): void {
  const { projectId, presentationId, before, saved, mutationSafety, origin } = input
  if (mutationSafety === undefined) return
  const beforeMembers = before?.state.memberViewIds ?? []
  const afterMembers = saved.state.memberViewIds
  const beforeEntities = before?.state.memberEntityRefs ?? []
  const afterEntities = saved.state.memberEntityRefs ?? []
  const membersChanged = beforeMembers.length !== afterMembers.length || beforeMembers.some((id, index) => id !== afterMembers[index])
  const entitiesChanged = beforeEntities.length !== afterEntities.length
    || beforeEntities.some((ref, index) => ref.type !== afterEntities[index]?.type || ref.id !== afterEntities[index]?.id)
  if (!membersChanged && !entitiesChanged) return
  const baselineState: PresentationViewV0['state'] = before?.state ?? {
    memberViewIds: [], hiddenViewIds: [], positions: {},
    hierarchy: { parentByViewId: {}, orderByParent: {} },
    presentationEdges: [], pinnedViewIds: [], emphasisByViewId: {},
  }
  const touchedKeys = [...(membersChanged ? ['memberViewIds' as const] : []), ...(entitiesChanged ? ['memberEntityRefs' as const] : [])]
  mutationSafety.record({
    projectId,
    operationId: origin?.operationId ?? `presentation-membership-${saved.updatedAt}-${saved.version}`,
    actorKind: 'web',
    changes: [{
      type: 'presentation_state',
      presentationId,
      beforeVersion: before?.version ?? 0,
      afterVersion: saved.version,
      inverse: { type: 'restore_presentation_state', presentationId, targetVersion: before?.version ?? 0, stateSnapshot: baselineState },
      forward: { type: 'restore_presentation_state', presentationId, stateSnapshot: saved.state },
      touchedKeys,
      appliedFingerprint: `presentation:${saved.version}`,
    }],
    ...(origin === undefined ? {} : { origin }),
  })
}