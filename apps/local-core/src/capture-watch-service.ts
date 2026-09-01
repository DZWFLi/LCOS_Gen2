import { readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { CaptureRequestV0 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'

export interface CaptureWatchRuleV0 {
  readonly id: string
  readonly path: string
  readonly patterns: readonly string[]
  readonly projectHint?: string
  readonly settleMs: number
  readonly enabled: boolean
}

export interface WatchEvent {
  readonly ruleId: string
  readonly path: string
}

/**
 * Phase C (C11/C12)：Screenshot / 文件夹 Capture Watch。
 * 轮询扫描 + settle（文件不再变化才算稳定）→ 交给 CaptureApplicationService。
 * 失败不阻塞扫描（文件可能在写入中）。
 */
export class CaptureWatchService {
  readonly #metadata: SqliteMetadataRepository
  readonly #capture: (request: CaptureRequestV0) => Promise<unknown>
  #timer: NodeJS.Timeout | null = null
  #known: Map<string, { size: number; mtimeMs: number }> = new Map()

  constructor(
    metadata: SqliteMetadataRepository,
    capture: (request: CaptureRequestV0) => Promise<unknown>,
  ) {
    this.#metadata = metadata
    this.#capture = capture
  }

  start(intervalMs = 2_000): void {
    if (this.#timer !== null) return
    this.#timer = setInterval(() => { void this.#scan().catch(() => undefined) }, intervalMs)
    this.#timer.unref?.()
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer)
      this.#timer = null
    }
  }

  listRules(): CaptureWatchRuleV0[] {
    return this.#metadata.listCaptureWatchRules()
  }

  upsertRule(rule: CaptureWatchRuleV0): void {
    this.#metadata.upsertCaptureWatchRule(rule)
  }

  deleteRule(id: string): boolean {
    return this.#metadata.deleteCaptureWatchRule(id)
  }

  async #scan(): Promise<void> {
    for (const rule of this.listRules()) {
      if (!rule.enabled) continue
      try {
        await this.#scanRule(rule)
      } catch { /* 目录暂时不可读就跳过 */ }
    }
  }

  async #scanRule(rule: CaptureWatchRuleV0): Promise<void> {
    const entries = await readdir(rule.path, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (rule.patterns.length > 0 && !rule.patterns.some((pattern) => entry.name.endsWith(pattern.replace(/^\*/, '')))) continue
      const fullPath = join(rule.path, entry.name)
      const fingerprint = await stat(fullPath).catch(() => null)
      if (fingerprint === null) continue
      const known = this.#known.get(fullPath)
      if (known !== undefined && known.size === fingerprint.size && known.mtimeMs === fingerprint.mtimeMs) continue
      // settle：两次扫描之间文件不再变化才算稳定
      this.#known.set(fullPath, { size: fingerprint.size, mtimeMs: fingerprint.mtimeMs })
      const settle = await this.#waitUntilStable(fullPath, rule.settleMs)
      if (settle === null) continue
      if (this.#known.get(fullPath)?.mtimeMs !== settle.mtimeMs) continue
      this.#known.set(fullPath, settle)
      await this.#capture({
        schemaVersion: 0,
        operationId: `watch-${rule.id}-${Date.now()}-${entry.name}`,
        kind: 'local_file',
        ...(rule.projectHint === undefined ? {} : { targetHint: { projectId: rule.projectHint } }),
        source: {
          app: 'lcos-capture-watch',
          title: entry.name,
          capturedAt: new Date().toISOString(),
        },
        payload: { type: 'local_path', path: fullPath },
      }).catch(() => undefined)
    }
  }

  async #waitUntilStable(path: string, settleMs = 750): Promise<{ size: number; mtimeMs: number } | null> {
    let prev = await stat(path).catch(() => null)
    if (prev === null) return null
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, settleMs))
      const next = await stat(path).catch(() => null)
      if (next === null) return null
      if (next.size === prev.size && next.mtimeMs === prev.mtimeMs) return { size: next.size, mtimeMs: next.mtimeMs }
      prev = next
    }
    return null
  }
}
