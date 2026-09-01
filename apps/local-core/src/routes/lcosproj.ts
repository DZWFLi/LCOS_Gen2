import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import type { ProjectId } from '@local-creative-os/domain'
import { LcosprojService } from '../lcosproj-service.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'
import { parseMultipartImport } from './multipart.js'

export interface LcosprojRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly maxLcosprojBodyBytes: number
}

/**
 * /lcosproj/* 与 /projects/:id/export-lcosproj* —— .lcosproj 工程文件导入导出。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleLcosprojRoute(ctx: LcosprojRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, url, metadata, maxLcosprojBodyBytes } = ctx
  const { sendJson, failure, readJsonBody, readRawBody, sendBinary, isRecord, isStringArray } = ctx.helpers

  const exportLcosprojDownloadMatch = /^\/projects\/([^/]+)\/export-lcosproj-file$/.exec(pathname)
  if (method === 'GET' && exportLcosprojDownloadMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(exportLcosprojDownloadMatch[1] ?? '') as ProjectId
    const project = routeRequireProject(String(projectId), { metadata: db, response, helpers: ctx.helpers })
    if (project === undefined) return true
    const tempRoot = await mkdtemp(join(tmpdir(), 'lcosproj-export-'))
    const safeName = `${project.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'}.lcosproj`
    const targetPath = join(tempRoot, safeName)
    try {
      await new LcosprojService(db).exportProject(projectId, targetPath)
      sendBinary(response, 200, await readFile(targetPath), safeName, 'application/vnd.local-creative-os.project')
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Export failed.'))
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
    return true
  }

  if (method === 'POST' && pathname === '/lcosproj/open-upload') {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const tempRoot = await mkdtemp(join(tmpdir(), 'lcosproj-open-'))
    try {
      const raw = await readRawBody(request, controller.signal, maxLcosprojBodyBytes)
      const multipart = parseMultipartImport(request.headers['content-type'], raw)
      if (!/\.lcosproj$/i.test(multipart.file.fileName)) {
        sendJson(response, 400, failure('INVALID_ARGUMENT', '请选择 .lcosproj 工程文件。'))
        return true
      }
      const safeName = basename(multipart.file.fileName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'project.lcosproj'
      const filePath = join(tempRoot, safeName)
      await writeFile(filePath, multipart.file.bytes, { flag: 'wx' })
      sendJson(response, 200, { ok: true, value: await new LcosprojService(db).open(filePath) })
    } catch (error: unknown) {
      sendJson(response, error instanceof RangeError ? 413 : 409, failure(error instanceof RangeError ? 'INVALID_ARGUMENT' : 'CONFLICT', error instanceof Error ? error.message : 'Open failed.'))
    } finally {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
    return true
  }

  const exportLcosprojMatch = /^\/projects\/([^/]+)\/export-lcosproj$/.exec(pathname)
  if (method === 'POST' && exportLcosprojMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const projectId = decodeURIComponent(exportLcosprojMatch[1] ?? '') as ProjectId
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || typeof input.targetPath !== 'string' || !isAbsolute(input.targetPath)
      || Object.keys(input).some((key) => key !== 'targetPath')) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Export requires an absolute targetPath.'))
      return true
    }
    try {
      sendJson(response, 201, {
        ok: true,
        value: await new LcosprojService(db).exportProject(projectId, input.targetPath),
      })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Export failed.'))
    }
    return true
  }

  const lcosprojOpenMatch = /^\/lcosproj\/open$/.exec(pathname)
  if (method === 'POST' && lcosprojOpenMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || typeof input.filePath !== 'string' || !isAbsolute(input.filePath)
      || (input.rootPath !== undefined && (typeof input.rootPath !== 'string' || !isAbsolute(input.rootPath)))
      || Object.keys(input).some((key) => !['filePath', 'rootPath'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Open requires an absolute filePath and optional absolute rootPath.'))
      return true
    }
    try {
      sendJson(response, 200, {
        ok: true,
        value: await new LcosprojService(db).open(
          input.filePath,
          typeof input.rootPath === 'string' ? input.rootPath : undefined,
        ),
      })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Open failed.'))
    }
    return true
  }

  const lcosprojInspectMatch = /^\/lcosproj\/inspect$/.exec(pathname)
  if (method === 'GET' && lcosprojInspectMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const filePath = url.searchParams.get('file')
    if (filePath === null || !isAbsolute(filePath)) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Inspect requires an absolute file query param.'))
      return true
    }
    try {
      sendJson(response, 200, { ok: true, value: new LcosprojService(db).inspect(filePath) })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Inspect failed.'))
    }
    return true
  }

  const lcosprojExportAllMatch = /^\/lcosproj\/export-all$/.exec(pathname)
  if (method === 'POST' && lcosprojExportAllMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input) || typeof input.targetDir !== 'string' || !isAbsolute(input.targetDir)
      || (input.projectIds !== undefined && !isStringArray(input.projectIds))
      || Object.keys(input).some((key) => !['targetDir', 'projectIds'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', 'Export-all requires an absolute targetDir.'))
      return true
    }
    try {
      sendJson(response, 201, {
        ok: true,
        value: await new LcosprojService(db).exportAll(
          input.targetDir,
          input.projectIds === undefined ? undefined : input.projectIds as string[],
        ),
      })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Export-all failed.'))
    }
    return true
  }

  return false
}
