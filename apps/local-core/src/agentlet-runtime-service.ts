/**
 * Agentlet Runtime（任务四 P3，借鉴 huabu agentlet daemon 的「解析→spawn→不理解内容」纪律）。
 *
 * 职责边界（huabu 同构）：
 * - 宿主只做三件事：扫描/校验 manifest、按 env 契约 spawn、跟踪运行状态。
 * - 宿主不理解 agentlet 干什么；Reachback 的具体端点（/space/、curation/text）
 *   由子进程自己调用——读写安全全由既有通道（沙箱 allowlist + CAS + ChangeSet 归因）保证。
 *
 * env 契约（spawn 时注入，换 agent 不变）：
 *   LCOS_CORE_URL              本 core 的 loopback 基址（含端口）
 *   LCOS_AGENTLET_TOKEN        回调 Bearer token（core 未设 apiToken 时省略）
 *   LCOS_SESSION_ID            写通道归因 ID（actor=agent/<sessionId>）
 *   LCOS_PROJECT_ID / LCOS_SCOPE_ID   项目与根 scope（宿主上下文，huabu sessionSpec.env 同构）
 *   LCOS_AGENTLET_INSTRUCTION  本次任务指令（可选）
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AGENTLET_SCHEMA_V1, type AgentletRunV1, type AgentletRunStatusV1, type AgentletSummaryV1 } from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'

const DEFAULT_TIMEOUT_SECONDS = 300
const DEFAULT_AGENTLETS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'packages', 'agentlets')
const DIAGNOSTICS_TAIL = 2_000

export class AgentletManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentletManifestError'
  }
}

interface ParsedManifest {
  readonly name: string
  readonly description: string
  readonly commands: ReadonlyMap<string, string>
  readonly timeoutSeconds: number
}

interface ManifestEntry {
  readonly dir: string
  readonly manifest: ParsedManifest
}

/**
 * 极简 YAML 子集解析（agentlet.yaml 的全部形状）：
 * 顶层 `key: value` + `command:` 一层 harness→command 映射。
 * schema 必须是 lcos-agentlet-schema-v1；name 必须与目录名一致（防伪装）。
 */
function parseManifestYaml(text: string, source: string): ParsedManifest {
  const lines = text.split(/\r?\n/)
  const top = new Map<string, string>()
  const commands = new Map<string, string>()
  let inCommand = false
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '')
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.match(/^ */)?.[0].length ?? 0
    const content = line.slice(indent)
    if (indent === 0) {
      inCommand = false
      const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(content)
      if (match === null || match[1] === undefined || match[2] === undefined) throw new AgentletManifestError(`${source}: 无法解析的行 "${content}"`)
      const key = match[1]
      const value = match[2].trim()
      if (value === '') {
        if (key === 'command') inCommand = true
        continue
      }
      top.set(key, value.replace(/^["']|["']$/g, ''))
    } else if (inCommand) {
      const match = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(content)
      if (match === null || match[1] === undefined || match[2] === undefined) throw new AgentletManifestError(`${source}: command 段无法解析的行 "${content}"`)
      commands.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''))
    } else {
      throw new AgentletManifestError(`${source}: 不支持的嵌套结构 "${content}"`)
    }
  }
  const schema = top.get('schema')
  if (schema !== AGENTLET_SCHEMA_V1) {
    throw new AgentletManifestError(`${source}: schema 必须是 ${AGENTLET_SCHEMA_V1}`)
  }
  const name = top.get('name')
  if (name === undefined || name.length === 0) throw new AgentletManifestError(`${source}: 缺少 name`)
  const description = top.get('description') ?? ''
  if (description.length === 0) throw new AgentletManifestError(`${source}: 缺少 description`)
  if (commands.size === 0) throw new AgentletManifestError(`${source}: command 至少声明一个 harness`)
  const timeoutRaw = Number(top.get('timeoutSeconds') ?? DEFAULT_TIMEOUT_SECONDS)
  const timeoutSeconds = Number.isFinite(timeoutRaw) && timeoutRaw > 0
    ? Math.min(3_600, Math.floor(timeoutRaw))
    : DEFAULT_TIMEOUT_SECONDS
  return { name, description, commands, timeoutSeconds }
}

interface RunningEntry {
  readonly run: AgentletRunV1
  readonly child: ChildProcess
  stderrTail: string
  progress?: number
  timer?: ReturnType<typeof setTimeout>
}

export interface AgentletRuntimeServiceDeps {
  readonly repository: SqliteMetadataRepository
  readonly agentletsRoot?: string
  readonly apiToken?: string
  readonly now?: () => Date
}

export class AgentletRuntimeService {
  readonly #repository: SqliteMetadataRepository
  readonly #root: string
  readonly #apiToken: string | undefined
  readonly #now: () => Date
  #address: { readonly host: string; readonly port: number } | undefined
  readonly #running = new Map<string, RunningEntry>()

  constructor(deps: AgentletRuntimeServiceDeps) {
    this.#repository = deps.repository
    this.#root = deps.agentletsRoot ?? DEFAULT_AGENTLETS_ROOT
    this.#apiToken = deps.apiToken
    this.#now = deps.now ?? (() => new Date())
  }

  /** server.start 后注入实际地址（ephemeral port 场景必需）。 */
  setAddress(address: { readonly host: string; readonly port: number }): void {
    this.#address = address
  }

  /** P0-C/P0-D progress：agentlet 子进程经 reachback 上报进度（0-1）。 */
  reportProgress(runId: string, projectId: string, progress: number): void {
    const entry = this.#running.get(runId)
    if (entry === undefined || entry.run.projectId !== projectId) return
    const clamped = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : undefined
    this.#running.set(runId, {
      ...entry,
      run: { ...entry.run, ...(clamped === undefined ? {} : { progress: clamped }) },
    })
  }

  #scan(): ManifestEntry[] {
    if (!existsSync(this.#root)) return []
    const entries: ManifestEntry[] = []
    for (const entry of readdirSync(this.#root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const manifestPath = join(this.#root, entry.name, 'agentlet.yaml')
      if (!existsSync(manifestPath)) continue
      try {
        const manifest = parseManifestYaml(readFileSync(manifestPath, 'utf8'), manifestPath)
        if (manifest.name !== entry.name) {
          throw new AgentletManifestError(`${manifestPath}: manifest name "${manifest.name}" 与目录名 "${entry.name}" 不一致`)
        }
        entries.push({ dir: join(this.#root, entry.name), manifest })
      } catch (error: unknown) {
        // huabu 纪律：坏 agentlet warn + skip，绝不 brick 宿主
        console.warn(`[agentlet] skipping invalid manifest: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return entries
  }

  list(): AgentletSummaryV1[] {
    return this.#scan()
      .map(({ manifest }) => ({
        name: manifest.name,
        description: manifest.description,
        harnesses: [...manifest.commands.keys()],
        timeoutSeconds: manifest.timeoutSeconds,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'en-US'))
  }

  runs(projectId?: string): AgentletRunV1[] {
    const all = [...this.#running.values()].map((entry) => this.#materialize(entry))
    const filtered = projectId === undefined ? all : all.filter((run) => run.projectId === projectId)
    return filtered.sort((left, right) => right.startedAt.localeCompare(left.startedAt, 'en-US'))
  }

  /**
   * 按 manifest 声明的 command spawn 子进程（不做 setup、不装依赖——
   * 三分离纪律：源码包 / 显式 setup / 运行 launch，宿主只管 launch）。
   */
  launch(projectId: string, name: string, input: { readonly instruction?: string; readonly harness?: string } = {}): AgentletRunV1 {
    if (this.#address === undefined) throw new AgentletManifestError('Agentlet runtime is not ready (server not started).')
    const project = this.#repository.getProject(projectId)
    if (project === undefined) throw new AgentletManifestError(`Project not found: ${projectId}`)
    const entry = this.#scan().find((candidate) => candidate.manifest.name === name)
    if (entry === undefined) throw new AgentletManifestError(`Agentlet not found: ${name}`)
    const harness = input.harness === undefined ? [...entry.manifest.commands.keys()][0]! : input.harness
    const command = entry.manifest.commands.get(harness)
    if (command === undefined) {
      throw new AgentletManifestError(`Agentlet "${name}" does not declare harness "${harness}" (available: ${[...entry.manifest.commands.keys()].join(', ')})`)
    }
    const scopeId = this.#repository.get(projectId)?.scopes.find((scope) => scope.kind === 'root')?.id
      ?? this.#repository.get(projectId)?.scopes[0]?.id
    if (scopeId === undefined) throw new AgentletManifestError(`Project has no scope: ${projectId}`)

    // command 是简单 argv 行（空格分隔，无 shell 元字符）——保持可审计
    const argv = command.split(/\s+/).filter(Boolean)
    const sessionId = `agentlet-${name}-${randomUUID().slice(0, 8)}`
    const runId = `agentlet-run-${randomUUID()}`
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: entry.dir,
      env: {
        ...process.env,
        LCOS_CORE_URL: `http://${this.#address.host}:${this.#address.port}`,
        ...(this.#apiToken === undefined ? {} : { LCOS_AGENTLET_TOKEN: this.#apiToken }),
        LCOS_SESSION_ID: sessionId,
        LCOS_AGENTLET_RUN_ID: runId,
        LCOS_PROJECT_ID: projectId,
        LCOS_SCOPE_ID: String(scopeId),
        ...(input.instruction === undefined || input.instruction === '' ? {} : { LCOS_AGENTLET_INSTRUCTION: input.instruction }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const started = this.#now().toISOString()
    const running: RunningEntry = { run: { id: runId, agentlet: name, projectId, harness, sessionId, status: 'running', ...(child.pid === undefined ? {} : { pid: child.pid }), ...(input.instruction ? { instruction: input.instruction } : {}), startedAt: started }, child, stderrTail: '' }
    this.#running.set(runId, running)
    child.stderr?.on('data', (chunk: Buffer) => {
      running.stderrTail = (running.stderrTail + chunk.toString('utf8')).slice(-DIAGNOSTICS_TAIL)
    })
    child.on('error', (error) => {
      running.stderrTail = (running.stderrTail + `\nspawn error: ${error.message}`).slice(-DIAGNOSTICS_TAIL)
      this.#finish(runId, 'failed')
    })
    child.on('close', (code) => {
      this.#finish(runId, code === 0 ? 'exited' : 'failed', code ?? undefined)
    })
    running.timer = setTimeout(() => {
      running.stderrTail = `${running.stderrTail}\n[agentlet] timeout after ${entry.manifest.timeoutSeconds}s`.slice(-DIAGNOSTICS_TAIL)
      this.#finish(runId, 'timeout')
      child.kill()
    }, entry.manifest.timeoutSeconds * 1_000)
    return this.#materialize(running)
  }

  #finish(runId: string, status: AgentletRunStatusV1, exitCode?: number): void {
    const entry = this.#running.get(runId)
    if (entry === undefined) return
    if (entry.timer !== undefined) clearTimeout(entry.timer)
    if (entry.run.status !== 'running') return
    this.#running.set(runId, {
      ...entry,
      run: {
        ...entry.run,
        status,
        ...(exitCode === undefined ? {} : { exitCode }),
        ...(entry.stderrTail.trim() === '' ? {} : { diagnostics: entry.stderrTail.trim() }),
        finishedAt: this.#now().toISOString(),
      },
    })
  }

  #materialize(entry: RunningEntry): AgentletRunV1 {
    return entry.run
  }

  /** server.close 时收口：杀掉仍在跑的子进程（best-effort）。 */
  close(): void {
    for (const entry of this.#running.values()) {
      if (entry.timer !== undefined) clearTimeout(entry.timer)
      if (entry.run.status === 'running') {
        try { entry.child.kill() } catch { /* best effort */ }
      }
    }
  }
}