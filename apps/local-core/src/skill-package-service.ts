/**
 * SkillPackageService — Skill 一等对象 CRUD（S2）。
 *
 * 写保护红线：本 service 的全部写操作物理上只 resolve 在 userRoot
 * （<projectRoot>/.creative-os/skills/）内——构造时不持有任何 systemRoot
 * 写路径；system 层唯一交互是 install 的只读复制源。目录沙箱与
 * skill-layers.mjs 同构（段级 + 前缀双校验）。
 *
 * provenance = sidecar `.provenance.json`；disabled = sidecar `.disabled`。
 * 两者都是 Core 管理的审计事实，不进用户可编辑的 SKILL.md frontmatter。
 */
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isValidSkillPackageId,
  resolveSkillDependencyOrder,
  validateSkillComposition,
  validateSkillPackageContent,
  type SkillCompositionV1,
  type SkillDependencyNodeV1,
  type SkillPackageProvenanceV1,
  type SkillPackageV1,
} from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'

/** system skills 根（仓库内 canonical，只读来源；src 与 dist/src 同深度）。 */
function systemSkillsRoot(): string {
  return fileURLToPath(new URL('../../../packages/skills', import.meta.url))
}

export class SkillPathEscapeError extends Error {
  constructor(ref: string) {
    super(`Skill path "${ref}" escapes the user skills directory.`)
    this.name = 'SkillPathEscapeError'
  }
}

/** user skill 目录内安全 resolve（前缀双校验，skill-layers 同构）。 */
function safeResolveWithin(root: string, id: string): string {
  const target = resolve(root, id)
  if (target !== root && !target.startsWith(root + sep)) throw new SkillPathEscapeError(id)
  return target
}

interface SkillLayersModule {
  listLayeredSkills(input: { systemRoot: string; userRoot?: string }): Array<{ id: string; source: string }>
  readLayeredSkillFile(input: { ref: string; systemRoot: string; userRoot?: string }): { skill: string; source: string; ref: string; content: string } | null
  parseFrontmatter(text: string): { meta: Record<string, string>; body: string; hasFrontmatter: boolean }
  userSkillsRootFor(projectRoot: string): string
}

const PROVENANCE_FILE = '.provenance.json'
const DISABLED_FILE = '.disabled'
const COMPOSITION_FILE = 'references/lcos-skill-composition.json'

export class SkillPackageService {
  #layers: SkillLayersModule | undefined

  constructor(private readonly repository: SqliteMetadataRepository) {}

  async #skillLayers(): Promise<SkillLayersModule> {
    if (this.#layers !== undefined) return this.#layers
    const loaded = (await import(fileURLToPath(new URL('../../../tools/lcos-agent/commands/skill-layers.mjs', import.meta.url)))) as unknown as SkillLayersModule
    this.#layers = loaded
    return loaded
  }

  /** project → userRoot；id 经合法性 + 沙箱双校验后返回 user 层目录。 */
  async #skillDir(projectId: string, id: string): Promise<{ userRoot: string; dir: string }> {
    if (!isValidSkillPackageId(id)) throw new SkillPathEscapeError(id)
    const project = this.repository.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const layers = await this.#skillLayers()
    const userRoot = layers.userSkillsRootFor(project.rootPath)
    return { userRoot, dir: safeResolveWithin(userRoot, id) }
  }

  // ---------- 读 ----------

  async list(projectId: string): Promise<readonly SkillPackageV1[]> {
    const layers = await this.#skillLayers()
    const project = this.repository.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const userRoot = layers.userSkillsRootFor(project.rootPath)
    const systemRoot = systemSkillsRoot()
    const out: SkillPackageV1[] = []
    for (const { id, source } of layers.listLayeredSkills({ systemRoot, userRoot })) {
      const read = layers.readLayeredSkillFile({ ref: id, systemRoot, userRoot })
      if (read === null) continue
      const { meta } = layers.parseFrontmatter(read.content)
      const userDir = safeResolveWithin(userRoot, id)
      const disabled = existsSync(join(userDir, DISABLED_FILE))
      const composition = await this.#readComposition(userDir)
      out.push({
        schemaVersion: 1,
        id,
        name: meta.name ?? id,
        description: meta.description ?? '',
        version: meta.version ?? null,
        role: meta.role ?? null,
        requiredCapabilities: composition?.requiredCapabilities ?? [],
        optionalCapabilities: composition?.optionalCapabilities ?? [],
        source: source as SkillPackageV1['source'],
        disabled,
        provenance: await this.#readProvenance(userDir),
        composition,
      })
    }
    return out
  }

  async #readProvenance(userDir: string): Promise<SkillPackageProvenanceV1 | null> {
    try {
      return JSON.parse(await readFile(join(userDir, PROVENANCE_FILE), 'utf8')) as SkillPackageProvenanceV1
    } catch {
      return null
    }
  }

  async #readComposition(userDir: string): Promise<SkillCompositionV1 | null> {
    try {
      const parsed = JSON.parse(await readFile(join(userDir, COMPOSITION_FILE), 'utf8'))
      return validateSkillComposition(parsed).valid ? (parsed as SkillCompositionV1) : null
    } catch {
      return null
    }
  }

  async #writeComposition(userDir: string, composition: SkillCompositionV1 | undefined): Promise<void> {
    if (composition === undefined) return
    const target = join(userDir, COMPOSITION_FILE)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, JSON.stringify(composition, null, 2) + '\n', 'utf8')
  }

  async #writeProvenance(userDir: string, provenance: SkillPackageProvenanceV1): Promise<void> {
    await writeFile(join(userDir, PROVENANCE_FILE), JSON.stringify(provenance, null, 2) + '\n', 'utf8')
  }

  // ---------- 校验（不落盘） ----------

  validate(content: string) {
    return validateSkillPackageContent(content)
  }

  validateComposition(input: unknown) {
    return validateSkillComposition(input)
  }

  // ---------- 写（全部物理限定 userRoot） ----------

  async create(projectId: string, id: string, content: string, options: { composition?: SkillCompositionV1 } = {}): Promise<SkillPackageV1> {
    const validation = validateSkillPackageContent(content)
    if (!validation.valid) throw new Error(`SKILL.md invalid: ${validation.errors.join('; ')}`)
    const { userRoot, dir } = await this.#skillDir(projectId, id)
    if (existsSync(dir)) throw new Error(`Skill already exists: ${id}`)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), content, 'utf8')
    await this.#writeComposition(dir, options.composition)
    const now = new Date().toISOString()
    await this.#writeProvenance(dir, { origin: 'user', createdAt: now, updatedAt: now, versionHistory: [] })
    return (await this.list(projectId)).find((item) => item.id === id)!
  }

  async update(projectId: string, id: string, content: string, options: { expectedVersion?: string | null; composition?: SkillCompositionV1 | null } = {}): Promise<SkillPackageV1> {
    const validation = validateSkillPackageContent(content)
    if (!validation.valid) throw new Error(`SKILL.md invalid: ${validation.errors.join('; ')}`)
    const { dir } = await this.#skillDir(projectId, id)
    const skillMdPath = join(dir, 'SKILL.md')
    if (!existsSync(skillMdPath)) throw new Error(`Skill not found: ${id}`)
    if ('expectedVersion' in options) {
      const current = await this.#readVersion(skillMdPath)
      if (current !== options.expectedVersion) throw new Error(`Version conflict: expected ${options.expectedVersion ?? 'null'}, got ${current ?? 'null'}`)
    }
    await writeFile(skillMdPath, content, 'utf8')
    if (options.composition !== undefined && options.composition !== null) await this.#writeComposition(dir, options.composition)
    await this.#touchProvenance(dir)
    return (await this.list(projectId)).find((item) => item.id === id)!
  }

  async versionBump(projectId: string, id: string, newVersion: string): Promise<SkillPackageV1> {
    if (!/^\d+\.\d+\.\d+$/.test(newVersion)) throw new Error(`Invalid version (semver expected): ${newVersion}`)
    const { dir } = await this.#skillDir(projectId, id)
    const skillMdPath = join(dir, 'SKILL.md')
    if (!existsSync(skillMdPath)) throw new Error(`Skill not found: ${id}`)
    const raw = await readFile(skillMdPath, 'utf8')
    let updated: string
    if (/^---\r?\n/.test(raw)) {
      // 删除已有 version 行（若有）后在 frontmatter 头插入，保证单行 version
      const withoutVersion = raw.replace(/^---\r?\n/, '---\n').replace(/^version: .*$(\r?\n)?/m, '')
      updated = withoutVersion.replace(/^---\r?\n/, `---\nversion: ${newVersion}\n`)
    } else {
      updated = `---\nversion: ${newVersion}\n---\n\n${raw}`
    }
    await writeFile(skillMdPath, updated, 'utf8')
    const provenance = (await this.#readProvenance(dir)) ?? { origin: 'user' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), versionHistory: [] }
    await this.#writeProvenance(dir, { ...provenance, updatedAt: new Date().toISOString(), versionHistory: [...provenance.versionHistory, newVersion] })
    return (await this.list(projectId)).find((item) => item.id === id)!
  }

  async rename(projectId: string, id: string, newId: string): Promise<SkillPackageV1> {
    if (!isValidSkillPackageId(newId)) throw new SkillPathEscapeError(newId)
    const { userRoot, dir } = await this.#skillDir(projectId, id)
    const target = safeResolveWithin(userRoot, newId)
    if (!existsSync(join(dir, 'SKILL.md'))) throw new Error(`Skill not found: ${id}`)
    if (existsSync(target)) throw new Error(`Skill already exists: ${newId}`)
    await mkdir(dirname(target), { recursive: true })
    await rename(dir, target)
    await this.#touchProvenance(target)
    return (await this.list(projectId)).find((item) => item.id === newId)!
  }

  /** install = 从 system 层只读复制到 user 层（system 源不动，写保护）。 */
  async install(projectId: string, systemSkillId: string): Promise<SkillPackageV1> {
    if (!isValidSkillPackageId(systemSkillId)) throw new SkillPathEscapeError(systemSkillId)
    const systemDir = safeResolveWithin(systemSkillsRoot(), systemSkillId)
    if (!existsSync(join(systemDir, 'SKILL.md'))) throw new Error(`System skill not found: ${systemSkillId}`)
    const project = this.repository.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const layers = await this.#skillLayers()
    const userRoot = layers.userSkillsRootFor(project.rootPath)
    const target = safeResolveWithin(userRoot, systemSkillId)
    if (existsSync(target)) throw new Error(`Skill already installed: ${systemSkillId}`)
    await mkdir(userRoot, { recursive: true })
    await cp(systemDir, target, { recursive: true })
    const now = new Date().toISOString()
    await this.#writeProvenance(target, { origin: 'installed', sourceSkillId: systemSkillId, createdAt: now, updatedAt: now, versionHistory: [] })
    return (await this.list(projectId)).find((item) => item.id === systemSkillId)!
  }

  async setDisabled(projectId: string, id: string, disabled: boolean): Promise<SkillPackageV1> {
    const { dir } = await this.#skillDir(projectId, id)
    if (!existsSync(join(dir, 'SKILL.md'))) throw new Error(`Skill not found: ${id}`)
    if (disabled) await writeFile(join(dir, DISABLED_FILE), '', 'utf8')
    else await rm(join(dir, DISABLED_FILE), { force: true })
    await this.#touchProvenance(dir)
    return (await this.list(projectId)).find((item) => item.id === id)!
  }

  async #touchProvenance(dir: string): Promise<void> {
    const provenance = (await this.#readProvenance(dir)) ?? { origin: 'user' as const, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), versionHistory: [] }
    await this.#writeProvenance(dir, { ...provenance, updatedAt: new Date().toISOString() })
  }

  async #readVersion(skillMdPath: string): Promise<string | null> {
    const raw = await readFile(skillMdPath, 'utf8')
    const match = /^version:\s*(.+)$/m.exec(raw)
    return match === null ? null : match[1]!.trim()
  }

  /** 递归解析 composition 依赖（拓扑序 + 环检测）。A→B→A 抛 SkillDependencyCycleError。 */
  async resolveCompositionDependencies(projectId: string, rootSkillId: string): Promise<readonly string[]> {
    if (!isValidSkillPackageId(rootSkillId)) throw new SkillPathEscapeError(rootSkillId)
    void (await this.#skillDir(projectId, rootSkillId))
    const nodes: SkillDependencyNodeV1[] = []
    const visited = new Set<string>()
    const collect = async (id: string): Promise<void> => {
      if (visited.has(id)) return
      visited.add(id)
      const { dir } = await this.#skillDir(projectId, id)
      const composition = await this.#readComposition(dir)
      const dependencies = composition?.subskills.map((s) => s.skillId) ?? []
      await Promise.all(dependencies.map((dep) => collect(dep)))
      nodes.push({ id, dependencies })
    }
    await collect(rootSkillId)
    return resolveSkillDependencyOrder(nodes)
  }

  /** 列 user 层全部 skill id（gate/测试用）。 */
  async listUserSkillIds(projectId: string): Promise<readonly string[]> {
    const project = this.repository.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const layers = await this.#skillLayers()
    const userRoot = layers.userSkillsRootFor(project.rootPath)
    if (!existsSync(userRoot)) return []
    return (await readdir(userRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  }
}
