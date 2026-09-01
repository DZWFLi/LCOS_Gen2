import { createHash } from 'node:crypto'
import type { CanvasObservationV1 } from '@local-creative-os/contracts'
import type { ProjectId } from '@local-creative-os/domain'
import { ActiveContextConflictError, type ActiveContextInput, type ActiveContextStore } from '../active-context-store.js'
import type { ContextProposalStore } from '../context-proposal-store.js'
import type { RuntimeApplicationService } from '../runtime-application-service.js'
import type { ProjectMutationCoordinator } from '../project-events/project-mutation-coordinator.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'

export interface CanvasRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly activeContext: ActiveContextStore
  readonly contextProposals: ContextProposalStore
  readonly runtimeApplication: RuntimeApplicationService | undefined
  readonly runEventListeners: Map<string, Set<() => void>>
  readonly projectMutations: ProjectMutationCoordinator
}

function escapeSvgText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function renderCanvasObservationSvg(snapshot: ReturnType<ActiveContextStore['get']>, width: number, height: number): string {
  const nodes = snapshot.nodes ?? []
  const byArtifact = new Map(nodes.map((node) => [node.artifactId, node]))
  const viewport = snapshot.viewport
  const zoom = viewport?.zoom ?? 1
  const cameraX = viewport?.x ?? 0
  const cameraY = viewport?.y ?? 0
  const screen = (x: number, y: number) => ({ x: x * zoom + cameraX, y: y * zoom + cameraY })
  const edgeSvg = (snapshot.relations ?? []).flatMap((relation) => {
    const source = byArtifact.get(relation.sourceArtifactId)
    const target = byArtifact.get(relation.targetArtifactId)
    if (source === undefined || target === undefined) return []
    const from = screen(source.x + source.width / 2, source.y + source.height / 2)
    const to = screen(target.x + target.width / 2, target.y + target.height / 2)
    return [`<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="#aeb6c2" stroke-width="1.5"/><text x="${((from.x + to.x) / 2).toFixed(1)}" y="${(((from.y + to.y) / 2) - 4).toFixed(1)}" fill="#7d8793" font-size="10" text-anchor="middle">${escapeSvgText(relation.kind)}</text>`]
  }).join('')
  const selected = new Set(snapshot.selectedViewIds)
  const pinned = new Set(snapshot.pinnedContextIds)
  const nodeSvg = nodes.map((node) => {
    const point = screen(node.x, node.y)
    const nodeWidth = Math.max(80, node.width * zoom)
    const nodeHeight = Math.max(44, node.height * zoom)
    const border = selected.has(node.viewId) ? '#7055c7' : pinned.has(node.viewId) ? '#3b82b7' : '#aab3bf'
    const fill = selected.has(node.viewId) ? '#f2efff' : '#ffffff'
    return `<g data-view-id="${escapeSvgText(node.viewId)}"><rect x="${point.x.toFixed(1)}" y="${point.y.toFixed(1)}" width="${nodeWidth.toFixed(1)}" height="${nodeHeight.toFixed(1)}" rx="10" fill="${fill}" stroke="${border}" stroke-width="${selected.has(node.viewId) ? 2.5 : 1.2}"/><text x="${(point.x + 10).toFixed(1)}" y="${(point.y + 20).toFixed(1)}" fill="#1e2b38" font-size="12" font-family="Segoe UI, sans-serif">${escapeSvgText(node.title.slice(0, 48))}</text><text x="${(point.x + 10).toFixed(1)}" y="${(point.y + 37).toFixed(1)}" fill="#6f7a86" font-size="10" font-family="Segoe UI, sans-serif">${escapeSvgText(`${node.kind}${node.status ? ` · ${node.status}` : ''}`)}</text></g>`
  }).join('')
  const clusterSvg = (snapshot.offscreenClusters ?? []).slice(0, 8).map((cluster, index) => `<g><rect x="${width - 220}" y="${20 + index * 30}" width="200" height="22" rx="11" fill="#f3f5f7"/><text x="${width - 210}" y="${35 + index * 30}" fill="#65717d" font-size="10" font-family="Segoe UI, sans-serif">视口外 ${escapeSvgText(cluster.kind)} · ${cluster.count}</text></g>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f7f8f6"/><text x="18" y="24" fill="#52606d" font-size="11" font-family="Segoe UI, sans-serif">LCOS Canvas Observation · v${snapshot.version} · structured truth remains authoritative</text>${edgeSvg}${nodeSvg}${clusterSvg}</svg>`
}

/**
 * /projects/:id/canvas-observation、/active-context（SSE/短轮询/更新）。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleCanvasRoute(ctx: CanvasRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, url, activeContext, contextProposals, runtimeApplication, runEventListeners, projectMutations } = ctx
  const { sendJson, failure, readJsonBody, isRecord, isStringArray } = ctx.helpers

  const canvasObservationMatch = /^\/projects\/([^/]+)\/canvas-observation$/.exec(pathname)
  if (method === 'GET' && canvasObservationMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(canvasObservationMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const graph = metadata.get(projectId)
    if (graph === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project graph not found.'))
      return true
    }
    const workspaceRaw = url.searchParams.get('workspaceId')
    const workspaceId = workspaceRaw === null || workspaceRaw === '' ? null : workspaceRaw
    const snapshot = activeContext.get(projectId, graph, workspaceId)
    const width = 1280
    const height = 720
    const svg = renderCanvasObservationSvg(snapshot, width, height)
    const contentHash = createHash('sha256').update(svg).digest('hex')
    const value: CanvasObservationV1 = {
      schemaVersion: 1,
      projectId,
      workspaceId,
      contextVersion: snapshot.version,
      screenshotRef: `lcos-canvas://${projectId}/${workspaceId ?? '__project_overview__'}/v${snapshot.version}/${contentHash.slice(0, 16)}`,
      contentHash,
      mimeType: 'image/svg+xml',
      encoding: 'base64',
      data: Buffer.from(svg, 'utf8').toString('base64'),
      width,
      height,
      generatedAt: new Date().toISOString(),
    }
    sendJson(response, 200, { ok: true, value })
    return true
  }

  const activeContextEventsMatch = /^\/projects\/([^/]+)\/active-context\/events$/.exec(pathname)
  if (method === 'GET' && activeContextEventsMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(activeContextEventsMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const graph = metadata.get(projectId)
    if (graph === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project graph not found.'))
      return true
    }
    const workspaceRaw = url.searchParams.get('workspaceId')
    const workspaceId = workspaceRaw === null || workspaceRaw === '' ? null : workspaceRaw
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
    const unsubscribes: Array<() => void> = []
    unsubscribes.push(activeContext.subscribe(projectId, workspaceId, (_projectId, _workspaceId, value) => {
      if (afterVersion !== undefined && value.version <= afterVersion) return
      sendEvent('update', value)
    }))
    unsubscribes.push(contextProposals.subscribe(projectId, () => {
      sendEvent('proposals', contextProposals.list(projectId, workspaceId))
    }))
    const runListener = (): void => {
      if (runtimeApplication === undefined) return
      sendEvent('runs', runtimeApplication.getProjectReviews(projectId as ProjectId, 100))
    }
    let runProjectListeners = runEventListeners.get(projectId)
    if (runProjectListeners === undefined) {
      runProjectListeners = new Set<() => void>()
      runEventListeners.set(projectId, runProjectListeners)
    }
    runProjectListeners.add(runListener)
    const cleanup = () => {
      for (const unsubscribe of unsubscribes) unsubscribe()
      const current = runEventListeners.get(projectId)
      if (current !== undefined) {
        current.delete(runListener)
        if (current.size === 0) runEventListeners.delete(projectId)
      }
    }
    response.on('close', cleanup)
    request.on('close', cleanup)

    sendEvent('snapshot', activeContext.get(projectId, graph, workspaceId))
    sendEvent('proposals', contextProposals.list(projectId, workspaceId))
    if (runtimeApplication !== undefined) {
      sendEvent('runs', runtimeApplication.getProjectReviews(projectId as ProjectId, 100))
    }
    return true
  }

  const activeContextMatch = /^\/projects\/([^/]+)\/active-context$/.exec(pathname)
  if ((method === 'GET' || method === 'PUT') && activeContextMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(activeContextMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const graph = metadata.get(projectId)
    if (graph === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project graph not found.'))
      return true
    }
    if (method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId')
      const normalizedWorkspaceId = workspaceId === null || workspaceId === '' ? null : workspaceId
      const afterRaw = url.searchParams.get('afterVersion')
      const afterVersion = afterRaw === null ? undefined : Number(afterRaw)
      if (afterRaw !== null && (!Number.isInteger(afterVersion) || (afterVersion ?? -1) < 0)) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'afterVersion must be a non-negative integer.'))
        return true
      }
      if (afterVersion !== undefined && activeContext.get(projectId, graph, normalizedWorkspaceId).version <= afterVersion) {
        // 短轮询：最多等待 1 秒再返回当前版本（watch_lcos_active_context）
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      sendJson(response, 200, { ok: true, value: activeContext.get(projectId, graph, normalizedWorkspaceId) })
      return true
    }
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Active Context body must be valid JSON.'))
      return true
    }
    if (!isRecord(input)
      || typeof input.scopeId !== 'string'
      || (input.workspaceId !== undefined && typeof input.workspaceId !== 'string')
      || !isStringArray(input.selectedViewIds)
      || !isStringArray(input.pinnedContextIds)
      || !isStringArray(input.excludedContextIds)
      || (input.lockedContextIds !== undefined && !isStringArray(input.lockedContextIds))
      || (input.currentSurface !== undefined && typeof input.currentSurface !== 'string')
      || (input.currentHarness !== undefined && typeof input.currentHarness !== 'string')
      || (input.explicitIntent !== undefined && input.explicitIntent !== null && (!isRecord(input.explicitIntent) || typeof input.explicitIntent.type !== 'string' || (input.explicitIntent.goal !== undefined && typeof input.explicitIntent.goal !== 'string')))
      || (input.dismissedContinuityKeys !== undefined && !isStringArray(input.dismissedContinuityKeys))
      || (input.targetArtifactId !== undefined && typeof input.targetArtifactId !== 'string')
      || (input.targetRevisionId !== undefined && typeof input.targetRevisionId !== 'string')
      || (input.visibleViewIds !== undefined && !isStringArray(input.visibleViewIds))
      || (input.viewport !== undefined && (!isRecord(input.viewport) || typeof input.viewport.x !== 'number' || typeof input.viewport.y !== 'number' || typeof input.viewport.zoom !== 'number'))
      || (input.expectedVersion !== undefined && typeof input.expectedVersion !== 'number')
      || (input.updatedBy !== undefined && !['web', 'codex', 'core'].includes(String(input.updatedBy)))
      || (input.sessionId !== undefined && typeof input.sessionId !== 'string')
      || (input.origin !== undefined && parseProjectEventOrigin(input.origin) === undefined)
      || Object.keys(input).some((key) => !['workspaceId', 'scopeId', 'selectedViewIds', 'pinnedContextIds', 'excludedContextIds', 'lockedContextIds', 'currentSurface', 'currentHarness', 'explicitIntent', 'dismissedContinuityKeys', 'targetArtifactId', 'targetRevisionId', 'visibleViewIds', 'viewport', 'expectedVersion', 'updatedBy', 'sessionId', 'origin'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Active Context requires scopeId and string ID arrays.'))
      return true
    }
    try {
      const origin = parseProjectEventOrigin(input.origin)
      const persist = () => activeContext.update(projectId, graph, { ...(input as unknown as ActiveContextInput), ...(origin === undefined ? {} : { origin }) })
      const value = origin === undefined
        ? persist()
        : projectMutations.commit({ projectId, origin, persist: () => { const response = persist(); return { response, resultingVersion: response.version } } }).response
      sendJson(response, 200, {
        ok: true,
        value,
      })
    } catch (error: unknown) {
      if (error instanceof ActiveContextConflictError) {
        sendJson(response, 409, failure(error.code, error.message))
        return true
      }
      throw error
    }
    return true
  }

  return false
}
