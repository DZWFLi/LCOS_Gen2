import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CaptureStagingItemV0 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { CaptureStagingService } from './capture-staging-service.js'
import { createProjectRoot, rollbackCreatedProjectRoot } from './project-root.js'
import type { UniversalResourceImportService } from './resources/universal-resource-import-service.js'
import { createTextArtifact } from './text-artifact-service.js'

/**
 * Phase 5 §8.11：从暂存区创建项目（重启安全/幂等由 operationId→项目归属保证）。
 * 默认项目目录：$LCOS_PROJECTS_DIR 或 ~/.lcos/projects。
 */
export class StagingProjectService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly staging: CaptureStagingService,
    private readonly resources: UniversalResourceImportService,
    private readonly blobRoot: string,
  ) {}

  async createProject(input: {
    readonly captureIds: readonly string[]
    readonly titleMode: 'auto'
    readonly parentPath?: string
  }): Promise<{ readonly projectId: string; readonly name: string; readonly rootPath: string; readonly imported: number }> {
    if (input.captureIds.length === 0) throw new Error('create-project requires at least one capture id.')
    const items = input.captureIds.map((id) => this.metadata.getCaptureStagingItem(id))
    if (items.some((item) => item === undefined)) throw new Error('One or more capture ids do not exist.')
    const resolved = (items as CaptureStagingItemV0[]).filter((item) => item.resolvedProjectId !== undefined)
    if (resolved.length > 0) throw new Error('Selected captures already belong to a project.')

    const first = (items as CaptureStagingItemV0[])[0]!
    const sourceTitle = String((first.source as { title?: string })?.title ?? '').trim()
    const name = sourceTitle || `${items.length} 个捕获`
    const directoryName = name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, '-').slice(0, 60) || `captures-${Date.now().toString(36)}`
    const parentPath = input.parentPath ?? process.env.LCOS_PROJECTS_DIR ?? join(homedir(), '.lcos', 'projects')
    await mkdir(parentPath, { recursive: true })
    const root = await createProjectRoot(parentPath, directoryName, {})
    if (!root.ok) throw new Error(root.error.message)
    const projectId = `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    let imported = 0
    try {
      this.metadata.createProject({ id: projectId as never, name, rootPath: root.value.normalizedPath })
      const scopeId = `scope-${projectId}-root`
      let index = 0
      for (const item of items as CaptureStagingItemV0[]) {
        await this.#importItem(projectId, scopeId, item, index)
        imported += 1
        this.staging.resolve(item.id, projectId)
        index += 1
      }
      return { projectId, name, rootPath: root.value.normalizedPath, imported }
    } catch (error) {
      try { this.metadata.deleteProject(projectId) } catch { /* best-effort cleanup */ }
      await rollbackCreatedProjectRoot(root.value.normalizedPath).catch(() => undefined)
      throw error
    }
  }

  async #importItem(projectId: string, scopeId: string, item: CaptureStagingItemV0, index: number): Promise<void> {
    const position = { x: 120 + (index % 4) * 280, y: 120 + Math.floor(index / 4) * 200 }
    const ref = item.payloadRef
    if (ref.startsWith('http://') || ref.startsWith('https://')) {
      await this.resources.importUrl(projectId as never, {
        importRequestId: item.operationId,
        url: ref,
        ...(String((item.source as { title?: string })?.title ?? '').trim() === '' ? {} : { title: String((item.source as { title?: string })?.title).trim() }),
        scopeId: scopeId as never,
        position,
      })
      return
    }
    if (ref.startsWith('blob:')) {
      const hash = ref.slice('blob:'.length)
      const bytes = await readFile(join(this.blobRoot, hash))
      if (item.kind === 'clipboard_text' || item.kind === 'web_selection') {
        await createTextArtifact(this.metadata, projectId as never, {
          title: String((item.source as { title?: string })?.title ?? '捕获文本'),
          body: bytes.toString('utf8'),
          scopeId: scopeId as never,
          x: position.x,
          y: position.y,
        })
        return
      }
      await this.resources.importFile(projectId as never, {
        importRequestId: item.operationId,
        fileName: `${item.kind}-${hash.slice(0, 8)}.png`,
        contentType: 'image/png',
        bytes,
        scopeId: scopeId as never,
        position,
      })
      return
    }
    // 本地路径（CLI --file 进暂存）
    const bytes = await readFile(ref)
    await this.resources.importFile(projectId as never, {
      importRequestId: item.operationId,
      fileName: ref.split(/[\\/]/).at(-1) ?? 'capture.bin',
      contentType: 'application/octet-stream',
      bytes,
      scopeId: scopeId as never,
      position,
    })
  }
}
