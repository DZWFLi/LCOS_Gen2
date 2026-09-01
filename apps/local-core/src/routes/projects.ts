import { readFile } from 'node:fs/promises'
import type {
  CommandDraftV1,
  ContractError,
  MutationBatch,
  ProjectCatalog,
  ProjectGraphSnapshot,
  ProviderSessionBindingV1,
  ValidateProjectRootInput,
} from '@local-creative-os/contracts'
import type { ProjectId } from '@local-creative-os/domain'
import { createProjectRoot, rollbackCreatedProjectRoot, validateProjectRoot } from '../project-root.js'
import { indexProjectRoot, inspectProjectRoot } from '../project-root-indexer.js'
import {
  formatMetadataRouteError,
  routeRequireMetadata,
  routeRequireProject,
  type RouteHttpContext,
  type RouteHttpHelpers,
} from './route-context.js'

export interface ProjectsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly catalog: ProjectCatalog
  readonly allowedRoot: string | undefined
  readonly maxDocumentPreviewBytes: number
  readonly createProjectIdFn: (name: string) => string
}

/**
 * /projects*、/project-roots/*、/metadata/status、/projects/:id/graph、
 * command-drafts、provider-sessions、file-records/:id/content。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleProjectsRoute(ctx: ProjectsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, url, catalog, allowedRoot, maxDocumentPreviewBytes, createProjectIdFn } = ctx
  const { sendJson, failure, readJsonBody, withAbort, statusForError, isRecord, isStringArray } = ctx.helpers

  if (method === 'GET' && pathname === '/projects') {
    const result = ctx.metadata === undefined
      ? await withAbort(catalog.list(controller.signal), controller.signal)
      : { ok: true as const, value: ctx.metadata.listProjects().map((p) => ({
          id: p.id,
          name: p.name,
          rootPath: p.rootPath,
          ...(p.lastOpenedAt === undefined ? {} : { lastOpenedAt: p.lastOpenedAt }),
        })) }
    sendJson(response, result.ok ? 200 : statusForError(result.error.code), result)
    return true
  }

  if (method === 'GET' && pathname === '/metadata/status') {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    sendJson(response, 200, {
      ok: true,
      value: { schemaVersion: metadata.schemaVersion, databasePath: metadata.databasePath, metadataOnly: true },
    })
    return true
  }

  if (method === 'POST' && pathname === '/project-roots/validate') {
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 64 KiB.'))
      return true
    }
    if (typeof input !== 'object' || input === null || !('rootPath' in input) || typeof input.rootPath !== 'string') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'rootPath must be a string.'))
      return true
    }
    const result = await withAbort(
      validateProjectRoot((input as ValidateProjectRootInput).rootPath, {
        signal: controller.signal,
        ...(allowedRoot === undefined ? {} : { allowedRoot }),
      }),
      controller.signal,
    )
    sendJson(response, result.ok ? 200 : statusForError(result.error.code), result)
    return true
  }

  if (method === 'POST' && pathname === '/project-roots/inspect') {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const rootPath = typeof input === 'object' && input !== null && 'rootPath' in input ? (input as { rootPath?: unknown }).rootPath : undefined
    if (typeof rootPath !== 'string' || rootPath.trim() === '') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'rootPath must be a non-empty string.'))
      return true
    }
    const validated = await validateProjectRoot(rootPath, { signal: controller.signal, ...(allowedRoot === undefined ? {} : { allowedRoot }) })
    if (!validated.ok) { sendJson(response, statusForError(validated.error.code), validated); return true }
    try {
      const inspection = await inspectProjectRoot(validated.value.normalizedPath, controller.signal)
      sendJson(response, 200, { ok: true, value: inspection })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Project root inspection failed.'))
    }
    return true
  }

  if (method === 'POST' && pathname === '/projects') {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON under 64 KiB.'))
      return true
    }
    const body = input as { name?: unknown; intent?: unknown; rootPath?: unknown; parentPath?: unknown; directoryName?: unknown; importExisting?: unknown }
    if (typeof body?.name !== 'string' || body.name.trim() === '' || body.name.length > 120) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'name must be a non-empty string under 120 characters.'))
      return true
    }
    const intent = body.intent === 'create' ? 'create' : body.intent === 'open' || body.intent === undefined ? 'open' : undefined
    if (intent === undefined) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'intent must be create or open.'))
      return true
    }
    if (intent === 'open' && (typeof body.rootPath !== 'string' || body.rootPath.trim() === '' || body.rootPath.length > 1024)) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Open Project requires an existing rootPath.'))
      return true
    }
    if (intent === 'create' && (typeof body.parentPath !== 'string' || typeof body.directoryName !== 'string')) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Create Project requires parentPath and directoryName.'))
      return true
    }
    const root = intent === 'create'
      ? await createProjectRoot(body.parentPath as string, body.directoryName as string, { signal: controller.signal, ...(allowedRoot === undefined ? {} : { allowedRoot }) })
      : await withAbort(validateProjectRoot(body.rootPath as string, { signal: controller.signal, ...(allowedRoot === undefined ? {} : { allowedRoot }) }), controller.signal)
    if (!root.ok) {
      sendJson(response, statusForError(root.error.code), root)
      return true
    }
    const name = body.name.trim()
    const projectId = createProjectIdFn(name)
    try {
      metadata.createProject({
        id: projectId as ProjectId,
        name,
        rootPath: root.value.normalizedPath,
      })
      if (intent === 'open') metadata.touchProjectOpened(projectId as ProjectId, new Date().toISOString())
      if (intent === 'open' && body.importExisting === true) {
        const initial = metadata.get(projectId)
        if (initial === undefined) throw new Error('Created Project could not be reloaded for indexing.')
        metadata.save(await indexProjectRoot(initial, controller.signal))
      }
      sendJson(response, 201, {
        ok: true,
        value: { id: projectId, name, rootPath: root.value.normalizedPath, graphVersion: 1 },
      })
    } catch (error: unknown) {
      if (metadata.getProject(projectId) !== undefined) metadata.deleteProject(projectId)
      if (intent === 'create') await rollbackCreatedProjectRoot(root.value.normalizedPath)
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Project could not be created.'))
    }
    return true
  }

  const projectDeleteMatch = /^\/projects\/([^/]+)$/.exec(pathname)
  if (method === 'DELETE' && projectDeleteMatch !== null) {
    const metadata = routeRequireMetadata(ctx)
    if (metadata === undefined) return true
    const projectId = decodeURIComponent(projectDeleteMatch[1] ?? '')
    if (metadata.getProject(projectId) === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Project not found.'))
      return true
    }
    metadata.deleteProject(projectId)
    sendJson(response, 200, {
      ok: true,
      value: { deleted: true, projectId, note: '项目已从 LCOS 移除；源文件与 .lcosproj 工程文件保留在磁盘。' },
    })
    return true
  }

  const graphMatch = /^\/projects\/([^/]+)\/graph$/.exec(pathname)
  const railOrderMatch = /^\/projects\/([^/]+)\/view-rail-order$/.exec(pathname)
  if (method === 'GET' && railOrderMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(railOrderMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const stored = metadata.getProjectViewRailOrder(projectId)
    const workspaceIds = new Set(metadata.getWorkspaces(projectId).map((workspace) => String(workspace.id)))
    const scopeIds = new Set(metadata.getScopes(projectId).map((scope) => String(scope.id)))
    const orderedRefs = (stored?.orderedRefs ?? []).filter((ref) => workspaceIds.has(ref.viewId) || scopeIds.has(ref.viewId))
    sendJson(response, 200, {
      ok: true,
      value: {
        projectId,
        orderedRefs,
        version: stored?.version ?? 0,
        updatedAt: stored?.updatedAt ?? '',
      },
    })
    return true
  }
  if (method === 'PUT' && railOrderMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    const projectId = decodeURIComponent(railOrderMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    if (typeof input !== 'object' || input === null
      || !Array.isArray((input as { orderedRefs?: unknown }).orderedRefs)
      || typeof (input as { expectedVersion?: unknown }).expectedVersion !== 'number') {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'View rail order requires orderedRefs array and expectedVersion.'))
      return true
    }
    const expectedVersion = (input as { expectedVersion: number }).expectedVersion
    const seen = new Set<string>()
    const orderedRefs = (input as { orderedRefs: unknown[] }).orderedRefs.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return []
      const kind = String((item as { kind?: unknown }).kind)
      const viewId = (item as { viewId?: unknown }).viewId
      if (typeof viewId !== 'string' || !['scene', 'collection', 'context', 'workflow'].includes(kind)) return []
      const key = `${kind}:${viewId}`
      if (seen.has(key)) return []
      seen.add(key)
      return [{ kind: kind as 'scene' | 'collection' | 'context' | 'workflow', viewId }]
    })
    try {
      const value = metadata.saveProjectViewRailOrder(projectId, orderedRefs, expectedVersion)
      sendJson(response, 200, { ok: true, value })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'View rail order conflicted.'))
    }
    return true
  }
  if (method === 'GET' && graphMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(graphMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const snapshot = metadata.get(projectId)
    sendJson(response, 200, { ok: true, value: snapshot })
    return true
  }
  if (method === 'PUT' && graphMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (typeof input !== 'object' || input === null || !('snapshot' in input) || typeof input.snapshot !== 'object' || input.snapshot === null) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'A project snapshot is required.'))
      return true
    }
    const saveInput = input as { snapshot: ProjectGraphSnapshot }
    const projectId = decodeURIComponent(graphMatch[1] ?? '')
    if (String(saveInput.snapshot.project.id) !== projectId) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Route project id must match snapshot project id.'))
      return true
    }
    try {
      metadata.save(saveInput.snapshot)
      sendJson(response, 200, { ok: true, value: metadata.get(projectId) })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', formatMetadataRouteError(error, 'Metadata could not be saved.')))
    }
    return true
  }
  if (method === 'POST' && graphMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    let input: unknown
    try { input = await readJsonBody(request, controller.signal) } catch {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Request body must be valid JSON.'))
      return true
    }
    if (typeof input !== 'object' || input === null || !('baseVersion' in input) || !('ops' in input) || !Array.isArray((input as { ops: unknown }).ops)) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'A mutation batch with baseVersion and ops is required.'))
      return true
    }
    const batch = input as unknown as MutationBatch
    const projectId = decodeURIComponent(graphMatch[1] ?? '')
    try {
      const graphVersion = metadata.applyMutations(batch, projectId)
      sendJson(response, 200, { ok: true, value: { appliedOps: batch.ops.length, graphVersion } })
    } catch (error: unknown) {
      const msg = formatMetadataRouteError(error, 'Mutations could not be applied.')
      const code = (error instanceof Error && 'code' in error) ? String((error as unknown as Record<string, unknown>).code) : undefined
      if (code === 'STALE_GRAPH_VERSION') {
        sendJson(response, 409, { ok: false, error: { code: 'STALE_GRAPH_VERSION' as ContractError['code'], message: msg, retryable: true, origin: 'runtime' as const } })
      } else {
        sendJson(response, 400, failure('VALIDATION', msg))
      }
    }
    return true
  }

  const documentPreviewMatch = /^\/projects\/([^/]+)\/file-records\/([^/]+)\/content$/.exec(pathname)
  if (method === 'GET' && documentPreviewMatch !== null) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(documentPreviewMatch[1] ?? '')
    const fileRecordId = decodeURIComponent(documentPreviewMatch[2] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const fileRecord = metadata.getFileRecord(fileRecordId)
    if (fileRecord === undefined || String(fileRecord.projectId) !== projectId) {
      sendJson(response, 404, failure('NOT_FOUND', 'FileRecord not found in Project.'))
      return true
    }
    if (fileRecord.availability !== 'current') {
      sendJson(response, 409, failure('CONFLICT', `File is ${fileRecord.availability}.`))
      return true
    }
    if (fileRecord.size > maxDocumentPreviewBytes) {
      sendJson(response, 413, failure('VALIDATION', `Document preview is limited to ${Math.floor(maxDocumentPreviewBytes / 1024 / 1024)} MiB.`))
      return true
    }
    try {
      const bytes = await withAbort(readFile(fileRecord.observedPath), controller.signal)
      response.writeHead(200, {
        'content-type': fileRecord.mimeType,
        'content-length': String(bytes.byteLength),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      response.end(bytes)
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Document could not be read.'))
    }
    return true
  }

  const commandDraftMatch = /^\/projects\/([^/]+)\/command-drafts\/([^/]+)$/.exec(pathname)
  if (commandDraftMatch !== null && ['GET', 'PUT', 'DELETE'].includes(method)) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(commandDraftMatch[1] ?? '')
    const composerAnchor = decodeURIComponent(commandDraftMatch[2] ?? '')
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    const workspaceParam = url.searchParams.get('workspaceId')
    const workspaceId = workspaceParam === null || workspaceParam === '' ? null : workspaceParam
    if (method === 'GET') {
      sendJson(response, 200, { ok: true, value: metadata.getCommandDraft(projectId, workspaceId, composerAnchor) ?? null })
      return true
    }
    if (method === 'DELETE') {
      metadata.deleteCommandDraft(projectId, workspaceId, composerAnchor)
      sendJson(response, 200, { ok: true, value: { deleted: true } })
      return true
    }
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input)
      || !['main', 'context', 'workflow', 'conversation'].includes(String(input.surfaceKind))
      || (input.surfaceId !== null && typeof input.surfaceId !== 'string')
      || typeof input.prompt !== 'string' || input.prompt.length > 200_000
      || !isStringArray(input.contextViewIds)
      || !isStringArray(input.selectionViewIds)
      || (input.receiverId !== null && typeof input.receiverId !== 'string')
      || typeof input.provider !== 'string'
      || typeof input.createAsNewNode !== 'boolean'
      || !['analyze', 'create', 'revise'].includes(String(input.intent))
      || !['reply_only', 'create_artifact', 'create_collection', 'draft_revision_per_target'].includes(String(input.resultPolicy))
      || (input.workspaceId !== undefined && input.workspaceId !== null && typeof input.workspaceId !== 'string')
      || Object.keys(input).some((key) => !['workspaceId', 'surfaceKind', 'surfaceId', 'prompt', 'contextViewIds', 'selectionViewIds', 'receiverId', 'provider', 'createAsNewNode', 'intent', 'resultPolicy'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Command Draft requires one shared Surface / Selection / Receiver / Reference / Prompt state.'))
      return true
    }
    const value: CommandDraftV1 = {
      schemaVersion: 1,
      projectId,
      workspaceId: input.workspaceId === undefined ? workspaceId : input.workspaceId as string | null,
      composerAnchor,
      surfaceKind: input.surfaceKind as CommandDraftV1['surfaceKind'],
      surfaceId: input.surfaceId as string | null,
      prompt: input.prompt,
      contextViewIds: input.contextViewIds,
      selectionViewIds: input.selectionViewIds,
      receiverId: input.receiverId as string | null,
      provider: input.provider,
      createAsNewNode: input.createAsNewNode,
      intent: input.intent as CommandDraftV1['intent'],
      resultPolicy: input.resultPolicy as CommandDraftV1['resultPolicy'],
      updatedAt: new Date().toISOString(),
    }
    metadata.saveCommandDraft(value)
    sendJson(response, 200, { ok: true, value })
    return true
  }

  const providerSessionMatch = /^\/projects\/([^/]+)\/provider-sessions\/(codex|workbuddy)$/.exec(pathname)
  if (providerSessionMatch !== null && ['GET', 'PUT', 'DELETE'].includes(method)) {
    const metadata = routeRequireMetadata(ctx); if (metadata === undefined) return true
    const projectId = decodeURIComponent(providerSessionMatch[1] ?? '')
    const provider = providerSessionMatch[2] as 'codex' | 'workbuddy'
    if (routeRequireProject(projectId, { metadata, response, helpers: ctx.helpers }) === undefined) return true
    if (method === 'GET') {
      sendJson(response, 200, { ok: true, value: metadata.getProviderSessionBinding(projectId, provider) ?? null })
      return true
    }
    if (method === 'DELETE') {
      metadata.deleteProviderSessionBinding(projectId, provider)
      sendJson(response, 200, { ok: true, value: { deleted: true } })
      return true
    }
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input)
      || typeof input.externalSessionId !== 'string' || input.externalSessionId.length < 1 || input.externalSessionId.length > 256
      || !['manual', 'watchdog'].includes(String(input.origin))
      || !['active', 'stale', 'closed'].includes(String(input.status))
      || (input.lastRunId !== undefined && typeof input.lastRunId !== 'string')
      || (input.leaseOwner !== undefined && typeof input.leaseOwner !== 'string')
      || (input.leaseExpiresAt !== undefined && typeof input.leaseExpiresAt !== 'string')
      || (input.failureCount !== undefined && (!Number.isInteger(input.failureCount) || Number(input.failureCount) < 0))
      || Object.keys(input).some((key) => !['externalSessionId', 'origin', 'status', 'lastSeenAt', 'lastRunId', 'leaseOwner', 'leaseExpiresAt', 'failureCount'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Provider Session Binding is invalid.'))
      return true
    }
    const now = new Date().toISOString()
    const value: ProviderSessionBindingV1 = {
      projectId,
      provider,
      externalSessionId: input.externalSessionId,
      origin: input.origin as ProviderSessionBindingV1['origin'],
      status: input.status as ProviderSessionBindingV1['status'],
      lastSeenAt: typeof input.lastSeenAt === 'string' ? input.lastSeenAt : now,
      ...(typeof input.lastRunId === 'string' ? { lastRunId: input.lastRunId } : {}),
      ...(typeof input.leaseOwner === 'string' ? { leaseOwner: input.leaseOwner } : {}),
      ...(typeof input.leaseExpiresAt === 'string' ? { leaseExpiresAt: input.leaseExpiresAt } : {}),
      failureCount: typeof input.failureCount === 'number' ? input.failureCount : 0,
      updatedAt: now,
    }
    metadata.saveProviderSessionBinding(value)
    sendJson(response, 200, { ok: true, value })
    return true
  }

  return false
}
