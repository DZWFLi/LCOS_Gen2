import { watch, type FSWatcher } from 'node:fs'

import type { FileObservationService } from './file-observation-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * 常驻 Watcher（红区 DATA-05 / 11.3 失败矩阵）：
 * 监听每个 Project Root 的文件变化，去抖后刷新 FileRecord 可用性（stale/missing/unreadable）。
 * 零新依赖：使用 node:fs.watch（Windows 支持 recursive）。
 */
export class ProjectWatcherService {
  readonly #watchers = new Map<string, FSWatcher>()
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>()
  readonly #watchedProjects = new Set<string>()
  #catalogTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly observation: FileObservationService,
    private readonly debounceMs = 600,
    private readonly catalogPollMs = 60_000,
  ) {}

  start(): void {
    this.refreshProjectList()
    this.#catalogTimer = setInterval(() => this.refreshProjectList(), this.catalogPollMs)
    this.#catalogTimer.unref?.()
  }

  stop(): void {
    if (this.#catalogTimer !== undefined) clearInterval(this.#catalogTimer)
    this.#catalogTimer = undefined
    for (const [projectId, timer] of this.#timers) clearTimeout(timer)
    this.#timers.clear()
    for (const watcher of this.#watchers.values()) watcher.close()
    this.#watchers.clear()
    this.#watchedProjects.clear()
  }

  /** 全量同步项目清单：新项目自动加监听，已删除项目解除监听。 */
  refreshProjectList(): void {
    const projects = this.repository.listProjects()
    const current = new Set(projects.map((project) => String(project.id)))
    for (const projectId of current) {
      if (this.#watchedProjects.has(projectId)) continue
      const project = projects.find((item) => String(item.id) === projectId)
      if (project === undefined) continue
      this.#attach(projectId, project.rootPath)
    }
    for (const projectId of [...this.#watchedProjects]) {
      if (current.has(projectId)) continue
      this.#detach(projectId)
    }
  }

  async refreshProject(projectId: string): Promise<void> {
    const records = this.repository.getFileRecords(projectId)
    for (const record of records) {
      try {
        await this.observation.refresh(record.id)
      } catch {
        // 单文件刷新失败不影响其他文件；错误由 FileRecord.availability 表达。
      }
    }
  }

  #attach(projectId: string, rootPath: string): void {
    let watcher: FSWatcher
    try {
      watcher = watch(rootPath, { recursive: true }, () => this.#schedule(projectId))
    } catch {
      try {
        watcher = watch(rootPath, () => this.#schedule(projectId))
      } catch {
        return
      }
    }
    this.#watchers.set(projectId, watcher)
    this.#watchedProjects.add(projectId)
    watcher.on('error', () => this.#detach(projectId))
  }

  #detach(projectId: string): void {
    const watcher = this.#watchers.get(projectId)
    if (watcher !== undefined) {
      watcher.close()
      this.#watchers.delete(projectId)
    }
    const timer = this.#timers.get(projectId)
    if (timer !== undefined) clearTimeout(timer)
    this.#timers.delete(projectId)
    this.#watchedProjects.delete(projectId)
  }

  #schedule(projectId: string): void {
    const existing = this.#timers.get(projectId)
    if (existing !== undefined) clearTimeout(existing)
    this.#timers.set(projectId, setTimeout(() => {
      this.#timers.delete(projectId)
      void this.refreshProject(projectId)
    }, this.debounceMs))
  }
}
