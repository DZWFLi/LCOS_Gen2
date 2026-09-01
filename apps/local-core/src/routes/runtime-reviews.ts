import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AcceptArtifactReturnInput } from '@local-creative-os/contracts'
import type { ArtifactReturnId } from '@local-creative-os/domain'
import type { LocalCoreErrorCode } from '../errors.js'
import type { RuntimeApplicationService } from '../runtime-application-service.js'
import type { RuntimeReviewService } from '../runtime-review-service.js'

export interface RuntimeReviewRouteContext {
  readonly pathname: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly controller: AbortController
  readonly runtimeReview: RuntimeReviewService
  readonly runtimeApplication?: RuntimeApplicationService | undefined
  readonly maxBodyBytes: number
  readonly sendJson: (response: ServerResponse, statusCode: number, value: unknown) => void
  readonly failure: (code: LocalCoreErrorCode, message: string, retryable?: boolean) => { ok: false; error: { code: string; message: string; retryable: boolean; origin: string } }
  readonly readJsonBody: (request: IncomingMessage, signal: AbortSignal) => Promise<unknown>
  readonly readRawBody: (request: IncomingMessage, signal: AbortSignal, maxBytes: number) => Promise<Buffer>
  readonly isRecord: (value: unknown) => value is Record<string, unknown>
}

/** /artifact-returns/:id/(accept|reject|retry) —— 用户对 Draft 结果的三个决定。 */
export async function handleRuntimeReviewRoute(ctx: RuntimeReviewRouteContext): Promise<boolean> {
  const { pathname, request, response, controller, runtimeReview } = ctx
  const method = request.method ?? 'GET'
  const acceptReturnMatch = /^\/artifact-returns\/([^/]+)\/accept$/.exec(pathname)
  const rejectReturnMatch = /^\/artifact-returns\/([^/]+)\/reject$/.exec(pathname)
  const retryReturnMatch = /^\/artifact-returns\/([^/]+)\/retry$/.exec(pathname)
  if (method !== 'POST' || (acceptReturnMatch === null && rejectReturnMatch === null && retryReturnMatch === null)) {
    return false
  }
  const returnId = decodeURIComponent(
    acceptReturnMatch?.[1] ?? rejectReturnMatch?.[1] ?? retryReturnMatch?.[1] ?? '',
  ) as ArtifactReturnId
  try {
    if (acceptReturnMatch !== null) {
      const input = await ctx.readJsonBody(request, controller.signal)
      if (!ctx.isRecord(input) || typeof input.expectedBaseRevisionId !== 'string'
        || Object.keys(input).some((key) => key !== 'expectedBaseRevisionId')) {
        ctx.sendJson(response, 400, ctx.failure('INVALID_ARGUMENT', 'Accept requires only expectedBaseRevisionId.'))
        return true
      }
      const accepted = runtimeReview.accept(returnId, input as unknown as AcceptArtifactReturnInput)
      try {
        await ctx.runtimeApplication?.intakeContinuityReturn(accepted.run.id)
      } catch (error: unknown) {
        // Continuity intake 是次级记账；Accept 本身已成功，绝不因它回滚用户决策。
        console.warn('[runtime-reviews] continuity intake failed:', error)
      }
      ctx.sendJson(response, 200, { ok: true, value: accepted })
    } else if (rejectReturnMatch !== null) {
      ctx.sendJson(response, 200, { ok: true, value: runtimeReview.reject(returnId) })
    } else {
      const raw = await ctx.readRawBody(request, controller.signal, ctx.maxBodyBytes)
      const input = raw.length === 0 ? {} : JSON.parse(raw.toString('utf8')) as unknown
      if (!ctx.isRecord(input) || (input.instruction !== undefined && typeof input.instruction !== 'string')
        || Object.keys(input).some((key) => key !== 'instruction')) {
        ctx.sendJson(response, 400, ctx.failure('INVALID_ARGUMENT', 'Retry accepts only optional instruction.'))
        return true
      }
      ctx.sendJson(response, 201, { ok: true, value: runtimeReview.retry(returnId, input) })
    }
  } catch (error: unknown) {
    ctx.sendJson(response, 409, ctx.failure('CONFLICT', error instanceof Error ? error.message : 'Runtime review decision conflicted.'))
  }
  return true
}
