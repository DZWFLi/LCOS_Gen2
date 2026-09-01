import type { ProjectId } from '@local-creative-os/domain'
import { isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import { openRegisteredPath, revealRegisteredFile, resolveShortcutTarget } from '../os-integration.js'
import { ExecutionItemService } from '../execution-item-service.js'
import { ProcessProjectionService } from '../process-projection-service.js'
import { RuntimeRevisionCompareService } from '../runtime-revision-compare-service.js'
import { routeRequireMetadata, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'

export interface ArtifactsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly agentletRuntime?: import('../agentlet-runtime-service.js').AgentletRuntimeService | undefined
}

/**
 * artifacts 搜索/详情、revisions 列表/对比、process-projection。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleArtifactsRoute(ctx: ArtifactsRouteContext): Promise<boolean> {
  const { method, pathname, url, request, controller, response, metadata, agentletRuntime } = ctx
  const { sendJson, failure, readJsonBody, isRecord } = ctx.helpers

  const sourceActionMatch = /^\/artifacts\/([^/]+)\/(open|reveal|source-path|relink|shortcut-resolve)$/.exec(pathname)
  if (sourceActionMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const artifactId = decodeURIComponent(sourceActionMatch[1] ?? '')
    const action = sourceActionMatch[2]
    const artifact = db.getArtifact(artifactId)
    if (artifact === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Artifact not found.'))
      return true
    }
    const source = db.getArtifactSourcePath(artifactId)

    if (action === 'source-path' && method === 'GET') {
      if (source === undefined) {
        sendJson(response, 404, failure('NOT_FOUND', 'Artifact source path unavailable.'))
        return true
      }
      sendJson(response, 200, { ok: true, value: source })
      return true
    }

    if (action === 'open' && method === 'POST') {
      if (source === undefined || source.isUrl || source.path === '') {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Artifact has no openable local source path.'))
        return true
      }
      const result = await openRegisteredPath(source.path)
      if (!result.ok) sendJson(response, 500, failure('INTERNAL', result.error ?? 'Failed to open source.'))
      else sendJson(response, 200, { ok: true, value: { opened: true, path: source.path } })
      return true
    }

    if (action === 'reveal' && method === 'POST') {
      if (source === undefined || source.isUrl || source.path === '') {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Artifact has no local source to reveal.'))
        return true
      }
      const result = await revealRegisteredFile(source.path)
      if (!result.ok) sendJson(response, 500, failure('INTERNAL', result.error ?? 'Failed to reveal source.'))
      else sendJson(response, 200, { ok: true, value: { revealed: true, path: source.path } })
      return true
    }

    if (action === 'shortcut-resolve' && method === 'POST') {
      if (source === undefined || source.isUrl || !source.path.toLocaleLowerCase('en-US').endsWith('.lnk')) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Shortcut resolution requires a local .lnk source.'))
        return true
      }
      sendJson(response, 200, { ok: true, value: await resolveShortcutTarget(source.path) })
      return true
    }

    if (action === 'relink' && method === 'POST') {
      const input = await readJsonBody(request, controller.signal)
      if (!isRecord(input) || typeof input.path !== 'string' || input.path.trim() === '' || !isAbsolute(input.path.trim()) || !existsSync(input.path.trim())) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', 'Relink requires an existing absolute local path.'))
        return true
      }
      const relinked = db.relinkArtifactSource(artifactId, input.path.trim())
      if (!relinked) sendJson(response, 404, failure('NOT_FOUND', 'Artifact not found.'))
      else sendJson(response, 200, { ok: true, value: { relinked: true, path: input.path.trim() } })
      return true
    }

    sendJson(response, 405, failure('INVALID_ARGUMENT', `Unsupported source action ${action}.`))
    return true
  }

  const artifactSearchMatch = /^\/projects\/([^/]+)\/artifacts\/search$/.exec(pathname)
  if (method === 'GET' && artifactSearchMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(artifactSearchMatch[1] ?? '') as ProjectId
    const query = (url.searchParams.get('q') ?? '').trim().toLocaleLowerCase('en-US')
    const matches = db.getArtifacts(String(projectId))
      .filter((artifact) => query.length === 0 || artifact.title.toLocaleLowerCase('en-US').includes(query))
      .slice(0, 50)
    sendJson(response, 200, { ok: true, value: matches })
    return true
  }

  const artifactDetailMatch = /^\/artifacts\/([^/]+)$/.exec(pathname)
  if (method === 'GET' && artifactDetailMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const artifactId = decodeURIComponent(artifactDetailMatch[1] ?? '')
    const artifact = db.getArtifact(artifactId)
    if (artifact === undefined) {
      sendJson(response, 404, failure('NOT_FOUND', 'Artifact not found.'))
      return true
    }
    const revisions = db.getArtifactRevisions(artifactId)
    const runById = new Map(
      db.getProjectRuns(artifact.projectId, 100).map((run) => [String(run.id), run]),
    )
    sendJson(response, 200, {
      ok: true,
      value: {
        artifact,
        currentRevisionId: artifact.currentRevisionId,
        revisions: revisions.map((revision) => ({
          id: String(revision.id),
          status: revision.status,
          source: revision.source,
          createdAt: revision.createdAt,
          ...(revision.runId === undefined ? {} : {
            run: {
              id: String(revision.runId),
              instruction: runById.get(String(revision.runId))?.instruction ?? null,
              provider: runById.get(String(revision.runId))?.provider ?? null,
            },
          }),
        })),
      },
    })
    return true
  }

  const revisionListMatch = /^\/artifacts\/([^/]+)\/revisions$/.exec(pathname)
  if (method === 'GET' && revisionListMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const artifactId = decodeURIComponent(revisionListMatch[1] ?? '')
    sendJson(response, 200, { ok: true, value: db.getArtifactRevisions(artifactId) })
    return true
  }

  const revisionCompareMatch = /^\/projects\/([^/]+)\/revisions\/compare$/.exec(pathname)
  if (method === 'GET' && revisionCompareMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const base = url.searchParams.get('base')
    const head = url.searchParams.get('head')
    if (base === null || head === null) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Compare requires base and head revision ids.'))
      return true
    }
    try {
      sendJson(response, 200, {
        ok: true,
        value: await new RuntimeRevisionCompareService(db).compare(base, head),
      })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Compare failed.'))
    }
    return true
  }

  const processProjectionMatch = /^\/projects\/([^/]+)\/process-projection$/.exec(pathname)
  if (method === 'GET' && processProjectionMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(processProjectionMatch[1] ?? '') as ProjectId
    sendJson(response, 200, {
      ok: true,
      value: new ProcessProjectionService(db).project(projectId),
    })
    return true
  }

  // S1: ExecutionItemV1 统一执行读模型（availableActions 由 capability × state 推导，单一来源 Core）
  const executionItemsMatch = /^\/projects\/([^/]+)\/execution-items$/.exec(pathname)
  if (method === 'GET' && executionItemsMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(executionItemsMatch[1] ?? '') as ProjectId
    sendJson(response, 200, {
      ok: true,
      value: new ExecutionItemService(db, agentletRuntime).project(projectId),
    })
    return true
  }

  return false
}
