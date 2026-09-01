import type { RuntimeApplicationService } from './runtime-application-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * 零点击回收（7.1）：周期同步非终态 Run，Agent submit 后 LCOS 自动 ingest 到 Review。
 */
export class RuntimeAutoSyncService {
  private timer: ReturnType<typeof setInterval> | undefined
  private syncing = false

  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly application: RuntimeApplicationService | undefined,
    private readonly intervalMs = 10_000,
  ) {}

  start(): void {
    if (this.timer !== undefined || this.application === undefined) return
    this.timer = setInterval(() => { void this.tick() }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  async tick(): Promise<void> {
    if (this.syncing || this.application === undefined) return
    this.syncing = true
    try {
      const runs = this.repository.listRunsNeedingSync()
      for (const run of runs) {
        try {
          await this.application.sync(run.id)
        } catch {
          // 单 Run 失败不影响其他 Run；错误留在 Run/事件日志。
        }
      }
    } finally {
      this.syncing = false
    }
  }
}
