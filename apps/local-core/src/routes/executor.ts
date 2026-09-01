import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'

export interface ExecutorRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly bridgeProxy: (path: string, input: { readonly method?: string; readonly body?: unknown }, signal: AbortSignal) => Promise<{ readonly status: number; readonly body: unknown }>
}

/**
 * /executor/* —— 唯一面向 MCP 的 Light Bridge 通道（原样转发）。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleExecutorRoute(ctx: ExecutorRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller } = ctx
  const { sendJson, readJsonBody } = ctx.helpers

  if (method === 'GET' && pathname === '/executor/health') {
    const result = await ctx.bridgeProxy('/health', {}, controller.signal)
    sendJson(response, result.status, result.body); return true
  }
  if (method === 'GET' && pathname === '/executor/capabilities') {
    const result = await ctx.bridgeProxy('/v1/capabilities', {}, controller.signal)
    sendJson(response, result.status, result.body); return true
  }
  if (method === 'POST' && pathname === '/executor/tasks/claim-next') {
    const body = await readJsonBody(request, controller.signal)
    const result = await ctx.bridgeProxy('/v1/tasks/claim-next', { method: 'POST', body }, controller.signal)
    sendJson(response, result.status, result.body); return true
  }
  const executorTaskMatch = /^\/executor\/tasks\/([^/]+)$/.exec(pathname)
  const executorTaskActionMatch = /^\/executor\/tasks\/([^/]+)\/(claim|running|heartbeat|result|cancel)$/.exec(pathname)
  const executorRunTaskMatch = /^\/executor\/runs\/([^/]+)\/task$/.exec(pathname)
  if (method === 'GET' && executorTaskMatch !== null) {
    const result = await ctx.bridgeProxy(`/v1/tasks/${encodeURIComponent(decodeURIComponent(executorTaskMatch[1] ?? ''))}`, {}, controller.signal)
    sendJson(response, result.status, result.body); return true
  }
  if (method === 'GET' && executorRunTaskMatch !== null) {
    const result = await ctx.bridgeProxy(`/v1/tasks/by-run/${encodeURIComponent(decodeURIComponent(executorRunTaskMatch[1] ?? ''))}`, {}, controller.signal)
    sendJson(response, result.status, result.body); return true
  }
  if (method === 'POST' && executorTaskActionMatch !== null) {
    const taskId = encodeURIComponent(decodeURIComponent(executorTaskActionMatch[1] ?? ''))
    const action = executorTaskActionMatch[2] ?? ''
    const body = await readJsonBody(request, controller.signal)
    const result = await ctx.bridgeProxy(`/v1/tasks/${taskId}/${action}`, { method: 'POST', body }, controller.signal)
    sendJson(response, result.status, result.body); return true
  }

  return false
}
