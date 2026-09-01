import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Phase A：Project Runtime Registry。
 *
 * 只保存 Runtime 偏好（最近项目 / 最后聚焦 / 固定 Capture 目标），
 * 不是 Project Core Truth。Core 永远用 stable ID；displayTitle 只是展示。
 * 持久化到 ~/.lcos/runtime/registry.json（可用 LCOS_RUNTIME_REGISTRY 覆盖）。
 */
export interface RuntimeProjectStateV0 {
  readonly projectId: string
  readonly rootPath?: string
  readonly displayTitle?: string
  readonly lastOpenedAt?: string
  readonly lastFocusedAt?: string
}

export interface RuntimeRegistryV0 {
  readonly schemaVersion: 0
  readonly recentProjects: RuntimeProjectStateV0[]
  readonly lastFocusedProjectId?: string
  readonly pinnedCaptureProjectId?: string
  readonly browserTabBindings?: Readonly<Record<string, string>>
  readonly extensionToken?: string
}

interface MutableProjectState {
  projectId: string
  rootPath?: string
  displayTitle?: string
  lastOpenedAt?: string
  lastFocusedAt?: string
}

interface MutableRegistry {
  schemaVersion: 0
  recentProjects: MutableProjectState[]
  lastFocusedProjectId?: string
  pinnedCaptureProjectId?: string
  browserTabBindings?: Record<string, string>
  extensionToken?: string
}

function defaultRegistryPath(): string {
  return join(homedir(), '.lcos', 'runtime', 'registry.json')
}

function emptyRegistry(): RuntimeRegistryV0 {
  return { schemaVersion: 0, recentProjects: [] }
}

export class RuntimeRegistryService {
  readonly #registryPath: string
  #registry: MutableRegistry

  constructor(registryPath: string = process.env.LCOS_RUNTIME_REGISTRY ?? defaultRegistryPath()) {
    this.#registryPath = registryPath
    this.#registry = this.#load()
  }

  #load(): MutableRegistry {
    if (!existsSync(this.#registryPath)) return emptyRegistry()
    try {
      const parsed = JSON.parse(readFileSync(this.#registryPath, 'utf8')) as MutableRegistry
      if (parsed.schemaVersion !== 0 || !Array.isArray(parsed.recentProjects)) return emptyRegistry()
      return parsed
    } catch {
      return emptyRegistry()
    }
  }

  #persist(): void {
    mkdirSync(dirname(this.#registryPath), { recursive: true })
    const tmp = `${this.#registryPath}.tmp`
    writeFileSync(tmp, `${JSON.stringify(this.#registry, null, 2)}\n`, 'utf8')
    renameSync(tmp, this.#registryPath)
  }

  getRegistry(): RuntimeRegistryV0 {
    return {
      ...this.#registry,
      recentProjects: this.#registry.recentProjects.map((project) => ({ ...project })),
    }
  }

  recordOpen(projectId: string, info: { readonly rootPath?: string; readonly displayTitle?: string } = {}): RuntimeRegistryV0 {
    const now = new Date().toISOString()
    const existing = this.#registry.recentProjects.find((project) => project.projectId === projectId)
    if (existing !== undefined) {
      this.#registry.recentProjects = this.#registry.recentProjects.map((project) =>
        project.projectId === projectId
          ? {
              ...project,
              ...(info.rootPath === undefined ? {} : { rootPath: info.rootPath }),
              ...(info.displayTitle === undefined ? {} : { displayTitle: info.displayTitle }),
              lastOpenedAt: now,
            }
          : project,
      )
    } else {
      this.#registry.recentProjects = [
        {
          projectId,
          ...(info.rootPath === undefined ? {} : { rootPath: info.rootPath }),
          ...(info.displayTitle === undefined ? {} : { displayTitle: info.displayTitle }),
          lastOpenedAt: now,
        },
        ...this.#registry.recentProjects,
      ]
    }
    this.#registry.recentProjects.sort((left, right) => (right.lastOpenedAt ?? '').localeCompare(left.lastOpenedAt ?? ''))
    this.#registry.recentProjects = this.#registry.recentProjects.slice(0, 20)
    this.#persist()
    return this.getRegistry()
  }

  recordFocus(projectId: string): RuntimeRegistryV0 {
    const now = new Date().toISOString()
    const existing = this.#registry.recentProjects.find((project) => project.projectId === projectId)
    if (existing !== undefined) {
      this.#registry.recentProjects = this.#registry.recentProjects.map((project) =>
        project.projectId === projectId ? { ...project, lastFocusedAt: now, lastOpenedAt: now } : project,
      )
    } else {
      this.#registry.recentProjects = [
        { projectId, lastOpenedAt: now, lastFocusedAt: now },
        ...this.#registry.recentProjects,
      ]
    }
    this.#registry.recentProjects.sort((left, right) => (right.lastFocusedAt ?? right.lastOpenedAt ?? '').localeCompare(left.lastFocusedAt ?? left.lastOpenedAt ?? ''))
    this.#registry.lastFocusedProjectId = projectId
    this.#persist()
    return this.getRegistry()
  }

  setPinnedCaptureProject(projectId: string | null): RuntimeRegistryV0 {
    if (projectId === null) {
      delete this.#registry.pinnedCaptureProjectId
    } else {
      this.#registry.pinnedCaptureProjectId = projectId
    }
    this.#persist()
    return this.getRegistry()
  }

  /** Phase B：Browser Tab → Project 绑定（key = `${profileId}:${tabId}`）。tab 关闭由调用方清除。 */
  setBrowserTabBinding(profileId: string, tabId: number, projectId: string | null): RuntimeRegistryV0 {
    const key = `${profileId}:${tabId}`
    const bindings = { ...(this.#registry.browserTabBindings ?? {}) }
    if (projectId === null) {
      delete bindings[key]
    } else {
      bindings[key] = projectId
    }
    if (Object.keys(bindings).length === 0) {
      delete this.#registry.browserTabBindings
    } else {
      this.#registry.browserTabBindings = bindings
    }
    this.#persist()
    return this.getRegistry()
  }

  resolveBrowserTabBinding(profileId: string, tabId: number): string | undefined {
    return this.#registry.browserTabBindings?.[`${profileId}:${tabId}`]
  }

  /** Phase C：Extension 配对 token（幂等：已存在则复用）。调用方需持有 Core token。 */
  ensureExtensionToken(): string {
    if (this.#registry.extensionToken === undefined) {
      this.#registry.extensionToken = randomBytes(32).toString('base64url')
      this.#persist()
    }
    return this.#registry.extensionToken
  }
}
