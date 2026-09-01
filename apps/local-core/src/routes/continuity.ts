import type { IncomingMessage, ServerResponse } from 'node:http'
import type { BindContinuitySessionV1, ContinuityResolveRequestV1, ContinuityReturnIntakeV1 } from '@local-creative-os/contracts'
import type { ContinuityRuntimeService } from '../continuity-runtime-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { isRecord, routeRequireProject, type RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'

export interface ContinuityRouteContext {
  readonly method: string
  readonly pathname: string
  readonly url: URL
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly continuityRuntime: ContinuityRuntimeService | undefined
  readonly helpers: RouteHttpHelpers
}

function parseSourceRefs(value: unknown): BindContinuitySessionV1['sourceRefs'] | undefined {
  if (!Array.isArray(value)) return undefined
  const refs: NonNullable<BindContinuitySessionV1['sourceRefs']>[number][] = []
  for (const item of value) {
    if (!isRecord(item) || typeof item.sourceType !== 'string' || typeof item.sourceRef !== 'string' || typeof item.observedAt !== 'string') return undefined
    refs.push({ sourceType: item.sourceType, sourceRef: item.sourceRef, observedAt: item.observedAt })
  }
  return refs
}

function parseOptionalWorkspace(url: URL): string | null | undefined {
  if (!url.searchParams.has('workspaceId')) return undefined
  const raw = url.searchParams.get('workspaceId')
  return raw === null || raw === '' ? null : raw
}

export async function handleContinuityRoute(ctx: ContinuityRouteContext): Promise<boolean> {
  const resolveMatch = ctx.pathname === '/runtime/continuity/resolve'
  const bindMatch = /^\/runtime\/continuity\/sessions\/([^/]+)\/bind$/.exec(ctx.pathname)
  const resumeMatch = /^\/projects\/([^/]+)\/continuity\/resume$/.exec(ctx.pathname)
  const attachMatch = /^\/projects\/([^/]+)\/continuity\/attach$/.exec(ctx.pathname)
  const returnMatch = /^\/projects\/([^/]+)\/continuity\/returns$/.exec(ctx.pathname)
  if (!resolveMatch && bindMatch === null && resumeMatch === null && attachMatch === null && returnMatch === null) return false
  if (ctx.metadata === undefined || ctx.continuityRuntime === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Continuity runtime is not configured.'))
    return true
  }

  if (resolveMatch && ctx.method === 'POST') {
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (!isRecord(raw) || typeof raw.capturedAt !== 'string') {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Continuity resolve requires capturedAt.'))
      return true
    }
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: ctx.continuityRuntime.resolve(raw as unknown as ContinuityResolveRequestV1) })
    return true
  }

  if (bindMatch !== null && ctx.method === 'POST') {
    const sessionId = decodeURIComponent(bindMatch[1] ?? '')
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (!isRecord(raw)) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Session bind input is invalid.'))
      return true
    }
    const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
    if (typeof inputRaw.projectId !== 'string') {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Session bind requires projectId.'))
      return true
    }
    const sourceRefs = parseSourceRefs(inputRaw.sourceRefs)
    if (inputRaw.sourceRefs !== undefined && sourceRefs === undefined) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'sourceRefs must contain sourceType, sourceRef and observedAt strings.'))
      return true
    }
    const input: BindContinuitySessionV1 = {
      sessionId,
      projectId: inputRaw.projectId,
      ...(typeof inputRaw.workspaceId === 'string' ? { workspaceId: inputRaw.workspaceId } : {}),
      ...(inputRaw.status === 'idle' || inputRaw.status === 'working' || inputRaw.status === 'blocked' ? { status: inputRaw.status } : {}),
      ...(sourceRefs === undefined ? {} : { sourceRefs }),
    }
    try {
      const value = await ctx.continuityRuntime.bindSession(input, parseProjectEventOrigin(raw.origin))
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Session bind failed.'))
    }
    return true
  }

  const projectId = decodeURIComponent((resumeMatch ?? attachMatch ?? returnMatch)?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true
  const workspaceId = parseOptionalWorkspace(ctx.url)
  const sessionId = ctx.url.searchParams.get('sessionId') ?? undefined
  const explicitAction = ctx.url.searchParams.get('explicitAction') ?? undefined
  const tokenBudgetRaw = ctx.url.searchParams.get('tokenBudget')
  const tokenBudget = tokenBudgetRaw === null ? undefined : Number(tokenBudgetRaw)
  const common = {
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(explicitAction === undefined ? {} : { explicitAction }),
    ...(tokenBudget === undefined || !Number.isFinite(tokenBudget) ? {} : { tokenBudget }),
  }
  try {
    if (returnMatch !== null && ctx.method === 'POST') {
      let raw: unknown
      try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
        ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
        return true
      }
      if (!isRecord(raw)) {
        ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Return intake input is invalid.'))
        return true
      }
      const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
      if (typeof inputRaw.title !== 'string' || typeof inputRaw.summary !== 'string') {
        ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Return intake requires title and summary.'))
        return true
      }
      const value = ctx.continuityRuntime.intakeReturn(projectId, inputRaw as unknown as ContinuityReturnIntakeV1, parseProjectEventOrigin(raw.origin))
      ctx.helpers.sendJson(ctx.response, 201, { ok: true, value })
      return true
    }
    if (resumeMatch !== null && ctx.method === 'GET') {
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: await ctx.continuityRuntime.resume(projectId, common, ctx.signal) })
      return true
    }
    if (attachMatch !== null && ctx.method === 'GET') {
      const provider = ctx.url.searchParams.get('provider') ?? undefined
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: await ctx.continuityRuntime.attachBundle(projectId, { ...common, ...(provider === undefined ? {} : { provider }) }, ctx.signal) })
      return true
    }
  } catch (error: unknown) {
    ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Continuity runtime failed.'))
    return true
  }
  return false
}
