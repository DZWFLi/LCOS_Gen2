import type { BoundaryEvaluationRequestV1, IntentTypeV0 } from '@local-creative-os/contracts'
import type { AttentionRuntimeService } from '../attention-runtime-service.js'
import type { BoundaryEvaluatorService } from '../boundary-evaluator-service.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'

export interface AttentionRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly attentionRuntime: AttentionRuntimeService | undefined
  readonly boundaryEvaluator: BoundaryEvaluatorService
}

const INTENT_TYPES = new Set<IntentTypeV0>([
  'continue_work', 'understand', 'compare', 'revise', 'review', 'extract_actions',
  'create_brief', 'organize', 'research', 'execute_skill', 'unknown',
])

export async function handleAttentionRoute(ctx: AttentionRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, controller, attentionRuntime } = ctx
  const { sendJson, failure, readJsonBody, isRecord, isStringArray } = ctx.helpers

  const boundaryMatch = /^\/projects\/([^/]+)\/attention\/boundary-evaluate$/.exec(pathname)
  if (method === 'POST' && boundaryMatch !== null) {
    const projectId = decodeURIComponent(boundaryMatch[1] ?? '')
    let value: unknown
    try { value = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Boundary evaluation body must be valid JSON.'))
      return true
    }
    if (!isRecord(value)
      || (value.kind !== 'context' && value.kind !== 'workflow')
      || typeof value.evidenceKey !== 'string'
      || !Array.isArray(value.evidence)
      || !value.evidence.every((item) => isRecord(item) && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.source === 'string')
      || (value.reflection !== undefined && typeof value.reflection !== 'string')
      || (value.workspaceId !== undefined && typeof value.workspaceId !== 'string')) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Invalid Boundary evaluation request.'))
      return true
    }
    try {
      const input: BoundaryEvaluationRequestV1 = {
        kind: value.kind,
        evidenceKey: value.evidenceKey,
        evidence: value.evidence.map((item) => ({ id: String((item as Record<string, unknown>).id), label: String((item as Record<string, unknown>).label), source: String((item as Record<string, unknown>).source) })),
        ...(typeof value.reflection === 'string' && value.reflection.trim() ? { reflection: value.reflection.trim() } : {}),
        ...(typeof value.workspaceId === 'string' && value.workspaceId ? { workspaceId: value.workspaceId } : {}),
      }
      sendJson(response, 200, { ok: true, value: await ctx.boundaryEvaluator.evaluate(projectId, input, controller.signal) })
    } catch (error) {
      sendJson(response, 200, { ok: true, value: { schemaVersion: 1, kind: value.kind, shouldShow: false, confidence: 0, reason: error instanceof Error ? error.message : 'Boundary evaluator unavailable.' } })
    }
    return true
  }

  const runtimeMatch = /^\/projects\/([^/]+)\/attention\/runtime$/.exec(pathname)
  if (runtimeMatch !== null) {
    if (attentionRuntime === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Attention runtime is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(runtimeMatch[1] ?? '')
    if (method === 'GET') {
      const workspaceId = url.searchParams.get('workspaceId')
      const action = url.searchParams.get('action')
      const budgetRaw = url.searchParams.get('tokenBudget')
      const intentPolicy = url.searchParams.get('intentPolicy')
      const budget = budgetRaw === null ? undefined : Number(budgetRaw)
      if (budgetRaw !== null && (!Number.isFinite(budget) || (budget ?? 0) <= 0)) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'tokenBudget must be a positive number.'))
        return true
      }
      try {
        sendJson(response, 200, { ok: true, value: await attentionRuntime.snapshot(projectId, {
          ...(workspaceId === null || workspaceId === '' ? {} : { workspaceId }),
          ...(action === null || action.trim() === '' ? {} : { explicitAction: action.trim() }),
          ...(budget === undefined ? {} : { tokenBudget: budget }),
          ...(intentPolicy === 'rules_only' ? { intentPolicy: 'rules_only' as const } : {}),
        }, controller.signal) })
      } catch (error) {
        sendJson(response, 404, failure('NOT_FOUND', error instanceof Error ? error.message : 'Attention runtime failed.'))
      }
      return true
    }
    if (method !== 'POST') return false
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Attention runtime body must be valid JSON.'))
      return true
    }
    if (!isRecord(input)
      || (input.workspaceId !== undefined && input.workspaceId !== null && typeof input.workspaceId !== 'string')
      || (input.explicitAction !== undefined && typeof input.explicitAction !== 'string')
      || (input.tokenBudget !== undefined && typeof input.tokenBudget !== 'number')
      || (input.expandViewIds !== undefined && !isStringArray(input.expandViewIds))
      || (input.fullViewIds !== undefined && !isStringArray(input.fullViewIds))
      || (input.intentPolicy !== undefined && input.intentPolicy !== 'rules_only' && input.intentPolicy !== 'allow_model')) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Invalid Attention runtime request.'))
      return true
    }
    try {
      sendJson(response, 200, { ok: true, value: await attentionRuntime.snapshot(projectId, {
        ...(typeof input.workspaceId === 'string' ? { workspaceId: input.workspaceId } : {}),
        ...(typeof input.explicitAction === 'string' && input.explicitAction.trim() ? { explicitAction: input.explicitAction.trim() } : {}),
        ...(typeof input.tokenBudget === 'number' ? { tokenBudget: input.tokenBudget } : {}),
        ...(isStringArray(input.expandViewIds) ? { expandViewIds: input.expandViewIds } : {}),
        ...(isStringArray(input.fullViewIds) ? { fullViewIds: input.fullViewIds } : {}),
        ...(input.intentPolicy === 'rules_only' ? { intentPolicy: 'rules_only' as const } : input.intentPolicy === 'allow_model' ? { intentPolicy: 'allow_model' as const } : {}),
      }, controller.signal) })
    } catch (error) {
      sendJson(response, 404, failure('NOT_FOUND', error instanceof Error ? error.message : 'Attention runtime failed.'))
    }
    return true
  }

  const intentMatch = /^\/projects\/([^/]+)\/attention\/intent$/.exec(pathname)
  if (method === 'PUT' && intentMatch !== null) {
    if (attentionRuntime === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Attention runtime is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(intentMatch[1] ?? '')
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Intent body must be valid JSON.'))
      return true
    }
    if (!isRecord(input)
      || (input.workspaceId !== undefined && input.workspaceId !== null && typeof input.workspaceId !== 'string')
      || !('intent' in input)
      || (input.intent !== null && (!isRecord(input.intent) || typeof input.intent.type !== 'string' || !INTENT_TYPES.has(input.intent.type as IntentTypeV0) || (input.intent.goal !== undefined && typeof input.intent.goal !== 'string')))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Intent update requires intent=null or a supported intent type.'))
      return true
    }
    try {
      const intent = input.intent === null ? null : {
        type: input.intent.type as IntentTypeV0,
        ...(typeof input.intent.goal === 'string' && input.intent.goal.trim() ? { goal: input.intent.goal.trim() } : {}),
      }
      sendJson(response, 200, { ok: true, value: attentionRuntime.setExplicitIntent(projectId, typeof input.workspaceId === 'string' ? input.workspaceId : null, intent) })
    } catch (error) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Intent update failed.'))
    }
    return true
  }

  const dismissMatch = /^\/projects\/([^/]+)\/attention\/candidates\/([^/]+)\/dismiss$/.exec(pathname)
  if (method === 'POST' && dismissMatch !== null) {
    if (attentionRuntime === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Attention runtime is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(dismissMatch[1] ?? '')
    const key = decodeURIComponent(dismissMatch[2] ?? '')
    let workspaceId: string | null = null
    try {
      const input = await readJsonBody(request, controller.signal)
      if (isRecord(input) && typeof input.workspaceId === 'string') workspaceId = input.workspaceId
    } catch {
      // Empty body is valid for project-overview suppression.
    }
    try {
      sendJson(response, 200, { ok: true, value: attentionRuntime.dismissCandidate(projectId, workspaceId, key) })
    } catch (error) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Candidate dismissal failed.'))
    }
    return true
  }

  return false
}
