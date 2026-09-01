import type { ProjectEventEnvelope, ProjectEventOrigin, ProjectEventSnapshotV1 } from '@local-creative-os/contracts'

import type { ActiveContextStore } from '../active-context-store.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import type { PresentationApplicationService } from '../presentation-application-service.js'
import type { ProjectEventHub } from '../project-events/project-event-hub.js'
import type { ProjectMutationCoordinator } from '../project-events/project-mutation-coordinator.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'

export interface ProjectEventsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly metadata: SqliteMetadataRepository | undefined
  readonly presentation: PresentationApplicationService | undefined
  readonly activeContext: ActiveContextStore
  readonly projectEvents: ProjectEventHub
  readonly projectMutations: ProjectMutationCoordinator
}

export function parseProjectEventOrigin(value: unknown): ProjectEventOrigin | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  if (typeof input.clientId !== 'string' || typeof input.sessionId !== 'string' || !Number.isInteger(input.clientSeq) || Number(input.clientSeq) < 1 || typeof input.operationId !== 'string') return undefined
  if (input.sourceSurface !== undefined && typeof input.sourceSurface !== 'string') return undefined
  return { clientId: input.clientId, sessionId: input.sessionId, clientSeq: Number(input.clientSeq), operationId: input.operationId, ...(input.sourceSurface === undefined ? {} : { sourceSurface: input.sourceSurface }) }
}

export async function handleProjectEventsRoute(ctx: ProjectEventsRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, metadata, presentation, activeContext, projectEvents, projectMutations } = ctx
  const receiptMatch = /^\/projects\/([^/]+)\/mutations\/([^/]+)$/.exec(pathname)
  if (receiptMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(receiptMatch[1] ?? '')
    const operationId = decodeURIComponent(receiptMatch[2] ?? '')
    const expectedRuntimeId = url.searchParams.get('runtimeId')
    if (expectedRuntimeId !== null && expectedRuntimeId !== projectEvents.runtimeId) {
      ctx.helpers.sendJson(response, 409, ctx.helpers.failure('CONFLICT', 'Local Core runtime changed; authoritative snapshot is required.'))
      return true
    }
    const receipt = projectMutations.lookup(projectId, operationId)
    if (receipt === undefined) ctx.helpers.sendJson(response, 404, ctx.helpers.failure('NOT_FOUND', 'Mutation receipt not found in the current runtime.'))
    else ctx.helpers.sendJson(response, 200, { ok: true, value: receipt })
    return true
  }
  const match = /^\/projects\/([^/]+)\/events$/.exec(pathname)
  if (match === null || method !== 'GET') return false
  const projectId = decodeURIComponent(match[1] ?? '')
  const graph = metadata?.get(projectId)
  if (graph === undefined || presentation === undefined) {
    ctx.helpers.sendJson(response, 404, ctx.helpers.failure('NOT_FOUND', 'Project not found.'))
    return true
  }

  const lastSeenRaw = url.searchParams.get('lastSeenProjectSeq')
  const lastSeen = lastSeenRaw === null ? undefined : Number(lastSeenRaw)
  if (lastSeenRaw !== null && (!Number.isInteger(lastSeen) || (lastSeen ?? -1) < 0)) {
    ctx.helpers.sendJson(response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'lastSeenProjectSeq must be a non-negative integer.'))
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
  const send = (event: string, value: unknown, id?: number): void => {
    if (closed || response.writableEnded) return
    response.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify({ ok: true, value })}\n\n`)
  }
  const unsubscribe = projectEvents.subscribe(projectId, (event: ProjectEventEnvelope) => send('project-event', event, event.projectSeq))
  const heartbeat = setInterval(() => {
    if (!closed && !response.writableEnded) response.write(`: ping ${Date.now()}\n\n`)
  }, 15_000)
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

  const reconnect = lastSeen === undefined
    ? { kind: 'snapshot_required' as const, runtimeId: projectEvents.runtimeId, currentSeq: projectEvents.currentSeq(projectId) }
    : projectEvents.reconnect(projectId, lastSeen, url.searchParams.get('runtimeId') ?? undefined)
  if (reconnect.kind === 'replay') {
    send('replay', reconnect)
  } else {
    const workspaceIds: Array<string | null> = [null, ...graph.workspaces.map((workspace) => String(workspace.id))]
    const snapshot: ProjectEventSnapshotV1 = {
      runtimeId: projectEvents.runtimeId,
      projectId,
      currentSeq: reconnect.currentSeq,
      presentations: presentation.list(projectId).map(({ id: presentationId, version, updatedAt, updatedBy }) => ({ presentationId, version, updatedAt, updatedBy })),
      workStates: workspaceIds.map((workspaceId) => {
        const value = activeContext.get(projectId, graph, workspaceId)
        return { workspaceId, version: value.version }
      }),
    }
    send('snapshot', snapshot)
  }
  return true
}

export function handleRealtimeDebugRoute(ctx: ProjectEventsRouteContext): boolean {
  if (ctx.method !== 'GET' || ctx.pathname !== '/debug/realtime') return false
  ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: { runtimeId: ctx.projectEvents.runtimeId, projects: ctx.projectEvents.debugSnapshot() } })
  return true
}
