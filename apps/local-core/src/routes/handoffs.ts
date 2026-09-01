import type { HandoffRecord, HandoffResumeMode, ProjectId } from '@local-creative-os/domain'

import { routeRequireMetadata, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface HandoffsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
}

const RESUME_MODES: readonly HandoffResumeMode[] = ['native-resume', 'standard-handoff', 'session-shadow']

/**
 * /projects/:id/handoffs —— B6 provider-neutral Handoff 记录。
 * GUI 不展示每条消息，而展示 Decision / Open Question / source Artifact / next action。
 */
export async function handleHandoffsRoute(ctx: HandoffsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, helpers } = ctx
  const listOrCreateMatch = /^\/projects\/([^/]+)\/handoffs$/.exec(pathname)
  if (listOrCreateMatch !== null && (method === 'GET' || method === 'POST')) {
    const metadata = routeRequireMetadata(ctx)
    if (metadata === undefined) return true
    const projectId = decodeURIComponent(listOrCreateMatch[1] ?? '') as ProjectId
    if (method === 'GET') {
      helpers.sendJson(response, 200, { ok: true, value: metadata.listHandoffs(projectId) })
      return true
    }
    try {
      const body = await helpers.readJsonBody(request, ctx.controller.signal) as {
        title?: unknown; resumeMode?: unknown; fromProvider?: unknown; toProvider?: unknown
        sessionSummaryId?: unknown; contextSnapshotId?: unknown
        decisions?: unknown; openQuestions?: unknown; nextActions?: unknown
        artifactRefs?: unknown; messageRefs?: unknown
      }
      if (typeof body?.title !== 'string' || body.title.trim() === '' || body.title.length > 160) {
        helpers.sendJson(response, 400, helpers.failure('INVALID_ARGUMENT', 'title is required (under 160 chars).'))
        return true
      }
      const resumeMode = body.resumeMode === undefined ? 'standard-handoff' : body.resumeMode
      if (typeof resumeMode !== 'string' || !RESUME_MODES.includes(resumeMode as HandoffResumeMode)) {
        helpers.sendJson(response, 400, helpers.failure('INVALID_ARGUMENT', `resumeMode must be one of ${RESUME_MODES.join('|')}.`))
        return true
      }
      const now = new Date().toISOString()
      const value: HandoffRecord = {
        id: `handoff-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        projectId,
        title: body.title.trim(),
        resumeMode: resumeMode as HandoffResumeMode,
        ...(typeof body.fromProvider === 'string' ? { fromProvider: body.fromProvider } : {}),
        ...(typeof body.toProvider === 'string' ? { toProvider: body.toProvider } : {}),
        ...(typeof body.sessionSummaryId === 'string' ? { sessionSummaryId: body.sessionSummaryId } : {}),
        ...(typeof body.contextSnapshotId === 'string' ? { contextSnapshotId: body.contextSnapshotId } : {}),
        decisions: Array.isArray(body.decisions) ? body.decisions.filter((item): item is string => typeof item === 'string') : [],
        openQuestions: Array.isArray(body.openQuestions) ? body.openQuestions.filter((item): item is string => typeof item === 'string') : [],
        nextActions: Array.isArray(body.nextActions) ? body.nextActions.filter((item): item is string => typeof item === 'string') : [],
        artifactRefs: Array.isArray(body.artifactRefs)
          ? body.artifactRefs.filter((item): item is HandoffRecord['artifactRefs'][number] =>
            typeof item === 'object' && item !== null && typeof (item as { artifactId?: unknown }).artifactId === 'string')
          : [],
        messageRefs: Array.isArray(body.messageRefs) ? body.messageRefs.filter((item): item is string => typeof item === 'string') : [],
        createdAt: now,
        updatedAt: now,
      }
      metadata.createHandoff(value)
      helpers.sendJson(response, 201, { ok: true, value })
    } catch (error: unknown) {
      helpers.sendJson(response, 400, helpers.failure('VALIDATION', error instanceof Error ? error.message : 'Create handoff failed.'))
    }
    return true
  }

  const deleteMatch = /^\/projects\/([^/]+)\/handoffs\/([^/]+)$/.exec(pathname)
  if (deleteMatch !== null && method === 'DELETE') {
    const metadata = routeRequireMetadata(ctx)
    if (metadata === undefined) return true
    const handoffId = decodeURIComponent(deleteMatch[2] ?? '')
    const deleted = metadata.deleteHandoff(handoffId)
    if (!deleted) {
      helpers.sendJson(response, 404, helpers.failure('NOT_FOUND', 'Handoff not found.'))
      return true
    }
    helpers.sendJson(response, 200, { ok: true, value: { deleted: true } })
    return true
  }

  return false
}
