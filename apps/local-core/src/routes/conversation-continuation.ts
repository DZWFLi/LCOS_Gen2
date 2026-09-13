import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  ContinuationProviderAdapterV1,
  ContinuationReconcileRequestV1,
  ContinuationStepAdvanceRequestV1,
  ContinuationSubmitRequestV1,
} from '@local-creative-os/contracts'
import { ContinuationStaleRevisionError, RecoveryActionUnsupportedError } from '../conversation-continuation-service.js'
import type { ConversationContinuationService } from '../conversation-continuation-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { isRecord, routeRequireProject, type RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'

/** Sprint 1A（T6）：continuation operation journal / read projection 的最小 HTTP 面。 */
export interface ConversationContinuationRouteContext {
  readonly method: string
  readonly pathname: string
  readonly url: URL
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly continuation: ConversationContinuationService | undefined
  /** T7 provider adapter（未配置 = recovery 动作 503 UNAVAILABLE，前端禁用按钮）。 */
  readonly adapter: ContinuationProviderAdapterV1 | undefined
  readonly helpers: RouteHttpHelpers
}

const MODES = ['continue_existing', 'native_full_fork', 'selected_context', 'blank_new'] as const
const STATE_VALUES = ['pending', 'confirmed', 'failed', 'outcome_unknown', 'not_applicable'] as const

/** 运行时类型守卫：真实拒绝非法 mode，不靠 as 绕过（strict TS）。 */
function isContinuationMode(value: unknown): value is 'continue_existing' | 'native_full_fork' | 'selected_context' | 'blank_new' {
  return MODES.some((mode) => mode === value)
}

/** 运行时类型守卫：真实拒绝非法 outcome。 */
function isStepOutcome(value: unknown): value is 'pending' | 'confirmed' | 'failed' | 'outcome_unknown' | 'not_applicable' {
  return STATE_VALUES.some((state) => state === value)
}

function parseSubmit(raw: unknown): { readonly input: Omit<ContinuationSubmitRequestV1, 'projectId'>; readonly origin: ReturnType<typeof parseProjectEventOrigin> } | { readonly error: string } {
  if (!isRecord(raw)) return { error: 'Continuation submit input is invalid.' }
  const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
  const origin = parseProjectEventOrigin(raw.origin)
  if (typeof inputRaw.operationId !== 'string' || inputRaw.operationId.length < 1 || inputRaw.operationId.length > 200) return { error: 'operationId is required.' }
  if (!isContinuationMode(inputRaw.mode)) return { error: `mode must be one of ${MODES.join(', ')}.` }
  if (inputRaw.contextInheritance !== 'inherit' && inputRaw.contextInheritance !== 'none') return { error: "contextInheritance must be 'inherit' or 'none'." }
  if (inputRaw.checkout !== 'shared' && inputRaw.checkout !== 'isolated') return { error: "checkout must be 'shared' or 'isolated'." }
  if (typeof inputRaw.provider !== 'string' || inputRaw.provider.length < 1 || inputRaw.provider.length > 100) return { error: 'provider is required.' }
  if (inputRaw.connectedConversationId !== undefined
    && (typeof inputRaw.connectedConversationId !== 'string' || inputRaw.connectedConversationId.length < 1 || inputRaw.connectedConversationId.length > 200)) {
    return { error: 'connectedConversationId must be a string within the length limit when present.' }
  }
  if (Object.keys(inputRaw).some((key) => !['operationId', 'connectedConversationId', 'mode', 'contextInheritance', 'checkout', 'provider', 'orderedReferences'].includes(key))) {
    return { error: 'Unexpected field in continuation submit input.' }
  }
  if (inputRaw.orderedReferences !== undefined) {
    const refs = parseOrderedReferences(inputRaw.orderedReferences)
    if ('error' in refs) return refs
    const inputWithRefs: Omit<ContinuationSubmitRequestV1, 'projectId'> = {
      schemaVersion: 1,
      operationId: inputRaw.operationId,
      mode: inputRaw.mode,
      contextInheritance: inputRaw.contextInheritance,
      checkout: inputRaw.checkout,
      provider: inputRaw.provider,
      ...(inputRaw.connectedConversationId === undefined ? {} : { connectedConversationId: inputRaw.connectedConversationId }),
      orderedReferences: refs.value,
    }
    return { input: inputWithRefs, origin }
  }
  const input: Omit<ContinuationSubmitRequestV1, 'projectId'> = {
    schemaVersion: 1,
    operationId: inputRaw.operationId,
    mode: inputRaw.mode,
    contextInheritance: inputRaw.contextInheritance,
    checkout: inputRaw.checkout,
    provider: inputRaw.provider,
    ...(inputRaw.connectedConversationId === undefined ? {} : { connectedConversationId: inputRaw.connectedConversationId }),
  }
  return { input, origin }
}

const REF_TYPES = ['artifact', 'view', 'scope', 'workspace', 'conversation', 'component'] as const

/** 最小运行时校验：orderedReferences 数组 → OrderedRunReferenceV2（非法项整体拒绝，不静默丢弃）。 */
function parseOrderedReferences(raw: unknown): { readonly value: readonly import('@local-creative-os/contracts').OrderedRunReferenceV2[] } | { readonly error: string } {
  if (!Array.isArray(raw)) return { error: 'orderedReferences must be an array.' }
  const value: import('@local-creative-os/contracts').OrderedRunReferenceV2[] = []
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry) || !isRecord(entry.ref) || typeof entry.order !== 'number') {
      return { error: `orderedReferences[${index}] must be { ref, order }.` }
    }
    const ref = entry.ref as Record<string, unknown>
    const type = ref.type
    if (!REF_TYPES.some((candidate) => candidate === type)) {
      return { error: `orderedReferences[${index}].ref.type is invalid.` }
    }
    const idKey = type === 'view' ? 'viewId' : type === 'artifact' ? 'artifactId' : type === 'scope' ? 'scopeId' : type === 'workspace' ? 'workspaceId' : type === 'conversation' ? 'conversationSessionId' : 'componentId'
    if (typeof ref[idKey] !== 'string' || String(ref[idKey]).length < 1) {
      return { error: `orderedReferences[${index}].ref.${idKey} is required.` }
    }
    const refValue = { type, [idKey]: ref[idKey] } as never
    value.push({ ref: refValue, order: entry.order })
  }
  return { value }
}

function parseAdvance(raw: unknown): { readonly input: Omit<ContinuationStepAdvanceRequestV1, never>; readonly origin: ReturnType<typeof parseProjectEventOrigin> } | { readonly error: string } {
  if (!isRecord(raw)) return { error: 'Continuation step advance input is invalid.' }
  const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
  const origin = parseProjectEventOrigin(raw.origin)
  const step = inputRaw.step
  if (step !== 'external_create' && step !== 'core_bind' && step !== 'attach' && step !== 'projection') return { error: "step must be one of external_create, core_bind, attach, projection." }
  if (!isStepOutcome(inputRaw.outcome)) return { error: `outcome must be one of ${STATE_VALUES.join(', ')}.` }
  if (Object.keys(inputRaw).some((key) => !['step', 'outcome', 'externalEvidence', 'errorEvidence', 'expectedRevision'].includes(key))) {
    return { error: 'Unexpected field in continuation step advance input.' }
  }
  const input: Omit<ContinuationStepAdvanceRequestV1, never> = {
    step,
    outcome: inputRaw.outcome,
    ...(inputRaw.externalEvidence === undefined ? {}
      : isRecord(inputRaw.externalEvidence)
        ? { externalEvidence: { schemaVersion: 1, provider: String(inputRaw.externalEvidence.provider), externalSessionId: String(inputRaw.externalEvidence.externalSessionId), correlationId: String(inputRaw.externalEvidence.correlationId), createdAt: String(inputRaw.externalEvidence.createdAt) } }
        : {}),
    ...(typeof inputRaw.errorEvidence === 'string' ? { errorEvidence: inputRaw.errorEvidence } : {}),
    ...(typeof inputRaw.expectedRevision === 'number' ? { expectedRevision: inputRaw.expectedRevision } : {}),
  }
  return { input, origin }
}

function parseReconcile(raw: unknown): { readonly input: Omit<ContinuationReconcileRequestV1, never>; readonly origin: ReturnType<typeof parseProjectEventOrigin> } | { readonly error: string } {
  if (!isRecord(raw)) return { error: 'Continuation reconcile input is invalid.' }
  const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
  const origin = parseProjectEventOrigin(raw.origin)
  if (inputRaw.externalConfirmed !== undefined && typeof inputRaw.externalConfirmed !== 'boolean') return { error: 'externalConfirmed must be a boolean when present.' }
  if (Object.keys(inputRaw).some((key) => !['externalConfirmed', 'externalEvidence', 'errorEvidence', 'expectedRevision'].includes(key))) {
    return { error: 'Unexpected field in continuation reconcile input.' }
  }
  const input: Omit<ContinuationReconcileRequestV1, never> = {
    ...(typeof inputRaw.externalConfirmed === 'boolean' ? { externalConfirmed: inputRaw.externalConfirmed } : {}),
    ...(inputRaw.externalEvidence !== undefined && isRecord(inputRaw.externalEvidence)
      ? { externalEvidence: { schemaVersion: 1, provider: String(inputRaw.externalEvidence.provider), externalSessionId: String(inputRaw.externalEvidence.externalSessionId), correlationId: String(inputRaw.externalEvidence.correlationId), createdAt: String(inputRaw.externalEvidence.createdAt) } }
      : {}),
    ...(typeof inputRaw.errorEvidence === 'string' ? { errorEvidence: inputRaw.errorEvidence } : {}),
    ...(typeof inputRaw.expectedRevision === 'number' ? { expectedRevision: inputRaw.expectedRevision } : {}),
  }
  return { input, origin }
}

export async function handleConversationContinuationRoute(ctx: ConversationContinuationRouteContext): Promise<boolean> {
  const submitMatch = /^\/projects\/([^/]+)\/conversation-continuations$/.exec(ctx.pathname)
  const itemMatch = /^\/projects\/([^/]+)\/conversation-continuations\/([^/]+)$/.exec(ctx.pathname)
  const stepMatch = /^\/projects\/([^/]+)\/conversation-continuations\/([^/]+)\/steps$/.exec(ctx.pathname)
  const reconcileMatch = /^\/projects\/([^/]+)\/conversation-continuations\/([^/]+)\/reconcile$/.exec(ctx.pathname)
  const cancelMatch = /^\/projects\/([^/]+)\/conversation-continuations\/([^/]+)\/cancel$/.exec(ctx.pathname)
  const recoveryActionMatch = /^\/projects\/([^/]+)\/conversation-continuations\/([^/]+)\/recovery-actions$/.exec(ctx.pathname)
  const hasMatch = submitMatch !== null || itemMatch !== null || stepMatch !== null || reconcileMatch !== null || cancelMatch !== null || recoveryActionMatch !== null
  if (!hasMatch) return false
  if (ctx.metadata === undefined || ctx.continuation === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Continuation service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent((submitMatch ?? itemMatch ?? stepMatch ?? reconcileMatch ?? cancelMatch ?? recoveryActionMatch)?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true
  const operationIdRaw = (itemMatch ?? stepMatch ?? reconcileMatch ?? cancelMatch ?? recoveryActionMatch)?.[2]

  if (submitMatch !== null && ctx.method === 'GET') {
    // 项目内 journal 列表（Recovery body 入口）
    const value = ctx.continuation.list(projectId)
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    return true
  }

  if (submitMatch !== null && ctx.method === 'POST') {
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const parsed = parseSubmit(raw)
    if ('error' in parsed) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', parsed.error))
      return true
    }
    try {
      const value = ctx.continuation.submit({ ...parsed.input, projectId }, parsed.origin)
      ctx.helpers.sendJson(ctx.response, value.created ? 201 : 200, { ok: true, value })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Continuation submit failed.'))
    }
    return true
  }

  if (itemMatch !== null && ctx.method === 'GET') {
    const operationId = decodeURIComponent(operationIdRaw ?? '')
    const projection = ctx.continuation.read(projectId, operationId)
    if (projection === undefined) {
      ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Continuation operation not found.'))
      return true
    }
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: projection })
    return true
  }

  if (stepMatch !== null && ctx.method === 'POST') {
    const operationId = decodeURIComponent(stepMatch[2] ?? '')
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const parsed = parseAdvance(raw)
    if ('error' in parsed) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', parsed.error))
      return true
    }
    try {
      const value = ctx.continuation.advanceStep(projectId, operationId, parsed.input, parsed.origin)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      if (error instanceof ContinuationStaleRevisionError) {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error.message))
      } else {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Continuation step advance failed.'))
      }
    }
    return true
  }

  if (reconcileMatch !== null && ctx.method === 'POST') {
    const operationId = decodeURIComponent(reconcileMatch[2] ?? '')
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const parsed = parseReconcile(raw)
    if ('error' in parsed) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', parsed.error))
      return true
    }
    try {
      const value = ctx.continuation.reconcile(projectId, operationId, parsed.input, parsed.origin)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      if (error instanceof ContinuationStaleRevisionError) {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error.message))
      } else {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Continuation reconcile failed.'))
      }
    }
    return true
  }

  if (cancelMatch !== null && ctx.method === 'POST') {
    const operationId = decodeURIComponent(cancelMatch[2] ?? '')
    let raw: unknown
    let expectedRevision: number | undefined
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch { raw = undefined }
    if (isRecord(raw)) {
      const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
      if (typeof inputRaw.expectedRevision === 'number') expectedRevision = inputRaw.expectedRevision
    }
    try {
      const value = ctx.continuation.requestCancel(projectId, operationId, expectedRevision, isRecord(raw) ? parseProjectEventOrigin(raw.origin) : undefined)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      if (error instanceof ContinuationStaleRevisionError) {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error.message))
      } else {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Continuation cancel failed.'))
      }
    }
    return true
  }

  if (recoveryActionMatch !== null && ctx.method === 'POST') {
    const operationId = decodeURIComponent(recoveryActionMatch[2] ?? '')
    if (ctx.adapter === undefined) {
      // 未配置 T7 adapter：recovery 动作不可用（前端禁用按钮，不点后无果）。
      ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Continuation provider adapter is not configured.'))
      return true
    }
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const inputRaw = isRecord(raw) && 'input' in raw && isRecord(raw.input) ? raw.input : raw
    if (!isRecord(inputRaw) || typeof inputRaw.action !== 'string') {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Recovery action requires action.'))
      return true
    }
    const expectedRevision = typeof inputRaw.expectedRevision === 'number' ? inputRaw.expectedRevision : undefined
    const RECOVERY_ACTIONS = ['recover_external', 'recover_bind', 'retry_attach', 'retry_projection', 'reconcile', 'cancel_request'] as const
    if (!RECOVERY_ACTIONS.some((action) => action === inputRaw.action)) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', `action must be one of ${RECOVERY_ACTIONS.join(', ')}.`))
      return true
    }
    try {
      const value = await ctx.continuation.executeRecoveryAction(projectId, operationId, inputRaw.action as (typeof RECOVERY_ACTIONS)[number], ctx.adapter, expectedRevision)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      if (error instanceof RecoveryActionUnsupportedError) {
        ctx.helpers.sendJson(ctx.response, 501, ctx.helpers.failure('UNAVAILABLE', error.message))
      } else if (error instanceof ContinuationStaleRevisionError) {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error.message))
      } else {
        ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Recovery action failed.'))
      }
    }
    return true
  }

  return false
}