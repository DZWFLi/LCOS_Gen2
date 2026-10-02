import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CollectionMembership } from '@local-creative-os/domain'
import type { MutationSafetyService } from '../mutation-safety-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { isRecord, routeRequireProject, type RouteHttpHelpers } from './route-context.js'
import { parseProjectEventOrigin } from './project-events.js'
import { readCollectionMemberPreviews } from '../collection-preview.js'

export interface CollectionsRouteContext {
  readonly method: string
  readonly pathname: string
  readonly request: IncomingMessage
  readonly response: ServerResponse
  readonly signal: AbortSignal
  readonly metadata: SqliteMetadataRepository | undefined
  readonly mutationSafety: MutationSafetyService | undefined
  readonly helpers: RouteHttpHelpers
}

const MEMBER_TYPES = new Set<CollectionMembership['memberRef']['type']>([
  'artifact', 'note', 'collection', 'scope', 'workspace', 'conversation', 'run',
])

export async function handleCollectionsRoute(ctx: CollectionsRouteContext): Promise<boolean> {
  const collectionMatch = /^\/projects\/([^/]+)\/collections(?:\/([^/]+))?(?:\/members)?$/.exec(ctx.pathname)
  if (collectionMatch === null) return false
  if (ctx.metadata === undefined || ctx.mutationSafety === undefined) {
    ctx.helpers.sendJson(ctx.response, 503, ctx.helpers.failure('UNAVAILABLE', 'Collection service is not configured.'))
    return true
  }
  const projectId = decodeURIComponent(collectionMatch[1] ?? '')
  const collectionId = collectionMatch[2] === undefined ? undefined : decodeURIComponent(collectionMatch[2])
  const isMembersRoute = ctx.pathname.endsWith('/members')
  if (routeRequireProject(projectId, { metadata: ctx.metadata, response: ctx.response, helpers: ctx.helpers }) === undefined) return true

  if (collectionId === undefined && ctx.method === 'GET') {
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: ctx.metadata.listCollections(projectId) })
    return true
  }
  if (collectionId === undefined && ctx.method === 'POST') {
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (!isRecord(raw) || typeof raw.title !== 'string' || !raw.title.trim()) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Collection title is required.'))
      return true
    }
    const members: CollectionMembership['memberRef'][] = []
    if (raw.members !== undefined) {
      if (!Array.isArray(raw.members) || raw.members.some((ref) => !isRecord(ref)
        || typeof ref.type !== 'string' || !MEMBER_TYPES.has(ref.type as CollectionMembership['memberRef']['type'])
        || typeof ref.id !== 'string' || !ref.id.trim())) {
        ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Initial members must be valid project entity references.'))
        return true
      }
      for (const ref of raw.members) members.push({ type: ref.type, id: ref.id })
    }
    try {
      const origin = parseProjectEventOrigin(raw.origin)
      const result = ctx.mutationSafety.createCollection({ projectId, title: raw.title, members, ...(origin === undefined ? {} : { origin }) })
      ctx.helpers.sendJson(ctx.response, 201, { ok: true, value: result.collection, meta: { changeSetId: result.changeSet.id, members: ctx.metadata.listCollectionMemberships(projectId).filter((item) => String(item.collectionId) === String(result.collection.id)).map((item) => item.memberRef) } })
    } catch (error) {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', error instanceof Error ? error.message : 'Collection could not be created.'))
    }
    return true
  }

  if (collectionId === undefined) return false
  const collection = ctx.metadata.getCollection(collectionId)
  if (collection === undefined || String(collection.projectId) !== projectId) {
    ctx.helpers.sendJson(ctx.response, 404, ctx.helpers.failure('NOT_FOUND', 'Collection not found.'))
    return true
  }
  if (ctx.method === 'GET' && !isMembersRoute) {
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: collection })
    return true
  }
  if (ctx.method === 'GET' && isMembersRoute) {
    const members = ctx.metadata.listCollectionMemberships(projectId, collectionId)
    ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: { collection, members,
      previews: readCollectionMemberPreviews(ctx.metadata, projectId, members) } })
    return true
  }
  if (isMembersRoute && (ctx.method === 'POST' || ctx.method === 'DELETE')) {
    let raw: unknown
    try { raw = await ctx.helpers.readJsonBody(ctx.request, ctx.signal) } catch {
      ctx.helpers.sendJson(ctx.response, 400, ctx.helpers.failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (!isRecord(raw) || typeof raw.memberId !== 'string' || typeof raw.memberType !== 'string' || !MEMBER_TYPES.has(raw.memberType as CollectionMembership['memberRef']['type'])) {
      ctx.helpers.sendJson(ctx.response, 422, ctx.helpers.failure('INVALID_ARGUMENT', 'Member must use a supported canonical EntityRef type; view and spatial projection refs are not canonical Collection members.'))
      return true
    }
    const memberRef = { type: raw.memberType as CollectionMembership['memberRef']['type'], id: raw.memberId }
    try {
      const origin = parseProjectEventOrigin(raw.origin)
      const receipt = ctx.method === 'POST'
        ? ctx.mutationSafety.addCollectionMember({ projectId, collectionId, memberRef, ...(origin === undefined ? {} : { origin }) })
        : ctx.mutationSafety.removeCollectionMember({ projectId, collectionId, memberRef, ...(origin === undefined ? {} : { origin }) })
      ctx.helpers.sendJson(ctx.response, 200, { ok: true, value: receipt, meta: receipt.changeSetId === undefined ? undefined : { changeSetId: receipt.changeSetId } })
    } catch (error) {
      ctx.helpers.sendJson(ctx.response, 422, ctx.helpers.failure('VALIDATION', error instanceof Error ? error.message : 'Collection membership could not be changed.'))
    }
    return true
  }
  return false
}
