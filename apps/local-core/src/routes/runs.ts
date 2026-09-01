import type {
  AgentExecutionPlanV1,
  BuildContextManifestV0Input,
  CreateRunProposal,
} from '@local-creative-os/contracts'
import type { ArtifactRevisionId, ProjectId, RunId } from '@local-creative-os/domain'
import type { ContextManifestService } from '../context-manifest-service.js'
import type { RuntimeReviewService } from '../runtime-review-service.js'
import { buildHandoffZip } from '../handoff-zip-service.js'
import { proposeRun, validateAgentExecutionPlan } from '../runtime-proposal-service.js'
import { createTextArtifact } from '../text-artifact-service.js'
import type { PreviewWorkerService } from '../preview-worker-service.js'
import type { CreateRuntimeRunInput, RuntimeApplicationService } from '../runtime-application-service.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface RunsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly runtimeReview: RuntimeReviewService | undefined
  readonly runtimeApplication: RuntimeApplicationService | undefined
  readonly contextManifest: ContextManifestService | undefined
  readonly previewWorker: PreviewWorkerService | undefined
}

/**
 * context-manifests、/runs/* review/action/cancel/input-request/events、
 * runs create、validate-plan、propose、text-artifacts。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleRunsRoute(ctx: RunsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, url, runtimeReview, runtimeApplication, contextManifest, previewWorker } = ctx
  const { sendJson, failure, readJsonBody, isRecord, isStringArray } = ctx.helpers

  // Handoff 文件级 zip：manifest（renderedMarkdown + 校验 JSON）+ 引用文件副本。
  const handoffZipMatch = /^\/projects\/([^/]+)\/handoff-zip$/.exec(pathname)
  if (method === 'GET' && handoffZipMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    if (contextManifest === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Context Manifest service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(handoffZipMatch[1] ?? '') as ProjectId
    const project = routeRequireProject(String(projectId), { metadata, response, helpers: ctx.helpers })
    if (project === undefined) return true
    const targetArtifactId = url.searchParams.get('targetArtifactId') ?? undefined
    const requestedOutput = url.searchParams.get('requestedOutput') ?? undefined
    if ((targetArtifactId !== undefined && targetArtifactId.length === 0)
      || (requestedOutput !== undefined && (requestedOutput.length === 0 || requestedOutput.length > 2_000))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Handoff zip accepts optional targetArtifactId and requestedOutput.'))
      return true
    }
    try {
      const manifest = await contextManifest.build(projectId, {
        ...(targetArtifactId === undefined ? {} : { targetArtifactId }),
        ...(requestedOutput === undefined ? {} : { requestedOutput }),
      } as BuildContextManifestV0Input)
      const zip = await buildHandoffZip(metadata, String(project.rootPath), manifest)
      const safeName = `${project.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'}-handoff-${manifest.id}.zip`
      ctx.helpers.sendBinary(response, 200, Buffer.from(zip), safeName, 'application/zip')
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Handoff zip could not be built.'))
    }
    return true
  }

  const manifestMatch = /^\/projects\/([^/]+)\/context-manifests\/v0$/.exec(pathname)
  if (method === 'POST' && manifestMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    if (contextManifest === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Context Manifest service is not configured.'))
      return true
    }
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Context Manifest body must be valid JSON.'))
      return true
    }
    if (!isRecord(input)
      || Object.keys(input).some((key) => !['targetArtifactId', 'contextArtifactIds', 'requestedOutput'].includes(key))
      || (input.targetArtifactId !== undefined && typeof input.targetArtifactId !== 'string')
      || (input.contextArtifactIds !== undefined && !isStringArray(input.contextArtifactIds))
      || (input.requestedOutput !== undefined && (typeof input.requestedOutput !== 'string' || input.requestedOutput.length > 2_000))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Context Manifest accepts optional targetArtifactId, contextArtifactIds and requestedOutput.'))
      return true
    }
    const projectId = decodeURIComponent(manifestMatch[1] ?? '')
    try {
      const manifest = await contextManifest.build(projectId as ProjectId, input as BuildContextManifestV0Input)
      sendJson(response, 200, { ok: true, value: manifest })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Context Manifest could not be built.'))
    }
    return true
  }

  const runReviewMatch = /^\/runs\/([^/]+)\/review$/.exec(pathname)
  if (method === 'GET' && runReviewMatch !== null) {
    if (runtimeReview === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime Review service is not configured.'))
      return true
    }
    try {
      sendJson(response, 200, {
        ok: true,
        value: runtimeReview.getRunReview(decodeURIComponent(runReviewMatch[1] ?? '') as RunId),
      })
    } catch (error: unknown) {
      sendJson(response, 404, failure('NOT_FOUND', error instanceof Error ? error.message : 'Run review not found.'))
    }
    return true
  }

  const runContextPromptMatch = /^\/runs\/([^/]+)\/context-prompt$/.exec(pathname)
  if (method === 'GET' && runContextPromptMatch !== null) {
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    try {
      sendJson(response, 200, {
        ok: true,
        value: runtimeApplication.contextPrompt(decodeURIComponent(runContextPromptMatch[1] ?? '') as RunId),
      })
    } catch (error: unknown) {
      sendJson(response, 404, failure('NOT_FOUND', error instanceof Error ? error.message : 'Run Context prompt not found.'))
    }
    return true
  }

  const createRunMatch = /^\/projects\/([^/]+)\/runs$/.exec(pathname)
  if (method === 'GET' && createRunMatch !== null) {
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(createRunMatch[1] ?? '') as ProjectId
    const metadata = routeRequireMetadata(ctx)
    if (metadata === undefined || routeRequireProject(String(projectId), { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const requestedLimit = Number(url.searchParams.get('limit') ?? 20)
    const limit = Number.isInteger(requestedLimit) ? requestedLimit : 20
    sendJson(response, 200, { ok: true, value: runtimeApplication.getProjectReviews(projectId, limit) })
    return true
  }
  if (method === 'POST' && createRunMatch !== null) {
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(createRunMatch[1] ?? '') as ProjectId
    const metadata = routeRequireMetadata(ctx)
    if (metadata === undefined || routeRequireProject(String(projectId), { metadata, response, helpers: ctx.helpers }) === undefined) return true
    try {
      const input = await readJsonBody(request, controller.signal)
      if (!isRecord(input)
        || typeof input.instruction !== 'string'
        || typeof input.outputIntent !== 'string'
        || !['create', 'revise', 'analyze'].includes(input.outputIntent)
        || (input.targetArtifactId !== undefined && typeof input.targetArtifactId !== 'string')
        || (input.targetRevisionId !== undefined && typeof input.targetRevisionId !== 'string')
        || (input.contextArtifactIds !== undefined && !isStringArray(input.contextArtifactIds))
        || (input.workspaceId !== undefined && typeof input.workspaceId !== 'string')
        || (input.savedContextId !== undefined && typeof input.savedContextId !== 'string')
        || (input.requestedProvider !== undefined && !['workbuddy', 'codex', 'auto'].includes(String(input.requestedProvider)))
        || (input.sessionId !== undefined && typeof input.sessionId !== 'string')
        || (input.resultPolicy !== undefined && (!isRecord(input.resultPolicy) || typeof input.resultPolicy.type !== 'string'))
        || (input.receiverRef !== undefined && (!isRecord(input.receiverRef) || typeof input.receiverRef.connectedConversationId !== 'string'))
        || (input.orderedReferences !== undefined && !Array.isArray(input.orderedReferences))
        || (input.resultSlotId !== undefined && typeof input.resultSlotId !== 'string')
        || Object.keys(input).some((key) => !['instruction', 'targetArtifactId', 'targetRevisionId', 'contextArtifactIds', 'savedContextId', 'workspaceId', 'outputIntent', 'requestedProvider', 'resultPolicy', 'sessionId', 'receiverRef', 'orderedReferences', 'resultSlotId'].includes(key))) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Run requires instruction and outputIntent (create|revise|analyze); revise also requires an explicit target.'))
        return true
      }
      sendJson(response, 201, {
        ok: true,
        value: await runtimeApplication.create(projectId, {
          ...(input as unknown as CreateRuntimeRunInput),
          // F6 P0-D2：orderedReferences 元素形状校验（ref.type × 必填 id 字段）。
          ...(Array.isArray(input.orderedReferences) ? { orderedReferences: input.orderedReferences.flatMap((item) => {
            if (!isRecord(item) || !isRecord(item.ref)) return []
            const ref = item.ref as Record<string, unknown>
            const type = String(ref.type)
            const idField = type === 'artifact' ? 'artifactId' : type === 'view' ? 'viewId' : type === 'scope' ? 'scopeId' : type === 'workspace' ? 'workspaceId' : type === 'conversation' ? 'conversationSessionId' : type === 'component' ? 'componentId' : ''
            if (idField === '' || typeof ref[idField] !== 'string') return []
            return [item as never]
          }) } : {}),
        }),
      })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Run could not be created.'))
    }
    return true
  }

  const runtimeActionMatch = /^\/runs\/([^/]+)\/(dispatch|recover|sync)$/.exec(pathname)
  if (method === 'POST' && runtimeActionMatch !== null) {
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    const runId = decodeURIComponent(runtimeActionMatch[1] ?? '') as RunId
    const action = runtimeActionMatch[2]
    try {
      const value = action === 'dispatch'
        ? await runtimeApplication.dispatch(runId)
        : action === 'recover'
          ? await runtimeApplication.recover(runId)
          : await runtimeApplication.sync(runId)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Runtime action conflicted.'))
    }
    return true
  }

  const cancelRunMatch = /^\/runs\/([^/]+)\/cancel$/.exec(pathname)
  if (method === 'POST' && cancelRunMatch !== null) {
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    const runId = decodeURIComponent(cancelRunMatch[1] ?? '') as RunId
    try {
      sendJson(response, 200, {
        ok: true,
        value: await runtimeApplication.cancel(runId),
      })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Run cancellation conflicted.'))
    }
    return true
  }

  const runInputRequestMatch = /^\/runs\/([^/]+)\/input-request$/.exec(pathname)
  if (method === 'GET' && runInputRequestMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const runId = decodeURIComponent(runInputRequestMatch[1] ?? '') as RunId
    const value = metadata.getPendingRunInputRequest(runId)
    if (value === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'This task is not waiting for more information.'))
      return true
    }
    sendJson(response, 200, { ok: true, value })
    return true
  }
  if (method === 'POST' && runInputRequestMatch !== null) {
    if (runtimeApplication === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Runtime execution service is not configured.'))
      return true
    }
    const runId = decodeURIComponent(runInputRequestMatch[1] ?? '') as RunId
    try {
      const input = await readJsonBody(request, controller.signal)
      if (!isRecord(input)
        || typeof input.requestId !== 'string'
        || (input.text !== undefined && typeof input.text !== 'string')
        || (input.selectedOptions !== undefined && !isStringArray(input.selectedOptions))
        || Object.keys(input).some((key) => !['requestId', 'text', 'selectedOptions'].includes(key))) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Answer requires requestId and free text or selected options.'))
        return true
      }
      sendJson(response, 200, {
        ok: true,
        value: await runtimeApplication.answerInput(runId, {
          requestId: input.requestId,
          ...(typeof input.text === 'string' ? { text: input.text } : {}),
          ...(isStringArray(input.selectedOptions) ? { selectedOptions: input.selectedOptions } : {}),
        }),
      })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Input response could not be applied.'))
    }
    return true
  }

  const runEventsMatch = /^\/runs\/([^/]+)\/events$/.exec(pathname)
  if (method === 'GET' && runEventsMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const runId = decodeURIComponent(runEventsMatch[1] ?? '') as RunId
    const afterRaw = url.searchParams.get('after')
    const afterSequence = afterRaw === null ? undefined : Number(afterRaw)
    if (afterRaw !== null && (!Number.isInteger(afterSequence) || (afterSequence ?? -1) < 0)) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'after must be a non-negative integer.'))
      return true
    }
    sendJson(response, 200, { ok: true, value: metadata.getRunEvents(runId, afterSequence) })
    return true
  }

  const manifestOneMatch = /^\/projects\/([^/]+)\/context-manifests\/v0\/([^/]+)$/.exec(pathname)
  if (method === 'GET' && manifestOneMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(manifestOneMatch[1] ?? '')
    const manifestId = decodeURIComponent(manifestOneMatch[2] ?? '')
    const manifest = metadata.getContextManifest(manifestId as never)
    if (manifest === undefined || String(manifest.projectId) !== projectId) {
      sendJson(response, 404, failure('NOT_FOUND', 'ContextManifest not found.'))
      return true
    }
    sendJson(response, 200, { ok: true, value: manifest })
    return true
  }

  const validateAgentPlanMatch = /^\/projects\/([^/]+)\/runs\/validate-plan$/.exec(pathname)
  if (method === 'POST' && validateAgentPlanMatch !== null) {
    const projectId = decodeURIComponent(validateAgentPlanMatch[1] ?? '')
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input)
      || input.schemaVersion !== 1
      || typeof input.prompt !== 'string'
      || !['analyze', 'create', 'revise'].includes(String(input.intent))
      || typeof input.requestedProvider !== 'string'
      || !Array.isArray(input.contextItems)
      || !Array.isArray(input.editTargets)
      || !isRecord(input.resultPolicy)
      || typeof input.humanSummary !== 'string'
      || !isStringArray(input.risks)
      || typeof input.requiresConfirmation !== 'boolean'
      || (input.receiverRef !== undefined && (!isRecord(input.receiverRef) || typeof input.receiverRef.connectedConversationId !== 'string'))
      || (input.orderedReferences !== undefined && !Array.isArray(input.orderedReferences))
      || (input.resultSlotId !== undefined && typeof input.resultSlotId !== 'string')
      || Object.keys(input).some((key) => !['schemaVersion', 'workspaceId', 'prompt', 'intent', 'requestedProvider', 'contextItems', 'editTargets', 'resultPolicy', 'humanSummary', 'risks', 'requiresConfirmation', 'receiverRef', 'orderedReferences', 'resultSlotId'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Agent Plan contract is invalid.'))
      return true
    }
    try {
      const value = validateAgentExecutionPlan({ ...input, projectId } as unknown as AgentExecutionPlanV1)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Agent Plan validation failed.'))
    }
    return true
  }

  const runProposeMatch = /^\/projects\/([^/]+)\/runs\/propose$/.exec(pathname)
  if (method === 'POST' && runProposeMatch !== null) {
    const projectId = decodeURIComponent(runProposeMatch[1] ?? '')
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input)
      || typeof input.prompt !== 'string'
      || typeof input.requestedProvider !== 'string'
      || !Array.isArray(input.contextItems)
      || !Array.isArray(input.editTargets)
      || (input.resultPolicy !== undefined && !isRecord(input.resultPolicy))
      || (input.createAsNewNode !== undefined && typeof input.createAsNewNode !== 'boolean')
      || (input.receiverRef !== undefined && (!isRecord(input.receiverRef) || typeof input.receiverRef.connectedConversationId !== 'string'))
      || (input.orderedReferences !== undefined && !Array.isArray(input.orderedReferences))
      || (input.resultSlotId !== undefined && typeof input.resultSlotId !== 'string')
      || Object.keys(input).some((key) => !['workspaceId', 'prompt', 'intent', 'requestedProvider', 'contextItems', 'editTargets', 'resultPolicy', 'createAsNewNode', 'decisionSource', 'receiverRef', 'orderedReferences', 'resultSlotId'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Run proposal requires prompt, requestedProvider, contextItems and editTargets.'))
      return true
    }
    try {
      sendJson(response, 200, {
        ok: true,
        value: proposeRun({
          projectId,
          ...(typeof input.workspaceId === 'string' ? { workspaceId: input.workspaceId } : {}),
          prompt: input.prompt,
          ...(typeof input.intent === 'string' ? { intent: input.intent as 'analyze' | 'create' | 'revise' } : {}),
          ...(typeof input.createAsNewNode === 'boolean' ? { createAsNewNode: input.createAsNewNode } : {}),
          ...(input.decisionSource === 'agent' ? { decisionSource: 'agent' as const } : {}),
          requestedProvider: input.requestedProvider,
          contextItems: input.contextItems as CreateRunProposal['contextItems'],
          editTargets: input.editTargets as CreateRunProposal['editTargets'],
          ...(isRecord(input.resultPolicy) ? { resultPolicy: input.resultPolicy as unknown as CreateRunProposal['resultPolicy'] } : {}),
          // F6 B6（P0-F）：Unified Execution Contract 原样保留——Proposal 不压回 artifact-only。
          ...(isRecord(input.receiverRef) && typeof input.receiverRef.connectedConversationId === 'string' ? { receiverRef: input.receiverRef as unknown as NonNullable<CreateRunProposal['receiverRef']> } : {}),
          ...(Array.isArray(input.orderedReferences) ? { orderedReferences: input.orderedReferences.flatMap((item) => {
            if (!isRecord(item) || !isRecord(item.ref)) return []
            const ref = item.ref as Record<string, unknown>
            const type = String(ref.type)
            const idField = type === 'artifact' ? 'artifactId' : type === 'view' ? 'viewId' : type === 'scope' ? 'scopeId' : type === 'workspace' ? 'workspaceId' : type === 'conversation' ? 'conversationSessionId' : type === 'component' ? 'componentId' : ''
            if (idField === '' || typeof ref[idField] !== 'string') return []
            return [item as never]
          }) } : {}),
          ...(typeof input.resultSlotId === 'string' ? { resultSlotId: input.resultSlotId } : {}),
        }),
      })
    } catch (error: unknown) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Run proposal failed.'))
    }
    return true
  }

  const textArtifactMatch = /^\/projects\/([^/]+)\/text-artifacts$/.exec(pathname)
  if (method === 'POST' && textArtifactMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(textArtifactMatch[1] ?? '') as ProjectId
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || typeof input.body !== 'string' || input.body.length > 200_000
      || typeof input.scopeId !== 'string'
      || (input.title !== undefined && typeof input.title !== 'string')
      || (input.workspaceId !== undefined && typeof input.workspaceId !== 'string')
      || (input.x !== undefined && typeof input.x !== 'number')
      || (input.y !== undefined && typeof input.y !== 'number')
      || Object.keys(input).some((key) => !['title', 'body', 'scopeId', 'workspaceId', 'x', 'y'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Text artifact requires a body string and scopeId.'))
      return true
    }
    try {
      const created = await createTextArtifact(metadata, projectId, {
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        body: input.body,
        scopeId: input.scopeId,
        ...(typeof input.workspaceId === 'string' ? { workspaceId: input.workspaceId } : {}),
        ...(typeof input.x === 'number' ? { x: input.x } : {}),
        ...(typeof input.y === 'number' ? { y: input.y } : {}),
      })
      // HU/白卡片修复：文本工件创建后同步触发 markdown/text 预览生成，前端不再显示“预览未生成”。
      if (previewWorker !== undefined) {
        try { await previewWorker.generate({ projectId, revisionId: created.revisionId as ArtifactRevisionId, previewProfile: 'thumbnail' }) } catch { /* 预览失败不阻断创建 */ }
      }
      sendJson(response, 201, { ok: true, value: created })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Text artifact creation failed.'))
    }
    return true
  }

  return false
}
