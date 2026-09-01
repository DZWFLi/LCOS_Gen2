import type { SearchEntityTypeV0 } from '@local-creative-os/contracts'

import type { CurationQueryService } from '../curation-query-service.js'
import type { CurationCommandService } from '../curation-command-service.js'
import type { ProjectSearchService } from '../project-search-service.js'
import type { SessionReadSet } from '../session-read-set.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import type { RouteHttpContext, RouteHttpHelpers } from './route-context.js'

export interface CurationRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly curation: CurationQueryService | undefined
  readonly curationCommand: CurationCommandService | undefined
  readonly search: ProjectSearchService | undefined
  readonly sessionReadSet: SessionReadSet
}

function titleForEntity(metadata: SqliteMetadataRepository, entityType: string, entityId: string): string {
  if (entityType === 'artifact') return metadata.getArtifact(entityId)?.title ?? entityId
  if (entityType === 'note') return metadata.getNote(entityId)?.body.slice(0, 80) ?? entityId
  if (entityType === 'workspace') return metadata.getWorkspace(entityId)?.name ?? entityId
  if (entityType === 'scope') return metadata.get(entityId === '' ? '' : metadata.getProject(entityId)?.id ?? '')?.scopes.find((scope) => scope.id === entityId)?.name ?? entityId
  if (entityType === 'view') {
    const view = metadata.getArtifactView(entityId)
    return view === undefined ? entityId : metadata.getArtifact(String(view.artifactId))?.title ?? entityId
  }
  return entityId
}

/**
 * Phase D routes: bounded curation read, 1-hop related, federated search.
 */
export async function handleCurationRoute(ctx: CurationRouteContext): Promise<boolean> {
  const { method, pathname, url, request, response, controller, metadata, curation, curationCommand, search, sessionReadSet } = ctx
  const { sendJson, failure, readJsonBody } = ctx.helpers

  const readMatch = /^\/projects\/([^/]+)\/curation\/read$/.exec(pathname)
  const relatedMatch = /^\/projects\/([^/]+)\/related$/.exec(pathname)
  const searchMatch = /^\/projects\/([^/]+)\/search$/.exec(pathname)
  const applyMatch = /^\/projects\/([^/]+)\/curation\/apply$/.exec(pathname)
  const textMatch = /^\/projects\/([^/]+)\/curation\/text$/.exec(pathname)
  if (readMatch === null && relatedMatch === null && searchMatch === null && applyMatch === null && textMatch === null) return false
  if (metadata === undefined) return false

  if (readMatch !== null && method === 'POST') {
    if (curation === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Curation query service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(readMatch[1] ?? '')
    const body = await readJsonBody(request, controller.signal) as { viewIds?: string[]; budget?: { maxItems?: number; maxCharsPerItem?: number; maxTotalChars?: number }; sessionId?: string; readMode?: 'full' | 'preview' }
    if (!Array.isArray(body?.viewIds) || body.viewIds.some((id) => typeof id !== 'string')) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'viewIds must be an array of strings.'))
      return true
    }
    try {
      const value = await curation.readViews(projectId, body.viewIds, body.budget)
      // HU-2: readMode=full 且未截断 → 记录 read lease（search/snippet/preview 不记录）
      if (body.readMode === 'full' && typeof body.sessionId === 'string' && !value.truncated) {
        for (const node of value.nodes) {
          if (node.truncated || node.currentRevisionId === undefined) continue
          const artifactId = node.stableRef.startsWith('artifact:') ? node.stableRef.slice('artifact:'.length) : undefined
          if (artifactId === undefined) continue
          const revision = metadata?.getArtifactRevision(node.currentRevisionId)
          sessionReadSet.recordFullRead({
            sessionId: body.sessionId,
            projectId,
            artifactId,
            revisionId: node.currentRevisionId,
            ...(revision === undefined ? {} : { contentHash: String(revision.contentHash) }),
          })
        }
      }
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Curation read failed.'))
    }
    return true
  }

  if (relatedMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(relatedMatch[1] ?? '')
    const entityType = url.searchParams.get('entityType')
    const entityId = url.searchParams.get('entityId')
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get('limit') ?? 10) || 10))
    if (entityType === null || entityId === null) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'related requires entityType and entityId.'))
      return true
    }
    const relations = metadata.getRelations(projectId).filter((relation) =>
      (String(relation.sourceEntityType) === entityType && String(relation.sourceEntityId) === entityId)
      || (String(relation.targetEntityType) === entityType && String(relation.targetEntityId) === entityId))
    const items = relations.slice(0, limit).map((relation) => {
      const isSource = String(relation.sourceEntityType) === entityType && String(relation.sourceEntityId) === entityId
      const otherType = isSource ? relation.targetEntityType : relation.sourceEntityType
      const otherId = isSource ? String(relation.targetEntityId) : String(relation.sourceEntityId)
      return {
        relationId: String(relation.id),
        kind: relation.kind,
        entityType: otherType,
        entityId: otherId,
        title: titleForEntity(metadata, otherType, otherId),
        origin: 'domain',
      }
    })
    sendJson(response, 200, { ok: true, value: { items, totalMatches: relations.length, truncated: relations.length > limit } })
    return true
  }

  if (searchMatch !== null && method === 'GET') {
    if (search === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Search service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(searchMatch[1] ?? '')
    const query = url.searchParams.get('q') ?? ''
    const limitRaw = url.searchParams.get('limit')
    const typesRaw = url.searchParams.get('types')
    // F6 P0-A4：usedHereTarget 投影参数（?usedHereTarget=workspace:<id>；read projection）。
    const usedHereRaw = url.searchParams.get('usedHereTarget')
    let usedHereTarget: { readonly kind: 'workspace' | 'scope' | 'conversation'; readonly id: string } | undefined
    if (usedHereRaw !== null && usedHereRaw !== '') {
      const separator = usedHereRaw.indexOf(':')
      const kind = separator > 0 ? usedHereRaw.slice(0, separator) : ''
      const id = separator > 0 ? usedHereRaw.slice(separator + 1) : ''
      if (['workspace', 'scope', 'conversation'].includes(kind) && id !== '') {
        usedHereTarget = { kind: kind as 'workspace' | 'scope' | 'conversation', id }
      }
    }
    const types = typesRaw === null
      ? undefined
      : typesRaw.split(',').map((value) => value.trim()).filter((value): value is SearchEntityTypeV0 =>
        ['artifact', 'note', 'conversation', 'resource', 'file'].includes(value))
    const value = await search.search(projectId, query, {
      ...(limitRaw === null ? {} : { limit: Number(limitRaw) || 10 }),
      ...(types === undefined || types.length === 0 ? {} : { types }),
      ...(usedHereTarget === undefined ? {} : { usedHereTarget }),
    })
    sendJson(response, 200, { ok: true, value })
    return true
  }

  if (applyMatch !== null && method === 'POST') {
    if (curationCommand === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Curation command service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(applyMatch[1] ?? '')
    const body = await readJsonBody(request, controller.signal) as { operationId?: string; schemaVersion?: number; projectId?: string; scopeId?: string; createTexts?: unknown[]; relations?: unknown[]; presentation?: unknown }
    if (body?.schemaVersion !== 0 || typeof body.scopeId !== 'string' || !Array.isArray(body.createTexts) || !Array.isArray(body.relations)) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Curation patch requires schemaVersion 0, scopeId, createTexts and relations.'))
      return true
    }
    try {
      const value = await curationCommand.applyPatch(projectId, body as never)
      sendJson(response, value.applied ? 200 : 422, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Curation patch failed.'))
    }
    return true
  }

  if (textMatch !== null && (method === 'POST' || method === 'PUT')) {
    if (curationCommand === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', 'Curation command service is not configured.'))
      return true
    }
    const projectId = decodeURIComponent(textMatch[1] ?? '')
    const body = await readJsonBody(request, controller.signal) as { scopeId?: string; title?: string; body?: string; viewId?: string; artifactId?: string; sessionId?: string; x?: number; y?: number }
    if (typeof body.body !== 'string' || body.body.trim() === '') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'body is required.'))
      return true
    }
    try {
      if (method === 'POST') {
        const value = await curationCommand.createText(projectId, { scopeId: body.scopeId ?? '', ...(body.title === undefined ? {} : { title: body.title }), body: body.body, ...(typeof body.sessionId === 'string' && body.sessionId !== '' ? { sessionId: body.sessionId } : {}), ...(typeof body.x === 'number' && Number.isFinite(body.x) ? { x: body.x } : {}), ...(typeof body.y === 'number' && Number.isFinite(body.y) ? { y: body.y } : {}) })
        sendJson(response, 200, { ok: true, value })
        return true
      }
      // HU-2: Agent update 必须有 full-read lease（用户 GUI 直编不带 sessionId，走内部 CAS）
      // HU-2b（任务三第二刀）：guard 已下沉 mutation 层（CurationCommandService.updateText），
      // route 只保留参数/存在性 precheck，并把拒绝结果以结构化 conflicts + conflictHint 返回（message 前缀向后兼容）。
      if (typeof body.sessionId === 'string') {
        const artifactId = body.artifactId ?? (body.viewId === undefined ? undefined : metadata.getArtifactView(body.viewId)?.artifactId)
        if (artifactId === undefined) {
          sendJson(response, 400, failure('INVALID_ARGUMENT', 'update-text requires viewId or artifactId.'))
          return true
        }
        if (metadata.getArtifact(String(artifactId)) === undefined) {
          sendJson(response, 404, failure('NOT_FOUND', 'Artifact not found.'))
          return true
        }
      }
      const outcome = await curationCommand.updateText(projectId, { ...(body.viewId === undefined ? {} : { viewId: body.viewId }), ...(body.artifactId === undefined ? {} : { artifactId: body.artifactId }) }, body.body, { ...(typeof body.sessionId === 'string' ? { sessionId: body.sessionId } : {}) })
      if (outcome.outcome === 'rejected') {
        const head = outcome.conflicts[0]
        if (head === undefined) {
          sendJson(response, 409, failure('VALIDATION', 'Curation write rejected without conflicts.'))
          return true
        }
        const message = head.reason === 'not-read'
          ? `NO_READ_CURRENT_REVISION artifactId=${head.artifactId} currentRevisionId=${head.currentRevisionId ?? ''}; instruction: reread current body before writing.`
          : `STALE_ARTIFACT_REVISION artifactId=${head.artifactId} leased=${head.expectedRevisionId ?? ''} current=${head.currentRevisionId ?? ''}; instruction: reread current body, reconcile, retry.`
        sendJson(response, 409, { ...failure('VALIDATION', message), value: { conflicts: outcome.conflicts, conflictHint: outcome.conflictHint } })
        return true
      }
      sendJson(response, 200, { ok: true, value: { artifactId: outcome.artifactId, viewId: outcome.viewId, revisionId: outcome.revisionId, legacyMigrated: outcome.legacyMigrated } })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Text curation failed.'))
    }
    return true
  }
  return false
}
