/**
 * project events 路由（S6 Bridge 事件订阅，SSE）。
 *
 *   GET /projects/{id}/events[?afterSeq=N&runtimeId=X]
 *     → text/event-stream，订阅该 project 的 ProjectEventHub。
 *     → 事件帧：`event: project\ndata: {ok:true, value:ProjectEventEnvelope}`；
 *       心跳帧 `: ping` 每 15s。
 *     → afterSeq + runtimeId：断线重连时先走 hub.reconnect（replay/snapshot_required），
 *       与既有 polling snapshot（snapshot API）互为 fallback；polling 保留不删。
 *
 * 边界：本 endpoint 只做"进程内 hub → SSE 传输"暴露；Project Truth 仍归 authoritative
 * repositories（envelope 是 transport-only）。
 */

import type { ProjectEventHub } from '../project-events/project-event-hub.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'
import { routeRequireProject } from './route-context.js'

export interface EventsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly projectEvents?: ProjectEventHub
}

export async function handleEventsRoute(ctx: EventsRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, metadata, projectEvents } = ctx
  const eventsMatch = /^\/projects\/([^/]+)\/events$/.exec(pathname)
  if (eventsMatch === null) return false
  if (method !== 'GET') return false

  if (metadata === undefined) {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, error: { code: 'UNAVAILABLE', message: 'Metadata repository is not configured.' } }))
    return true
  }
  const projectId = decodeURIComponent(eventsMatch[1] ?? '')
  if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
  if (projectEvents === undefined) {
    response.writeHead(503, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, error: { code: 'UNAVAILABLE', message: 'Project event hub is not configured.' } }))
    return true
  }

  const afterRaw = url.searchParams.get('afterSeq')
  const afterSeq = afterRaw === null ? undefined : Number(afterRaw)
  if (afterRaw !== null && (!Number.isInteger(afterSeq) || (afterSeq ?? -1) < 0)) {
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'afterSeq must be a non-negative integer.' } }))
    return true
  }
  const runtimeId = url.searchParams.get('runtimeId') ?? undefined

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

  // 断线重连：先回放 / snapshot_required（与 polling fallback 互补）
  if (afterSeq !== undefined) {
    const reconnect = projectEvents.reconnect(projectId, afterSeq, runtimeId)
    if (reconnect.kind === 'snapshot_required') {
      sendEvent('snapshot_required', { runtimeId: reconnect.runtimeId, currentSeq: reconnect.currentSeq })
    } else {
      sendEvent('replay', { currentSeq: reconnect.currentSeq, events: reconnect.events })
    }
  } else {
    sendEvent('snapshot', { runtimeId: projectEvents.runtimeId, currentSeq: projectEvents.currentSeq(projectId) })
  }

  const unsubscribe = projectEvents.subscribe(projectId, (event) => {
    sendEvent('project', event)
  })
  response.on('close', unsubscribe)
  request.on('close', unsubscribe)
  return true
}