import { readFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import type { Artifact, ArtifactView, Checkpoint, Note, Workspace } from '@local-creative-os/contracts'
import type { ArtifactRevisionId, FileRecordId, ProjectId } from '@local-creative-os/domain'
import type { FileObservationService } from '../file-observation-service.js'
import type { PreviewWorkerService } from '../preview-worker-service.js'
import type { SqliteMetadataRepository } from '../metadata-repository.js'
import { FORBIDDEN_BROWSER_PATH_FIELDS, isRecord, isStringArray, type RouteHttpHelpers } from './route-context.js'

type RouteResult = { status: number; body: unknown } | undefined

export interface EntityRouteContext {
  readonly method: string
  readonly pathname: string
  readonly metadata: SqliteMetadataRepository | undefined
  /** F6 B6（P1-B census）：破坏性 DELETE 走 MutationSafetyService（ChangeSet-backed）。 */
  readonly mutationSafety: import('../mutation-safety-service.js').MutationSafetyService | undefined
  readonly fileObservation: FileObservationService | undefined
  readonly previewWorker: PreviewWorkerService | undefined
  readonly request: IncomingMessage
  readonly signal: AbortSignal
  readonly helpers: Pick<RouteHttpHelpers, 'failure' | 'readJsonBody'>
}

function belongsToProject(value: unknown, projectId: string): value is Record<string, unknown> {
  return isRecord(value) && value.projectId === projectId && !containsForbiddenPathKey(value)
}

// Relations 路由已整体迁至 routes/relations.ts（ChangeSet-backed）——校验函数随之移除。

function containsForbiddenPathKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenPathKey)
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, child]) => FORBIDDEN_BROWSER_PATH_FIELDS.has(key) || containsForbiddenPathKey(child))
}

export async function handleEntityRoute(ctx: EntityRouteContext): Promise<RouteResult> {
  const { method, pathname, metadata, mutationSafety, fileObservation, previewWorker, request, signal } = ctx
  const { failure, readJsonBody } = ctx.helpers
  // All entity routes require metadata
  if (metadata === undefined) return undefined
  // --- Project ---
  const projectMatch = /^\/projects\/([^/]+)$/.exec(pathname)
  if (projectMatch !== null) {
    const projectId = decodeURIComponent(projectMatch[1] ?? '')
    if (method === 'GET') {
      const project = metadata.getProject(projectId)
      return project === undefined ? { status: 404, body: failure('NOT_FOUND', 'Project not found.') } : { status: 200, body: { ok: true, value: project } }
    }
    return undefined
  }

  // --- Workspaces ---
  const wsListMatch = /^\/projects\/([^/]+)\/workspaces$/.exec(pathname)
  const wsOneMatch = /^\/projects\/([^/]+)\/workspaces\/([^/]+)$/.exec(pathname)
  if (wsListMatch !== null) {
    const projectId = decodeURIComponent(wsListMatch[1] ?? '')
    if (method === 'GET') {
      return { status: 200, body: { ok: true, value: metadata.getWorkspaces(projectId) } }
    }
    if (method === 'POST') {
      const body = await readJsonBody(request, signal)
      if (!belongsToProject(body, projectId) || typeof body.id !== 'string') return { status: 400, body: failure('INVALID_ARGUMENT', 'Workspace identity must match the route project.') }
      const ws = body as unknown as Workspace
      metadata.upsertWorkspace(ws)
      return { status: 200, body: { ok: true, value: ws } }
    }
    return undefined
  }
  if (wsOneMatch !== null) {
    const projectId = decodeURIComponent(wsOneMatch[1] ?? '')
    const wsId = decodeURIComponent(wsOneMatch[2] ?? '')
    if (method === 'GET') {
      const ws = metadata.getWorkspace(wsId)
      return ws === undefined ? { status: 404, body: failure('NOT_FOUND', 'Workspace not found.') } : { status: 200, body: { ok: true, value: ws } }
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request, signal)
      if (!belongsToProject(body, projectId) || body.id !== wsId) return { status: 400, body: failure('INVALID_ARGUMENT', 'Workspace identity must match the route.') }
      metadata.upsertWorkspace(body as unknown as Workspace)
      return { status: 200, body: { ok: true, value: body } }
    }
    return undefined
  }

  // --- Artifacts ---
  const artListMatch = /^\/projects\/([^/]+)\/artifacts$/.exec(pathname)
  const artOneMatch = /^\/projects\/([^/]+)\/artifacts\/([^/]+)$/.exec(pathname)
  if (artListMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(artListMatch[1] ?? '')
    return { status: 200, body: { ok: true, value: metadata.getArtifacts(projectId) } }
  }
  if (artOneMatch !== null) {
    const projectId = decodeURIComponent(artOneMatch[1] ?? '')
    const artId = decodeURIComponent(artOneMatch[2] ?? '')
    if (method === 'GET') {
      const art = metadata.getArtifact(artId)
      return art === undefined ? { status: 404, body: failure('NOT_FOUND', 'Artifact not found.') } : { status: 200, body: { ok: true, value: art } }
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request, signal)
      if (!belongsToProject(body, projectId) || body.id !== artId) return { status: 400, body: failure('INVALID_ARGUMENT', 'Artifact identity must match the route.') }
      metadata.upsertArtifact(body as unknown as Artifact)
      return { status: 200, body: { ok: true, value: body } }
    }
    return undefined
  }

  // --- FileRecords (read-only by ID; refresh accepts only opaque FileRecord IDs; paths are never accepted from Browser) ---
  const fileListMatch = /^\/projects\/([^/]+)\/file-records$/.exec(pathname)
  const fileOneMatch = /^\/file-records\/([^/]+)$/.exec(pathname)
  const fileRefreshMatch = /^\/file-records\/([^/]+)\/refresh$/.exec(pathname)
  const fileAdoptMatch = /^\/file-records\/([^/]+)\/adopt$/.exec(pathname)
  if (fileListMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(fileListMatch[1] ?? '')
    return { status: 200, body: { ok: true, value: metadata.getFileRecords(projectId) } }
  }
  if (fileOneMatch !== null && method === 'GET') {
    const fileRecordId = decodeURIComponent(fileOneMatch[1] ?? '')
    const fileRecord = metadata.getFileRecord(fileRecordId)
    return fileRecord === undefined
      ? { status: 404, body: failure('NOT_FOUND', 'FileRecord not found.') }
      : { status: 200, body: { ok: true, value: fileRecord } }
  }
  if (fileRefreshMatch !== null && method === 'POST') {
    if (fileObservation === undefined) return { status: 503, body: failure('UNAVAILABLE', 'File Observation Service is not configured.') }
    const fileRecordId = decodeURIComponent(fileRefreshMatch[1] ?? '') as FileRecordId
    try {
      const result = await fileObservation.refresh(fileRecordId, signal)
      return { status: 200, body: { ok: true, value: result } }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'File observation failed.'
      return { status: message === 'FileRecord not found.' ? 404 : 400, body: failure(message === 'FileRecord not found.' ? 'NOT_FOUND' : 'VALIDATION', message) }
    }
  }
  if (fileAdoptMatch !== null && method === 'POST') {
    if (fileObservation === undefined) return { status: 503, body: failure('UNAVAILABLE', 'File Observation Service is not configured.') }
    const fileRecordId = decodeURIComponent(fileAdoptMatch[1] ?? '') as FileRecordId
    try {
      const result = await fileObservation.adopt(fileRecordId, signal)
      return { status: 201, body: { ok: true, value: result } }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'External change adoption failed.'
      const notFound = message === 'FileRecord not found.' || message === 'Current Artifact Revision not found.'
      return { status: notFound ? 404 : 409, body: failure(notFound ? 'NOT_FOUND' : 'CONFLICT', message) }
    }
  }

  // --- ArtifactViews ---
  const avListMatch = /^\/projects\/([^/]+)\/artifact-views$/.exec(pathname)
  const avOneMatch = /^\/projects\/([^/]+)\/artifact-views\/([^/]+)$/.exec(pathname)
  if (avListMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(avListMatch[1] ?? '')
    return { status: 200, body: { ok: true, value: metadata.getArtifactViewsByProject(projectId) } }
  }
  if (avOneMatch !== null) {
    const projectId = decodeURIComponent(avOneMatch[1] ?? '')
    const viewId = decodeURIComponent(avOneMatch[2] ?? '')
    if (method === 'GET') {
      const view = metadata.getArtifactView(viewId)
      const artifact = view === undefined ? undefined : metadata.getArtifact(String(view.artifactId))
      return view === undefined || artifact === undefined || String(artifact.projectId) !== projectId
        ? { status: 404, body: failure('NOT_FOUND', 'ArtifactView not found.') }
        : { status: 200, body: { ok: true, value: view } }
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request, signal)
      if (!isRecord(body) || body.id !== viewId || typeof body.artifactId !== 'string' || containsForbiddenPathKey(body)) return { status: 400, body: failure('INVALID_ARGUMENT', 'ArtifactView identity must match the route.') }
      const artifact = metadata.getArtifact(body.artifactId)
      if (artifact === undefined || String(artifact.projectId) !== projectId) return { status: 400, body: failure('INVALID_ARGUMENT', 'ArtifactView Artifact must belong to the route project.') }
      const view = body as unknown as ArtifactView
      metadata.upsertArtifactView(view)
      return { status: 200, body: { ok: true, value: view } }
    }
    if (method === 'DELETE') {
      const existing = metadata.getArtifactView(viewId)
      const artifact = existing === undefined ? undefined : metadata.getArtifact(String(existing.artifactId))
      if (existing === undefined || artifact === undefined || String(artifact.projectId) !== projectId) return { status: 404, body: failure('NOT_FOUND', 'ArtifactView not found.') }
      if (mutationSafety === undefined) return { status: 503, body: failure('UNAVAILABLE', 'Mutation safety service is not configured.') }
      try {
        const changeSet = mutationSafety.deleteArtifactView({ projectId, viewId })
        return { status: 200, body: { ok: true, value: null, meta: { changeSetId: changeSet.id } } }
      } catch (error: unknown) {
        return { status: 409, body: failure('CONFLICT', error instanceof Error ? error.message : 'Artifact view delete failed.') }
      }
    }
    return undefined
  }

  // --- Relations：已由 routes/relations.ts（ChangeSet-backed）全量接管——本段为不可达死代码，B6 清除。 ---

  // --- Notes ---
  const noteListMatch = /^\/projects\/([^/]+)\/notes$/.exec(pathname)
  const noteOneMatch = /^\/projects\/([^/]+)\/notes\/([^/]+)$/.exec(pathname)
  if (noteListMatch !== null) {
    const projectId = decodeURIComponent(noteListMatch[1] ?? '')
    if (method === 'GET') {
      return { status: 200, body: { ok: true, value: metadata.getNotes(projectId) } }
    }
    if (method === 'POST') {
      const body = await readJsonBody(request, signal)
      if (!isNote(body) || String(body.projectId) !== projectId) {
        return { status: 400, body: failure('INVALID_ARGUMENT', 'Note or NoteAnchor is invalid.') }
      }
      metadata.upsertNote(body)
      return { status: 200, body: { ok: true, value: body } }
    }
    return undefined
  }
  if (noteOneMatch !== null) {
    const projectId = decodeURIComponent(noteOneMatch[1] ?? '')
    const noteId = decodeURIComponent(noteOneMatch[2] ?? '')
    if (method === 'GET') {
      const note = metadata.getNote(noteId)
      return note === undefined ? { status: 404, body: failure('NOT_FOUND', 'Note not found.') } : { status: 200, body: { ok: true, value: note } }
    }
    if (method === 'PUT') {
      const body = await readJsonBody(request, signal)
      if (!isNote(body) || String(body.id) !== noteId || String(body.projectId) !== projectId || containsForbiddenPathKey(body)) {
        return { status: 400, body: failure('INVALID_ARGUMENT', 'Note or NoteAnchor is invalid.') }
      }
      metadata.upsertNote(body)
      return { status: 200, body: { ok: true, value: body } }
    }
    if (method === 'DELETE') {
      const existing = metadata.getNote(noteId)
      if (existing === undefined || String(existing.projectId) !== projectId) return { status: 404, body: failure('NOT_FOUND', 'Note not found.') }
      if (mutationSafety === undefined) return { status: 503, body: failure('UNAVAILABLE', 'Mutation safety service is not configured.') }
      try {
        const changeSet = mutationSafety.deleteNote({ projectId, noteId })
        return { status: 200, body: { ok: true, value: null, meta: { changeSetId: changeSet.id } } }
      } catch (error: unknown) {
        return { status: 409, body: failure('CONFLICT', error instanceof Error ? error.message : 'Note delete failed.') }
      }
    }
    return undefined
  }

  // --- ArtifactRevisions ---
  const revListMatch = /^\/artifacts\/([^/]+)\/revisions$/.exec(pathname)
  const revOneMatch = /^\/artifacts\/([^/]+)\/revisions\/([^/]+)$/.exec(pathname)
  if (revListMatch !== null && method === 'GET') {
    const artId = decodeURIComponent(revListMatch[1] ?? '')
    return { status: 200, body: { ok: true, value: metadata.getArtifactRevisions(artId) } }
  }
  if (revOneMatch !== null) {
    const revId = decodeURIComponent(revOneMatch[2] ?? '')
    if (method === 'GET') {
      const rev = metadata.getArtifactRevision(revId)
      return rev === undefined ? { status: 404, body: failure('NOT_FOUND', 'ArtifactRevision not found.') } : { status: 200, body: { ok: true, value: rev } }
    }
    return undefined
  }

  // --- PreviewRecords ---
  const previewListMatch = /^\/projects\/([^/]+)\/preview-records$/.exec(pathname)
  if (previewListMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(previewListMatch[1] ?? '')
    return { status: 200, body: { ok: true, value: metadata.getPreviewRecords(projectId) } }
  }
  const previewContentMatch = /^\/projects\/([^/]+)\/preview-records\/([^/]+)\/content$/.exec(pathname)
  if (previewContentMatch !== null && method === 'GET') {
    const projectId = decodeURIComponent(previewContentMatch[1] ?? '')
    const previewRecordId = decodeURIComponent(previewContentMatch[2] ?? '')
    const record = metadata.getPreviewRecord(previewRecordId)
    if (record === undefined || String(record.projectId) !== projectId) {
      return { status: 404, body: failure('NOT_FOUND', 'PreviewRecord not found.') }
    }
    if (record.status !== 'ready' || record.cachePath === '') {
      return { status: 409, body: failure('UNAVAILABLE', 'PreviewRecord content is not ready.') }
    }
    try {
      const bytes = await readFile(record.cachePath)
      return {
        status: 200,
        body: {
          ok: true,
          value: {
            previewRecordId: record.id,
            mimeType: record.mimeType,
            size: bytes.byteLength,
            encoding: 'base64',
            data: bytes.toString('base64'),
          },
        },
      }
    } catch (error: unknown) {
      return { status: 404, body: failure('NOT_FOUND', error instanceof Error ? error.message : 'Preview cache file not found.') }
    }
  }
  const previewGenerateMatch = /^\/projects\/([^/]+)\/previews$/.exec(pathname)
  if (previewGenerateMatch !== null && method === 'POST') {
    if (previewWorker === undefined) return { status: 503, body: failure('UNAVAILABLE', 'Preview worker is not configured.') }
    const projectId = decodeURIComponent(previewGenerateMatch[1] ?? '')
    const body = await readJsonBody(request, signal)
    if (!isRecord(body) || typeof body.revisionId !== 'string' || typeof body.previewProfile !== 'string'
      || 'path' in body || 'absolutePath' in body) {
      return { status: 400, body: failure('INVALID_ARGUMENT', 'Preview generation requires revisionId and previewProfile only.') }
    }
    try {
      const value = await previewWorker.generate({
        projectId: projectId as ProjectId,
        revisionId: body.revisionId as ArtifactRevisionId,
        previewProfile: body.previewProfile,
        signal,
      })
      return { status: 200, body: { ok: true, value } }
    } catch (error: unknown) {
      const aborted = error instanceof DOMException && error.name === 'AbortError'
      return {
        status: aborted ? 499 : 404,
        body: failure(aborted ? 'ABORTED' : 'NOT_FOUND', error instanceof Error ? error.message : 'Preview generation failed.'),
      }
    }
  }

  // --- Checkpoints ---
  const cpListMatch = /^\/projects\/([^/]+)\/checkpoints$/.exec(pathname)
  const cpOneMatch = /^\/projects\/([^/]+)\/checkpoints\/([^/]+)$/.exec(pathname)
  if (cpListMatch !== null) {
    const projectId = decodeURIComponent(cpListMatch[1] ?? '')
    if (method === 'GET') {
      return { status: 200, body: { ok: true, value: metadata.getCheckpoints(projectId) } }
    }
    if (method === 'POST') {
      const body = await readJsonBody(request, signal)
      if (!isCheckpoint(body) || String(body.projectId) !== projectId) {
        return { status: 400, body: failure('INVALID_ARGUMENT', 'Checkpoint command is invalid.') }
      }
      try {
        metadata.createCheckpoint(body)
        return { status: 201, body: { ok: true, value: body } }
      } catch (error: unknown) {
        return { status: 409, body: failure('VALIDATION', error instanceof Error ? error.message : 'Checkpoint could not be created.') }
      }
    }
    return undefined
  }
  if (cpOneMatch !== null) {
    const cpId = decodeURIComponent(cpOneMatch[2] ?? '')
    if (method === 'GET') {
      const cp = metadata.getCheckpoint(cpId)
      return cp === undefined ? { status: 404, body: failure('NOT_FOUND', 'Checkpoint not found.') } : { status: 200, body: { ok: true, value: cp } }
    }
    return undefined
  }

  return undefined
}

function isNote(value: unknown): value is Note {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.projectId !== 'string'
    || typeof value.body !== 'string' || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string'
    || !isRecord(value.anchor) || typeof value.anchor.type !== 'string') return false
  const anchor = value.anchor
  switch (anchor.type) {
    case 'project':
      return true
    case 'scope':
      return typeof anchor.scopeId === 'string'
    case 'artifact':
      return typeof anchor.artifactId === 'string'
    case 'artifact_view':
      return typeof anchor.viewId === 'string'
    case 'page':
      return typeof anchor.revisionId === 'string'
        && Number.isInteger(anchor.pageIndex)
        && (anchor.pageIndex as number) >= 0
    default:
      return false
  }
}

function isCheckpoint(value: unknown): value is Checkpoint {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.projectId === 'string'
    && typeof value.scopeId === 'string'
    && typeof value.label === 'string'
    && typeof value.createdAt === 'string'
    && 'snapshotJson' in value
}
