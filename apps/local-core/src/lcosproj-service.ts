import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type { ProjectId } from '@local-creative-os/domain'

import { FileObservationService } from './file-observation-service.js'
import { SqliteMetadataRepository } from './metadata-repository.js'

export interface LcosprojMeta {
  readonly projectId: string
  readonly schemaVersion: number
  readonly appVersion: string
  readonly exportedAt: string
  readonly rootHint?: string
  readonly relativePaths: Readonly<Record<string, string>>
}

export interface LcosprojExportResult {
  readonly path: string
  readonly projectId: string
  readonly schemaVersion: number
  readonly exportedAt: string
  readonly size: number
  readonly tables: Readonly<Record<string, number>>
}

export interface LcosprojOpenResult {
  readonly meta: LcosprojMeta
  readonly project: { readonly id: string; readonly name: string; readonly rootPath: string }
  readonly tables: Readonly<Record<string, number>>
  readonly rebound?: { readonly fileRecords: number; readonly current: number; readonly stale: number; readonly missing: number }
}

export interface LcosprojExportAllResult {
  readonly targetDir: string
  readonly exported: readonly LcosprojExportResult[]
  readonly failed: readonly { readonly projectId: string; readonly error: string }[]
}

const LCOSPROJ_SCHEMA_VERSION = 18

export class LcosprojService {
  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly appVersion = '0.9.0',
  ) {}

  async exportProject(projectId: ProjectId, targetPath: string): Promise<LcosprojExportResult> {
    const project = this.repository.getProject(String(projectId))
    if (project === undefined) throw new Error('Project not found.')
    const absoluteTarget = resolve(targetPath)
    await mkdir(dirname(absoluteTarget), { recursive: true })
    // P3：写入中断恢复——清理同目标残留的 .tmp-*（上次崩溃留下的半成品）
    const staleTmp = await readdir(dirname(absoluteTarget)).catch(() => [] as string[])
    const baseName = absoluteTarget.split(/[\\/]/).pop() ?? ''
    for (const name of staleTmp) {
      if (name.startsWith(`${baseName}.tmp-`)) {
        await rm(join(dirname(absoluteTarget), name), { force: true }).catch(() => undefined)
      }
    }
    const tmpPath = `${absoluteTarget}.tmp-${Date.now().toString(36)}`
    try {
      const fileRepository = new SqliteMetadataRepository(tmpPath)
      fileRepository.close()
      const tables = this.repository.exportProjectTruth(projectId, tmpPath)
      // Raw conversation timelines and rebuildable vectors are intentionally not packed by default.
      // Preserve session metadata, rule sections, annotations and user-pinned messages only.
      const conversationDatabase = new DatabaseSync(tmpPath)
      try {
        conversationDatabase.prepare(`
          UPDATE conversation_sessions
          SET source_path = NULL,
              message_count = (SELECT COUNT(*) FROM conversation_messages m WHERE m.session_id = conversation_sessions.id),
              origin_meta_json = json_set(COALESCE(origin_meta_json, '{}'), '$.rawTimelineIncluded', json('false'))
          WHERE project_id = ?
        `).run(String(projectId))
      } finally {
        conversationDatabase.close()
      }
      const relativePaths: Record<string, string> = {}
      for (const record of this.repository.getFileRecords(String(projectId))) {
        relativePaths[String(record.id)] = relative(project.rootPath, record.observedPath).split('\\').join('/')
      }
      const exportedAt = new Date().toISOString()
      const metaDatabase = new DatabaseSync(tmpPath)
      metaDatabase.exec(`
        CREATE TABLE IF NOT EXISTS lcosproj_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          project_id TEXT NOT NULL,
          schema_version INTEGER NOT NULL,
          app_version TEXT NOT NULL,
          exported_at TEXT NOT NULL,
          root_hint TEXT,
          relative_paths TEXT NOT NULL DEFAULT '{}'
        )
      `)
      metaDatabase.prepare(`
        INSERT INTO lcosproj_meta (id, project_id, schema_version, app_version, exported_at, root_hint, relative_paths)
        VALUES (1, ?, ?, ?, ?, ?, ?)
      `).run(
        String(projectId),
        LCOSPROJ_SCHEMA_VERSION,
        this.appVersion,
        exportedAt,
        project.rootPath.split(/[\\/]/).filter(Boolean).pop() ?? null,
        JSON.stringify(relativePaths),
      )
      metaDatabase.close()
      await rename(tmpPath, absoluteTarget)
      const info = await stat(absoluteTarget)
      return {
        path: absoluteTarget,
        projectId: String(projectId),
        schemaVersion: LCOSPROJ_SCHEMA_VERSION,
        exportedAt,
        size: info.size,
        tables,
      }
    } catch (error: unknown) {
      await rm(tmpPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  inspect(filePath: string): LcosprojMeta & { readonly project: { readonly id: string; readonly name: string; readonly rootPath: string } } {
    const meta = this.#readMeta(filePath)
    const fileRepository = new SqliteMetadataRepository(resolve(filePath))
    try {
      const project = fileRepository.getProject(meta.projectId)
      if (project === undefined) throw new Error('.lcosproj 工程文件中没有对应 Project 数据。')
      return {
        ...meta,
        project: { id: String(project.id), name: project.name, rootPath: project.rootPath },
      }
    } finally {
      fileRepository.close()
    }
  }

  async open(filePath: string, rootPath?: string): Promise<LcosprojOpenResult> {
    const meta = this.#readMeta(filePath)
    const absoluteFile = resolve(filePath)
    const tables = this.repository.importProjectTruth(absoluteFile, meta.projectId as ProjectId)
    this.repository.touchProjectOpened(meta.projectId as ProjectId, new Date().toISOString())
    const project = this.repository.getProject(meta.projectId)
    if (project === undefined) throw new Error('.lcosproj 导入后 Project 未落库。')
    let rebound: LcosprojOpenResult['rebound']
    if (rootPath !== undefined) {
      rebound = await this.#rebind(resolve(rootPath), meta.relativePaths)
    }
    return {
      meta,
      project: { id: String(project.id), name: project.name, rootPath: project.rootPath },
      tables,
      ...(rebound === undefined ? {} : { rebound }),
    }
  }

  async exportAll(targetDir: string, projectIds?: readonly string[]): Promise<LcosprojExportAllResult> {
    const absoluteDir = resolve(targetDir)
    await mkdir(absoluteDir, { recursive: true })
    const projects = projectIds === undefined
      ? this.repository.listProjects()
      : projectIds.map((id) => this.repository.getProject(id)).filter((project) => project !== undefined)
    const exported: LcosprojExportResult[] = []
    const failed: { readonly projectId: string; readonly error: string }[] = []
    for (const project of projects) {
      const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'project'
      try {
        exported.push(await this.exportProject(project.id, join(absoluteDir, `${safeName}.lcosproj`)))
      } catch (error: unknown) {
        failed.push({ projectId: String(project.id), error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { targetDir: absoluteDir, exported, failed }
  }

  #readMeta(filePath: string): LcosprojMeta {
    const absoluteFile = resolve(filePath)
    const database = new DatabaseSync(absoluteFile, { readOnly: true })
    try {
      const row = database.prepare('SELECT * FROM lcosproj_meta WHERE id = 1').get() as
        | { project_id: string; schema_version: number; app_version: string; exported_at: string; root_hint: string | null; relative_paths: string }
        | undefined
      if (row === undefined) throw new Error('不是有效的 .lcosproj 工程文件（缺少 lcosproj_meta）。')
      return {
        projectId: String(row.project_id),
        schemaVersion: Number(row.schema_version),
        appVersion: String(row.app_version),
        exportedAt: String(row.exported_at),
        ...(row.root_hint === null ? {} : { rootHint: row.root_hint }),
        relativePaths: JSON.parse(row.relative_paths) as Readonly<Record<string, string>>,
      }
    } finally {
      database.close()
    }
  }

  async #rebind(
    rootPath: string,
    relativePaths: Readonly<Record<string, string>>,
  ): Promise<NonNullable<LcosprojOpenResult['rebound']>> {
    const observation = new FileObservationService(this.repository)
    const summary = { fileRecords: 0, current: 0, stale: 0, missing: 0 }
    for (const [fileRecordId, relativePath] of Object.entries(relativePaths)) {
      const record = this.repository.getFileRecord(fileRecordId)
      if (record === undefined) continue
      const candidate = resolve(rootPath, ...relativePath.split('/'))
      this.repository.upsertFileRecord({ ...record, observedPath: candidate })
      const result = await observation.refresh(record.id)
      summary.fileRecords += 1
      if (result.fileRecord.availability === 'current') summary.current += 1
      else if (result.fileRecord.availability === 'missing') summary.missing += 1
      else summary.stale += 1
    }
    return summary
  }
}
