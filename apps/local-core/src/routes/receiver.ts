import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ConnectConversationInput, CreateConversationInput, PrepareHandoffInput, ReceiverRuntimeService } from '../receiver-runtime-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { isRecord, routeRequireProject, type RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'

/** RECEIVER-0 会话承接 REST 面：connected-conversations（承接关系）+ receiver-binding（Active Receiver）。
 *  RECEIVER-3 追加：receiver-handoff（Handoff 快照的 prepare / 读 pending / consume）。 */
export interface ReceiverRouteContext {
  readonly method: string
  readonly pathname: string
  readonly url: URL
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly receiverRuntime: ReceiverRuntimeService | undefined
  readonly helpers: RouteHttpHelpers
}

const MAX_REF_LENGTH = 256
const MAX_LABEL_LENGTH = 200
/** RECEIVER-3：选中实体 id 上限（防误传整图 id；正常用户选中有界）。 */
const MAX_SELECTION_IDS = 200

function isProvider(value: unknown): value is 'codex' | 'workbuddy' {
  return value === 'codex' || value === 'workbuddy'
}

function isHandoffSurfaceKind(value: unknown): value is 'main' | 'context' | 'workflow' {
  return value === 'main' || value === 'context' || value === 'workflow'
}

/** 解析 POST /receiver-handoff 的 body（支持 { input, origin } 包装，与 binding 路由一致）。 */
function parsePrepareHandoffInput(raw: unknown): { readonly input: Omit<PrepareHandoffInput, 'projectId'>; readonly origin: ReturnType<typeof parseProjectEventOrigin> } | { readonly error: string } {
  if (!isRecord(raw)) return { error: 'Receiver handoff input is invalid.' }
  const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
  const origin = parseProjectEventOrigin(raw.origin)
  const from = inputRaw.fromConversationId
  if (from !== null && from !== undefined && (typeof from !== 'string' || from.length < 1 || from.length > MAX_REF_LENGTH)) return { error: 'fromConversationId must be a string within the length limit or null.' }
  if (typeof inputRaw.toConversationId !== 'string' || inputRaw.toConversationId.length < 1 || inputRaw.toConversationId.length > MAX_REF_LENGTH) return { error: 'toConversationId is required.' }
  if (!isRecord(inputRaw.surface)) return { error: 'surface must be { kind, surfaceId }.' }
  if (!isHandoffSurfaceKind(inputRaw.surface.kind)) return { error: "surface.kind must be 'main', 'context' or 'workflow'." }
  if (typeof inputRaw.surface.surfaceId !== 'string' || inputRaw.surface.surfaceId.length < 1 || inputRaw.surface.surfaceId.length > MAX_REF_LENGTH) return { error: 'surface.surfaceId is required.' }
  if (Object.keys(inputRaw.surface).some((key) => !['kind', 'surfaceId'].includes(key))) return { error: 'Unexpected field in receiver handoff surface.' }
  if (!Array.isArray(inputRaw.selectionEntityIds) || inputRaw.selectionEntityIds.length > MAX_SELECTION_IDS || inputRaw.selectionEntityIds.some((item) => typeof item !== 'string' || item.length < 1 || item.length > MAX_REF_LENGTH)) return { error: 'selectionEntityIds must be an array of strings within the limits.' }
  if (Object.keys(inputRaw).some((key) => !['fromConversationId', 'toConversationId', 'surface', 'selectionEntityIds'].includes(key))) return { error: 'Unexpected field in receiver handoff input.' }
  return {
    input: {
      fromConversationId: from === undefined ? null : from,
      toConversationId: inputRaw.toConversationId,
      surface: { kind: inputRaw.surface.kind, surfaceId: inputRaw.surface.surfaceId },
      selectionEntityIds: inputRaw.selectionEntityIds as readonly string[],
    },
    origin,
  }
}

/** 解析 POST /connected-conversations 的 body（支持 { input, origin } 包装，与 continuity 路由一致）。 */
function parseConversationInput(raw: unknown): { readonly action: 'connect' | 'create'; readonly input: ConnectConversationInput | CreateConversationInput; readonly origin: ReturnType<typeof parseProjectEventOrigin> } | { readonly error: string } {
  if (!isRecord(raw)) return { error: 'Connected conversation input is invalid.' }
  const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
  const origin = parseProjectEventOrigin(raw.origin)
  if (inputRaw.action !== 'connect' && inputRaw.action !== 'create') return { error: "action must be 'connect' or 'create'." }
  if (!isProvider(inputRaw.provider)) return { error: "provider must be 'codex' or 'workbuddy'." }
  if (typeof inputRaw.executorId !== 'string' || inputRaw.executorId.length < 1 || inputRaw.executorId.length > MAX_REF_LENGTH) return { error: 'executorId is required.' }
  if (inputRaw.label !== undefined && (typeof inputRaw.label !== 'string' || inputRaw.label.length > MAX_LABEL_LENGTH)) return { error: 'label must be a string within the length limit.' }
  if (inputRaw.action === 'connect') {
    if (typeof inputRaw.conversationRef !== 'string' || inputRaw.conversationRef.length < 1 || inputRaw.conversationRef.length > MAX_REF_LENGTH) return { error: 'connect requires conversationRef.' }
    if (Object.keys(inputRaw).some((key) => !['action', 'provider', 'executorId', 'conversationRef', 'label'].includes(key))) return { error: 'Unexpected field in connected conversation input.' }
    const input: ConnectConversationInput = {
      projectId: '',
      provider: inputRaw.provider,
      executorId: inputRaw.executorId,
      conversationRef: inputRaw.conversationRef,
      ...(inputRaw.label === undefined ? {} : { label: inputRaw.label }),
    }
    return { action: 'connect', input, origin }
  }
  if (inputRaw.conversationRef !== undefined) return { error: 'create does not accept conversationRef.' }
  if (Object.keys(inputRaw).some((key) => !['action', 'provider', 'executorId', 'label'].includes(key))) return { error: 'Unexpected field in connected conversation input.' }
  const input: CreateConversationInput = {
    projectId: '',
    provider: inputRaw.provider,
    executorId: inputRaw.executorId,
    ...(inputRaw.label === undefined ? {} : { label: inputRaw.label }),
  }
  return { action: 'create', input, origin }
}

export async function handleReceiverRoute(ctx: ReceiverRouteContext): Promise<boolean> {
  const listMatch = /^\/projects\/([^/]+)\/connected-conversations$/.exec(ctx.pathname)
  const itemMatch = /^\/projects\/([^/]+)\/connected-conversations\/([^/]+)$/.exec(ctx.pathname)
  const bindingMatch = /^\/projects\/([^/]+)\/receiver-binding$/.exec(ctx.pathname)
  // RECEIVER-3：handoff 三个端点（consume 子路径必须先于 item 匹配判断，正则末尾锚定互不冲突）。
  const handoffMatch = /^\/projects\/([^/]+)\/receiver-handoff$/.exec(ctx.pathname)
  const handoffConsumeMatch = /^\/projects\/([^/]+)\/receiver-handoff\/([^/]+)\/consume$/.exec(ctx.pathname)
  const handoffItemMatch = /^\/projects\/([^/]+)\/receiver-handoff\/([^/]+)$/.exec(ctx.pathname)
  if (listMatch === null && itemMatch === null && bindingMatch === null && handoffMatch === null && handoffItemMatch === null && handoffConsumeMatch === null) return false
  if (ctx.metadata === undefined || ctx.receiverRuntime === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Receiver runtime is not configured.'))
    return true
  }
  const projectId = decodeURIComponent((listMatch ?? itemMatch ?? bindingMatch ?? handoffMatch ?? handoffConsumeMatch ?? handoffItemMatch)?.[1] ?? '')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true

  if (listMatch !== null && ctx.method === 'GET') {
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: ctx.receiverRuntime.listProjectConversations(projectId) })
    return true
  }

  if (listMatch !== null && ctx.method === 'POST') {
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const parsed = parseConversationInput(raw)
    if ('error' in parsed) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', parsed.error))
      return true
    }
    const input = { ...parsed.input, projectId } as ConnectConversationInput | CreateConversationInput
    try {
      const value = parsed.action === 'connect'
        ? ctx.receiverRuntime.connectConversation(input as ConnectConversationInput, parsed.origin)
        : ctx.receiverRuntime.createConversation(input as CreateConversationInput, parsed.origin)
      ctx.helpers.sendJson(ctx.response, 201, { ok: true, value })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Connected conversation mutation failed.'))
    }
    return true
  }

  if (itemMatch !== null && ctx.method === 'DELETE') {
    const connectedConversationId = decodeURIComponent(itemMatch[2] ?? '')
    try {
      const value = ctx.receiverRuntime.disconnectConversation(projectId, connectedConversationId)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Connected conversation disconnect failed.'))
    }
    return true
  }

  if (bindingMatch !== null && ctx.method === 'GET') {
    try {
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: ctx.receiverRuntime.getProjectReceiverBinding(projectId) })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Receiver binding lookup failed.'))
    }
    return true
  }

  if (bindingMatch !== null && ctx.method === 'POST') {
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (!isRecord(raw)) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Receiver binding input is invalid.'))
      return true
    }
    const inputRaw = 'input' in raw && isRecord(raw.input) ? raw.input : raw
    if (typeof inputRaw.connectedConversationId !== 'string' || inputRaw.connectedConversationId.length < 1 || Object.keys(inputRaw).some((key) => key !== 'connectedConversationId')) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Receiver binding requires connectedConversationId.'))
      return true
    }
    // activeReceiverId 必须指向已存在的承接对话（承接层内部一致性，先于 service 校验返回 400）。
    if (ctx.metadata.getConnectedConversation(projectId, inputRaw.connectedConversationId) === undefined) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Connected conversation not found in project.'))
      return true
    }
    try {
      const value = ctx.receiverRuntime.setActiveReceiver(projectId, inputRaw.connectedConversationId, parseProjectEventOrigin(raw.origin))
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Receiver binding update failed.'))
    }
    return true
  }

  // ==================== RECEIVER-3：Handoff 快照端点 ====================

  // POST /projects/:id/receiver-handoff —— prepare：切换确认后冻结现场（零副作用，只存快照）。
  if (handoffMatch !== null && ctx.method === 'POST') {
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const parsed = parsePrepareHandoffInput(raw)
    if ('error' in parsed) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', parsed.error))
      return true
    }
    // to/from 必须指向已存在的承接对话（承接层内部一致性，先于 service 校验返回 400）。
    if (ctx.metadata.getConnectedConversation(projectId, parsed.input.toConversationId) === undefined) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Connected conversation not found in project.'))
      return true
    }
    if (parsed.input.fromConversationId !== null
      && ctx.metadata.getConnectedConversation(projectId, parsed.input.fromConversationId) === undefined) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'From conversation not found in project.'))
      return true
    }
    try {
      const value = ctx.receiverRuntime.prepareHandoff({ ...parsed.input, projectId }, parsed.origin)
      ctx.helpers.sendJson(ctx.response, 201, { ok: true, value })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Receiver handoff prepare failed.'))
    }
    return true
  }

  // GET /projects/:id/receiver-handoff/:conversationId —— 读 pending（前端切换后可查；无 pending 返回 null）。
  if (handoffItemMatch !== null && ctx.method === 'GET') {
    const conversationId = decodeURIComponent(handoffItemMatch[2] ?? '')
    try {
      const value = ctx.receiverRuntime.getPendingHandoff(projectId, conversationId)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Receiver handoff lookup failed.'))
    }
    return true
  }

  // POST /projects/:id/receiver-handoff/:conversationId/consume —— 消费 pending（注入首条消息后标记，幂等）。
  if (handoffConsumeMatch !== null && ctx.method === 'POST') {
    const conversationId = decodeURIComponent(handoffConsumeMatch[2] ?? '')
    let origin: ReturnType<typeof parseProjectEventOrigin>
    try {
      const raw: unknown = await ctx.helpers.readJsonBody(ctx.request, ctx.signal)
      origin = parseProjectEventOrigin(isRecord(raw) ? raw : undefined)
    } catch {
      origin = undefined
    }
    try {
      const value = ctx.receiverRuntime.consumePendingHandoff(projectId, conversationId, origin)
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value })
    } catch (error: unknown) {
      ctx.helpers.sendJson(ctx.response, 409, ctx.helpers.failure('CONFLICT', error instanceof Error ? error.message : 'Receiver handoff consume failed.'))
    }
    return true
  }

  return false
}
