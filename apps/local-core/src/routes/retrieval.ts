import type { SpatialRetrievalService } from '../spatial-retrieval-service.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'

export interface RetrievalRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly spatialRetrieval: SpatialRetrievalService | undefined
}

/**
 * HU-4：确定性空间检索。只读 Presentation（hierarchy / presentationEdges /
 * positions / membership），不写 Domain relation，不依赖 Ollama。
 */
export async function handleRetrievalRoute(ctx: RetrievalRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, spatialRetrieval } = ctx
  const { sendJson, failure, readJsonBody, isRecord, isStringArray } = ctx.helpers

  const spatialMatch = /^\/projects\/([^/]+)\/retrieval\/spatial$/.exec(pathname)
  if (method !== 'POST' || spatialMatch === null) return false
  if (spatialRetrieval === undefined) {
    sendJson(response, 503, failure('UNAVAILABLE', 'Spatial retrieval is not configured.'))
    return true
  }
  const projectId = decodeURIComponent(spatialMatch[1] ?? '')
  let input: unknown
  try { input = await readJsonBody(request, controller.signal) } catch {
    sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
    return true
  }
  if (!isRecord(input) || !isStringArray(input.seedViewIds)
    || (input.limit !== undefined && typeof input.limit !== 'number')) {
    sendJson(response, 400, failure('INVALID_ARGUMENT', 'Spatial retrieval requires seedViewIds (string[]).'))
    return true
  }
  const limit = typeof input.limit === 'number' ? Math.max(1, Math.min(16, Math.floor(input.limit))) : 6
  sendJson(response, 200, {
    ok: true,
    value: {
      schemaVersion: 1,
      projectId,
      seedViewIds: input.seedViewIds,
      candidates: spatialRetrieval.retrieve(projectId, input.seedViewIds, limit),
      generatedAt: new Date().toISOString(),
    },
  })
  return true
}
