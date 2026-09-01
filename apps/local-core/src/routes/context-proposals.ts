import type { ActiveContextStore } from '../active-context-store.js'
import type { ContextProposalStore } from '../context-proposal-store.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface ContextProposalsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly activeContext: ActiveContextStore
  readonly contextProposals: ContextProposalStore
}

/**
 * /projects/:id/context-proposals* —— 提案列表、创建、接受/拒绝。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleContextProposalsRoute(ctx: ContextProposalsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, url, activeContext, contextProposals } = ctx
  const { sendJson, failure, readJsonBody, isRecord, isStringArray } = ctx.helpers

  const contextProposalListMatch = /^\/projects\/([^/]+)\/context-proposals$/.exec(pathname)
  if (contextProposalListMatch !== null && (method === 'GET' || method === 'POST')) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(contextProposalListMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const graph = metadata.get(projectId)
    if (graph === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project graph not found.'))
      return true
    }
    if (method === 'GET') {
      sendJson(response, 200, { ok: true, value: contextProposals.list(projectId, url.searchParams.has('workspaceId') ? url.searchParams.get('workspaceId') : undefined) })
      return true
    }
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || typeof input.baseContextVersion !== 'number'
      || !isStringArray(input.addViewIds) || !isStringArray(input.removeViewIds)
      || typeof input.reason !== 'string'
      || (input.workspaceId !== undefined && typeof input.workspaceId !== 'string')
      || (input.targetViewId !== undefined && typeof input.targetViewId !== 'string')
      || Object.keys(input).some((key) => !['workspaceId', 'baseContextVersion', 'addViewIds', 'removeViewIds', 'targetViewId', 'reason'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Proposal requires baseContextVersion, addViewIds, removeViewIds and reason.'))
      return true
    }
    try {
      const proposalWorkspaceId = typeof input.workspaceId === 'string' ? input.workspaceId : null
      const current = activeContext.get(projectId, graph, proposalWorkspaceId)
      const proposal = contextProposals.create(projectId, {
        ...(proposalWorkspaceId === null ? {} : { workspaceId: proposalWorkspaceId }),
        baseContextVersion: input.baseContextVersion,
        addViewIds: input.addViewIds,
        removeViewIds: input.removeViewIds,
        ...(typeof input.targetViewId === 'string' ? { targetViewId: input.targetViewId } : {}),
        reason: input.reason,
      }, current)
      sendJson(response, 201, { ok: true, value: proposal })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Proposal creation failed.'))
    }
    return true
  }

  const contextProposalActionMatch = /^\/projects\/([^/]+)\/context-proposals\/([^/]+)\/(accept|reject)$/.exec(pathname)
  if (method === 'POST' && contextProposalActionMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(contextProposalActionMatch[1] ?? '')
    const proposalId = decodeURIComponent(contextProposalActionMatch[2] ?? '')
    const action = contextProposalActionMatch[3]
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const graph = metadata.get(projectId)
    if (graph === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project graph not found.'))
      return true
    }
    try {
      if (action === 'reject') {
        sendJson(response, 200, { ok: true, value: contextProposals.reject(projectId, proposalId) })
        return true
      }
      const proposal = contextProposals.get(projectId, proposalId)
      if (proposal === undefined) throw new Error('PROPOSAL_NOT_FOUND')
      const current = activeContext.get(projectId, graph, proposal.workspaceId)
      if (current.version !== proposal.baseContextVersion) {
        sendJson(response, 409, {
          ok: false,
          error: {
            code: 'CONTEXT_STALE',
            message: `Proposal base version ${proposal.baseContextVersion} is stale; current ${current.version}.`,
            retryable: false,
            origin: 'runtime',
          },
        })
        contextProposals.markStale(projectId, proposalId)
        return true
      }
      const viewsById = new Map(graph.artifactViews.map((view) => [String(view.id), view]))
      const removed = new Set(proposal.removeViewIds)
      const pinned = [...new Set([
        ...current.pinnedContextIds.filter((viewId) => !removed.has(viewId)),
        ...proposal.addViewIds,
      ])]
      const targetView = proposal.targetViewId === undefined ? undefined : viewsById.get(proposal.targetViewId)
      const targetArtifactId = targetView === undefined
        ? (current.targetArtifactId ?? undefined)
        : String(targetView.artifactId)
      const targetRevisionId = targetView?.revisionId === undefined
        ? (current.targetRevisionId ?? undefined)
        : String(targetView.revisionId)
      const updated = activeContext.update(projectId, graph, {
        ...(proposal.workspaceId === null ? {} : { workspaceId: proposal.workspaceId }),
        scopeId: current.scopeId ?? '',
        selectedViewIds: current.selectedViewIds,
        pinnedContextIds: pinned,
        excludedContextIds: current.excludedContextIds,
        ...(current.viewport === undefined ? {} : { viewport: { x: current.viewport.x, y: current.viewport.y, zoom: current.viewport.zoom }, visibleViewIds: current.viewport.visibleViewIds }),
        ...(targetArtifactId === undefined ? {} : { targetArtifactId }),
        ...(targetRevisionId === undefined ? {} : { targetRevisionId }),
        expectedVersion: current.version,
        updatedBy: 'codex',
      })
      contextProposals.accept(projectId, proposalId)
      sendJson(response, 200, { ok: true, value: { proposal: contextProposals.get(projectId, proposalId), activeContext: updated } })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Proposal action failed.'))
    }
    return true
  }

  return false
}
