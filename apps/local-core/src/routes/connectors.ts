import { createHash } from 'node:crypto'
import type { ProjectId } from '@local-creative-os/domain'
import type { ResourceConnectorRegistry } from '../connectors/connector-port.js'
import type { ObsidianConnectorSessionStore, ObsidianReadOnlyConnector } from '../connectors/obsidian-connector.js'
import type { DirectoryPickerResult } from '../native-directory-picker.js'
import type { UniversalResourceImportService } from '../resources/universal-resource-import-service.js'
import { routeRequireMetadata, routeRequireProject, type RouteHttpContext, type RouteHttpHelpers } from './route-context.js'
import { publicResourceImportResult } from './resources.js'

export interface ConnectorsRouteContext extends RouteHttpContext {
  readonly helpers: RouteHttpHelpers
  readonly connectorRegistry: ResourceConnectorRegistry
  readonly obsidian: ObsidianReadOnlyConnector
  readonly obsidianSessions: ObsidianConnectorSessionStore
  readonly resources: UniversalResourceImportService | undefined
  readonly directoryPicker: (input: { readonly title: string }) => Promise<DirectoryPickerResult>
}

/**
 * /system/select-directory、/connectors、Obsidian 扫描/导入。
 * 原为 server.ts 分发器内联块，外迁后行为不变。
 */
export async function handleConnectorsRoute(ctx: ConnectorsRouteContext): Promise<boolean> {
  const { method, pathname, request, response, controller, metadata, connectorRegistry, obsidian, obsidianSessions, resources, directoryPicker } = ctx
  const { sendJson, failure, readJsonBody, isRecord, isStringArray } = ctx.helpers

  if (method === 'POST' && pathname === '/system/select-directory') {
    const body = await readJsonBody(request, controller.signal) as { title?: unknown }
    const title = typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : '选择项目目录'
    const result = await directoryPicker({ title })
    sendJson(response, 200, { ok: true, value: result })
    return true
  }

  if (method === 'GET' && pathname === '/connectors') {
    sendJson(response, 200, { ok: true, value: connectorRegistry.capabilities() })
    return true
  }

  if (method === 'POST' && pathname === '/connectors/obsidian/select-and-scan') {
    const selected = await directoryPicker({ title: '选择 Obsidian Vault' })
    if (selected.cancelled || selected.path === undefined) {
      sendJson(response, 200, { ok: true, value: null })
      return true
    }
    try {
      const scanned = await obsidian.scan(selected.path)
      sendJson(response, 200, { ok: true, value: obsidianSessions.create(selected.path, scanned) })
    } catch (error: unknown) {
      sendJson(response, 400, failure('VALIDATION', error instanceof Error ? error.message : 'Obsidian Vault 扫描失败。'))
    }
    return true
  }

  const obsidianImportMatch = /^\/projects\/([^/]+)\/connectors\/obsidian\/import$/.exec(pathname)
  if (method === 'POST' && obsidianImportMatch !== null) {
    const db = routeRequireMetadata(ctx); if (db === undefined) return true
    if (resources === undefined) {
      sendJson(response, 503, failure('UNAVAILABLE', '通用资源导入服务暂不可用。'))
      return true
    }
    const projectId = decodeURIComponent(obsidianImportMatch[1] ?? '')
    if (routeRequireProject(projectId, { metadata: db, response, helpers: ctx.helpers }) === undefined) return true
    const input = await readJsonBody(request, controller.signal)
    if (!isRecord(input)
      || typeof input.scanId !== 'string'
      || !isStringArray(input.relativePaths)
      || input.relativePaths.length < 1 || input.relativePaths.length > 200
      || typeof input.scopeId !== 'string'
      || !isRecord(input.position) || typeof input.position.x !== 'number' || typeof input.position.y !== 'number'
      || Object.keys(input).some((key) => !['scanId', 'relativePaths', 'scopeId', 'position'].includes(key))) {
      sendJson(response, 400, failure('INVALID_ARGUMENT', '请选择 1–200 个 Obsidian Markdown 笔记。'))
      return true
    }
    const stored = obsidianSessions.get(input.scanId)
    if (stored === undefined) {
      sendJson(response, 410, failure('NOT_FOUND', 'Obsidian 扫描已过期，请重新选择 Vault。'))
      return true
    }
    const allowedPaths = new Set(stored.scan.notes.map((note) => note.relativePath))
    const relativePaths = [...new Set(input.relativePaths)]
    if (relativePaths.some((path) => !allowedPaths.has(path))) {
      sendJson(response, 400, failure('VALIDATION', '选中的笔记不属于本次 Obsidian 扫描。'))
      return true
    }
    try {
      const imported = []
      for (let index = 0; index < relativePaths.length; index += 1) {
        const relativePath = relativePaths[index] as string
        const note = await obsidian.read(stored.rootPath, relativePath)
        const identity = `obsidian-${createHash('sha256').update(projectId).update('\0').update(stored.scan.vaultName).update('\0').update(relativePath).update('\0').update(note.contentHash).digest('hex').slice(0, 24)}`
        const outcome = await resources.importFile(projectId as ProjectId, {
          importRequestId: identity,
          fileName: relativePath.replace(/[\/]+/g, '--'),
          contentType: 'text/markdown',
          bytes: note.bytes,
          scopeId: input.scopeId,
          position: {
            x: input.position.x + (index % 4) * 250,
            y: input.position.y + Math.floor(index / 4) * 180,
          },
        })
        imported.push(publicResourceImportResult(outcome))
      }
      sendJson(response, 201, { ok: true, value: imported })
    } catch (error: unknown) {
      sendJson(response, 409, failure('CONFLICT', error instanceof Error ? error.message : 'Obsidian 笔记导入失败。'))
    }
    return true
  }

  return false
}
