import type { ProjectId, RunId } from '@local-creative-os/domain'
import type { RuntimeApplicationService } from '../runtime-application-service.js'
import type { SessionLifecycleService } from '../session-lifecycle-service.js'
import type { planCodexDispatch } from '../codex-dispatch-service.js'
import { OcrError, type OcrService } from '../ocr-service.js'
import type { SemanticIndexService } from '../semantic-index-service.js'
import { routeRequireMetadata, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface RuntimeRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly runtimeApplication: RuntimeApplicationService | undefined
  readonly sessionLifecycle: SessionLifecycleService | undefined
  readonly planCodexDispatch: typeof planCodexDispatch
  readonly ocr?: OcrService
  /** F6 P0-A3（20260828）：OCR 结果落 evidence 表 + 触发 reindex 的通道。 */
  readonly semantic?: SemanticIndexService
}

/**
 * /runtime/providers、/runtime/codex-dispatch-plan、/runs/:id/finalize。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleRuntimeRoute(ctx: RuntimeRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, metadata, runtimeApplication, ocr, sessionLifecycle } = ctx
  const { sendJson, failure, readJsonBody, isRecord } = ctx.helpers

  // Phase 5 Live Session Binding：会话七态读面 + 恢复动作。
  const sessionLifecycleMatch = /^\/projects\/([^/]+)\/session-lifecycle$/.exec(pathname)
  if (method === 'GET' && sessionLifecycleMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (db.getProject(decodeURIComponent(sessionLifecycleMatch[1] ?? '')) === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
      return true
    }
    sendJson(response, 200, { ok: true, value: { states: db.listSessionLifecycleStates(decodeURIComponent(sessionLifecycleMatch[1] ?? '')) } })
    return true
  }
  const sessionRecoverMatch = /^\/projects\/([^/]+)\/session-lifecycle\/([^/]+)\/recover$/.exec(pathname)
  if (method === 'POST' && sessionRecoverMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(sessionRecoverMatch[1] ?? '')
    const provider = decodeURIComponent(sessionRecoverMatch[2] ?? '')
    if (db.getProject(projectId) === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
      return true
    }
    if (provider !== 'codex' && provider !== 'workbuddy') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Provider must be codex or workbuddy.'))
      return true
    }
    if (sessionLifecycle === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Session lifecycle service is not configured.'))
      return true
    }
    const state = sessionLifecycle.recover(projectId, provider, 'manual recover')
    sendJson(response, 200, { ok: true, value: { state } })
    return true
  }

  const runtimeProvidersMatch = /^\/runtime\/providers$/.exec(pathname)
  if (method === 'GET' && runtimeProvidersMatch !== null) {
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    try {
      sendJson(response, 200, { ok: true, value: await runtimeApplication.providers() })
    } catch (error: unknown) {
      sendJson(response, 503, failure('UNAVAILABLE', error instanceof Error ? error.message : 'Provider status unavailable.'))
    }
    return true
  }

  const ocrMatch = /^\/runtime\/ocr$/.exec(pathname)
  if (method === 'POST' && ocrMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (ocr === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'OCR engine is not configured.'))
      return true
    }
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || typeof input.artifactId !== 'string'
      || Object.keys(input).some((key) => key !== 'artifactId')) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'OCR requires artifactId.'))
      return true
    }
    const artifact = db.getArtifact(input.artifactId)
    if (artifact === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Artifact not found.'))
      return true
    }
    const revision = artifact.currentRevisionId === undefined
      ? undefined
      : db.getArtifactRevision(String(artifact.currentRevisionId))
    const fileRecord = revision === undefined ? undefined : db.getFileRecord(String(revision.fileRecordId))
    const imagePath = fileRecord?.observedPath ?? ''
    if (imagePath === '') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Artifact has no local image file to OCR.'))
      return true
    }
    try {
      const value = await ocr.recognize(imagePath)
      // F6 P0-A3：OCR 结果落 evidence 表（同 artifact 重跑 = 覆盖）+ 触发 reindex——
      // 图片正文从此进入 FTS/embedding 检索；没跑过 OCR 的图片正文诚实为空。
      try {
        db.saveOcrEvidence({
          projectId: String(artifact.projectId),
          artifactId: input.artifactId,
          text: value.text,
          engine: value.engine,
          durationMs: value.durationMs,
        })
        if (ctx.semantic !== undefined) await ctx.semantic.reindexArtifact(String(artifact.projectId), input.artifactId)
      } catch (error: unknown) {
        console.warn(`[ocr] evidence persist/reindex failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      if (error instanceof OcrError) {
        sendJson(response, error.code === 'NOT_IMAGE' ? 400 : 502, failure('UNAVAILABLE', error.message))
      } else {
        sendJson(response, 502, failure('UNAVAILABLE', error instanceof Error ? error.message : 'OCR failed.'))
      }
    }
    return true
  }

  const codexDispatchPlanMatch = /^\/runtime\/codex-dispatch-plan$/.exec(pathname)
  if (method === 'POST' && codexDispatchPlanMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || typeof input.projectId !== 'string'
      || (input.sessions !== undefined && !Array.isArray(input.sessions))
      || Object.keys(input).some((key) => !['projectId', 'sessions'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Dispatch plan requires projectId and optional sessions array.'))
      return true
    }
    const project = db.getProject(input.projectId)
    if (project === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
      return true
    }
    const suppliedSessions = (input.sessions as unknown[] | undefined ?? []).flatMap((item) => {
      if (!isRecord(item) || typeof item.sessionId !== 'string') return []
      return [{
        sessionId: item.sessionId,
        ...(item.guiActive === true ? { guiActive: true } : {}),
        ...(item.busy === true ? { busy: true } : {}),
      }]
    })
    const preferredBinding = db.getProviderSessionBinding(input.projectId, 'codex')
    const suppliedById = new Map(suppliedSessions.map((session) => [session.sessionId, session]))
    const preferredSession = preferredBinding?.status === 'active'
      ? { sessionId: preferredBinding.externalSessionId, ...(suppliedById.get(preferredBinding.externalSessionId) ?? {}) }
      : undefined
    const sessions = [
      ...(preferredSession === undefined ? [] : [preferredSession]),
      ...suppliedSessions.filter((session) => session.sessionId !== preferredSession?.sessionId),
    ]
    const reviews = runtimeApplication.getProjectReviews(input.projectId as ProjectId, 100)
    const taskStates = new Map<string, { readonly status?: string; readonly leaseExpiresAt?: string }>()
    for (const review of reviews) {
      if (review.run.provider !== 'codex') continue
      try {
        const state = await runtimeApplication.getCodexTaskState(review.run.id)
        if (state !== undefined) taskStates.set(String(review.run.id), state)
      } catch {
        // 拿不到 Bridge 状态就不派这一条，避免盲派
      }
    }
    sendJson(response, 200, {
      ok: true,
      value: ctx.planCodexDispatch(
        reviews,
        project.rootPath,
        sessions,
        taskStates,
      ),
    })
    return true
  }

  const finalizeRunMatch = /^\/runs\/([^/]+)\/finalize$/.exec(pathname)
  if (method === 'POST' && finalizeRunMatch !== null) {
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    const runId = decodeURIComponent(finalizeRunMatch[1] ?? '') as RunId
    try {
      const input = await readJsonBody(request, controller.signal)
      if (!isRecord(input)
        || !['completed', 'retrying'].includes(String(input.decision))
        || (input.comment !== undefined && typeof input.comment !== 'string')
        || Object.keys(input).some((key) => !['decision', 'comment'].includes(key))) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Finalize requires completed or retrying decision.'))
        return true
      }
      sendJson(response, 200, {
        ok: true,
        value: await runtimeApplication.finalize(
          runId,
          input.decision as 'completed' | 'retrying',
          typeof input.comment === 'string' ? input.comment : undefined,
        ),
      })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Runtime finalize conflicted.'))
    }
    return true
  }

  return false
}
