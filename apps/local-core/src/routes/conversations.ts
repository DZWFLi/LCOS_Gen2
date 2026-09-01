import type {
  AnnotateConversationSectionInputV1,
  BuildConversationSemanticIndexInputV1,
  CompleteConversationImportInputV1,
  CreateConversationImportSessionInputV1,
  ImportManualConversationInputV1,
  PinConversationMessageInputV1,
} from '@local-creative-os/contracts'
import type { ConversationImportService } from '../conversation-import-service.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface ConversationsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly conversations: ConversationImportService | undefined
}

/**
 * /projects/:id/conversations* —— 对话导入会话、时间线、章节、语义索引。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleConversationsRoute(ctx: ConversationsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, url, conversations } = ctx
  const conversationImportCreateMatch = /^\/projects\/([^/]+)\/conversation-import-sessions$/.exec(pathname)
  const conversationImportOneMatch = /^\/projects\/([^/]+)\/conversation-import-sessions\/([^/]+)$/.exec(pathname)
  const conversationImportChunkMatch = /^\/projects\/([^/]+)\/conversation-import-sessions\/([^/]+)\/chunks\/(\d+)$/.exec(pathname)
  const conversationImportCompleteMatch = /^\/projects\/([^/]+)\/conversation-import-sessions\/([^/]+)\/complete$/.exec(pathname)
  const manualConversationImportMatch = /^\/projects\/([^/]+)\/conversations\/import-manual$/.exec(pathname)
  const conversationsListMatch = /^\/projects\/([^/]+)\/conversations$/.exec(pathname)
  const conversationOneMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)$/.exec(pathname)
  const conversationExportMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)\/export$/.exec(pathname)
  const conversationMessagesMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)\/messages$/.exec(pathname)
  const conversationSearchMatch = /^\/projects\/([^/]+)\/conversations\/search$/.exec(pathname)
  const conversationSectionsMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)\/sections$/.exec(pathname)
  const conversationSectionsRefreshMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)\/sections\/refresh$/.exec(pathname)
  const conversationSectionOneMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)\/sections\/([^/]+)$/.exec(pathname)
  const conversationSectionSourceMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)\/sections\/([^/]+)\/source$/.exec(pathname)
  const conversationSectionAnnotateMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)\/sections\/([^/]+)\/annotation$/.exec(pathname)
  const conversationMessagePinMatch = /^\/projects\/([^/]+)\/conversations\/([^/]+)\/messages\/([^/]+)\/pin$/.exec(pathname)
  const conversationSemanticMatch = /^\/projects\/([^/]+)\/conversations\/semantic-index$/.exec(pathname)
  if (
    conversationImportCreateMatch === null && conversationImportOneMatch === null
    && conversationImportChunkMatch === null && conversationImportCompleteMatch === null
    && manualConversationImportMatch === null && conversationsListMatch === null
    && conversationOneMatch === null && conversationExportMatch === null
    && conversationMessagesMatch === null && conversationSearchMatch === null
    && conversationSectionsMatch === null && conversationSectionsRefreshMatch === null
    && conversationSectionOneMatch === null && conversationSectionSourceMatch === null
    && conversationSectionAnnotateMatch === null && conversationMessagePinMatch === null
    && conversationSemanticMatch === null
  ) {
    return false
  }

  const { sendJson, failure, readJsonBody, readRawBody } = ctx.helpers
  const requireConversations = (): ConversationImportService | undefined => {
    if (conversations === undefined) sendJson(response, 503, failure('UNAVAILABLE', '对话上下文服务暂不可用。'))
    return conversations
  }
  const routeProject = (match: RegExpExecArray): string | undefined => {
    const projectId = decodeURIComponent(match[1] ?? '')
    const metadata = routeRequireMetadata(ctx)
    if (metadata === undefined || routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return undefined
    return projectId
  }

  if (method === 'POST' && conversationImportCreateMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationImportCreateMatch); if (projectId === undefined) return true
    const body = await readJsonBody(request, controller.signal) as CreateConversationImportSessionInputV1
    try { sendJson(response, 201, { ok: true, value: await service.createImportSession(projectId, body) }) }
    catch (error: unknown) { sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : '无法创建对话导入任务。')) }
    return true
  }
  if (method === 'GET' && conversationImportOneMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationImportOneMatch); if (projectId === undefined) return true
    const value = service.getImportSession(projectId, decodeURIComponent(conversationImportOneMatch[2] ?? ''))
    sendJson(response, value === undefined ? 404 : 200, value === undefined ? failure('NOT_FOUND', '对话导入任务不存在。') : { ok: true, value })
    return true
  }
  if (method === 'PUT' && conversationImportChunkMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationImportChunkMatch); if (projectId === undefined) return true
    const bytes = await readRawBody(request, controller.signal, 4 * 1024 * 1024)
    try {
      const value = await service.appendChunk(projectId, decodeURIComponent(conversationImportChunkMatch[2] ?? ''), Number(conversationImportChunkMatch[3]), bytes, typeof request.headers['x-content-sha256'] === 'string' ? request.headers['x-content-sha256'] : undefined)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) { sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : '对话分片上传失败。')) }
    return true
  }
  if (method === 'POST' && conversationImportCompleteMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationImportCompleteMatch); if (projectId === undefined) return true
    const body = await readJsonBody(request, controller.signal) as CompleteConversationImportInputV1
    try { sendJson(response, 201, { ok: true, value: await service.completeImport(projectId, decodeURIComponent(conversationImportCompleteMatch[2] ?? ''), body) }) }
    catch (error: unknown) { sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : '对话导入失败。')) }
    return true
  }
  if (method === 'POST' && manualConversationImportMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(manualConversationImportMatch); if (projectId === undefined) return true
    const body = await readJsonBody(request, controller.signal) as ImportManualConversationInputV1
    try { sendJson(response, 201, { ok: true, value: await service.importManual(projectId, body) }) }
    catch (error: unknown) { sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : '手动时间线导入失败。')) }
    return true
  }
  if (method === 'GET' && conversationsListMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationsListMatch); if (projectId === undefined) return true
    sendJson(response, 200, { ok: true, value: service.list(projectId) }); return true
  }
  if (method === 'GET' && conversationSearchMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationSearchMatch); if (projectId === undefined) return true
    const query = url.searchParams.get('q') ?? ''
    const semantic = url.searchParams.get('semantic') !== 'false'
    try { sendJson(response, 200, { ok: true, value: await service.search(projectId, query, { semantic, limit: Number(url.searchParams.get('limit') ?? 20), ...(url.searchParams.get('model') ? { model: url.searchParams.get('model')! } : {}) }) }) }
    catch (error: unknown) { sendJson(response, 400, failure('INVALID_ARGUMENT', error instanceof Error ? error.message : '对话搜索失败。')) }
    return true
  }
  // 必须在 conversationOneMatch（/conversations/:id）之前匹配：否则
  // /conversations/semantic-index 会被当成「对话 ID = semantic-index」抢走，
  // 导致语义索引 GET/POST 永远 404「对话不存在」。
  if (conversationSemanticMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationSemanticMatch); if (projectId === undefined) return true
    if (method === 'GET') { sendJson(response, 200, { ok: true, value: service.getSemanticIndexStatus(projectId) }); return true }
    if (method === 'POST') {
      try { sendJson(response, 202, { ok: true, value: service.queueSemanticIndex(projectId, await readJsonBody(request, controller.signal) as BuildConversationSemanticIndexInputV1) }) }
      catch (error: unknown) { sendJson(response, 503, failure('UNAVAILABLE', error instanceof Error ? error.message : '语义索引暂不可用。')) }
      return true
    }
  }
  if (method === 'GET' && conversationExportMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationExportMatch); if (projectId === undefined) return true
    try { sendJson(response, 200, { ok: true, value: service.exportConversation(projectId, decodeURIComponent(conversationExportMatch[2] ?? ''), url.searchParams.get('includeMessages') !== 'false') }) }
    catch (error: unknown) { sendJson(response, 404, failure('NOT_FOUND', error instanceof Error ? error.message : '对话不存在。')) }
    return true
  }
  if (method === 'GET' && conversationOneMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationOneMatch); if (projectId === undefined) return true
    const value = service.getProjection(projectId, decodeURIComponent(conversationOneMatch[2] ?? ''))
    sendJson(response, value === undefined ? 404 : 200, value === undefined ? failure('NOT_FOUND', '对话不存在。') : { ok: true, value }); return true
  }
  if (method === 'GET' && conversationMessagesMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationMessagesMatch); if (projectId === undefined) return true
    const conversationId = decodeURIComponent(conversationMessagesMatch[2] ?? '')
    if (service.getProjection(projectId, conversationId) === undefined) { sendJson(response, 404, failure('NOT_FOUND', '对话不存在。')); return true }
    sendJson(response, 200, { ok: true, value: service.getMessages(conversationId, { offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 100), pinnedOnly: url.searchParams.get('pinnedOnly') === 'true' }) }); return true
  }
  if (method === 'POST' && conversationSectionsRefreshMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationSectionsRefreshMatch); if (projectId === undefined) return true
    try { sendJson(response, 200, { ok: true, value: service.refreshSections(projectId, decodeURIComponent(conversationSectionsRefreshMatch[2] ?? '')) }) }
    catch (error: unknown) { sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : '章节重新整理失败。')) }
    return true
  }
  if (conversationSectionsMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationSectionsMatch); if (projectId === undefined) return true
    const conversationId = decodeURIComponent(conversationSectionsMatch[2] ?? '')
    try {
      const value = method === 'POST' ? service.refreshSections(projectId, conversationId) : method === 'GET' ? service.getSections(conversationId) : undefined
      if (value === undefined) { sendJson(response, 405, failure('INVALID_ARGUMENT', '不支持的章节操作。')); return true }
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) { sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : '章节操作失败。')) }
    return true
  }
  if ((method === 'GET' || method === 'PATCH') && conversationSectionOneMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationSectionOneMatch); if (projectId === undefined) return true
    const conversationId = decodeURIComponent(conversationSectionOneMatch[2] ?? ''); const sectionId = decodeURIComponent(conversationSectionOneMatch[3] ?? '')
    try {
      const value = method === 'PATCH' ? service.updateSection(projectId, conversationId, sectionId, await readJsonBody(request, controller.signal) as { title?: string; lockedByUser?: boolean }) : service.getSections(conversationId).find((item) => item.id === sectionId)
      sendJson(response, value === undefined ? 404 : 200, value === undefined ? failure('NOT_FOUND', '章节不存在。') : { ok: true, value })
    } catch (error: unknown) { sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : '章节更新失败。')) }
    return true
  }
  if (method === 'GET' && conversationSectionSourceMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationSectionSourceMatch); if (projectId === undefined) return true
    const conversationId = decodeURIComponent(conversationSectionSourceMatch[2] ?? '')
    if (service.getProjection(projectId, conversationId) === undefined) { sendJson(response, 404, failure('NOT_FOUND', '对话不存在。')); return true }
    try { sendJson(response, 200, { ok: true, value: service.getSectionSource(conversationId, decodeURIComponent(conversationSectionSourceMatch[3] ?? '')) }) }
    catch (error: unknown) { sendJson(response, 404, failure('NOT_FOUND', error instanceof Error ? error.message : '章节不存在。')) }
    return true
  }
  if (method === 'POST' && conversationSectionAnnotateMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationSectionAnnotateMatch); if (projectId === undefined) return true
    try { sendJson(response, 200, { ok: true, value: service.annotateSection(projectId, decodeURIComponent(conversationSectionAnnotateMatch[2] ?? ''), decodeURIComponent(conversationSectionAnnotateMatch[3] ?? ''), await readJsonBody(request, controller.signal) as AnnotateConversationSectionInputV1) }) }
    catch (error: unknown) { sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : '章节标注失败。')) }
    return true
  }
  if (method === 'POST' && conversationMessagePinMatch !== null) {
    const service = requireConversations(); if (service === undefined) return true
    const projectId = routeProject(conversationMessagePinMatch); if (projectId === undefined) return true
    try { sendJson(response, 201, { ok: true, value: await service.pinMessage(projectId, decodeURIComponent(conversationMessagePinMatch[2] ?? ''), decodeURIComponent(conversationMessagePinMatch[3] ?? ''), await readJsonBody(request, controller.signal) as PinConversationMessageInputV1) }) }
    catch (error: unknown) { sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : '无法提升为决策节点。')) }
    return true
  }
  return false
}
