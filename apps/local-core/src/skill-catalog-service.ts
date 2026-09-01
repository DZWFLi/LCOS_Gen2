/**
 * F6 P1-B（20260828）：Skill Catalog Web read contract（方案 1 只读）。
 *
 * 零造轮子：直接复用 tools/lcos-agent/commands/skill-layers.mjs 的分层加载
 * （system = packages/skills/<id>/；user = <projectRoot>/.creative-os/skills/<id>/；
 * 同 id 两层 = merged）。该模块是纯函数 ESM，CLI 与 Web 共享同一实现——
 * Web 侧不会出现第二套 skill 解析逻辑。
 *
 * 纪律（与 CLI 一致）：坏 user skill warn + skip 不 brick；目录沙箱在 skill-layers 内。
 * 路径推导：src 与 dist/src 同为 apps/local-core/<src|dist/src>/ 深度（3 级到仓库根）。
 */
import { fileURLToPath } from 'node:url'
import type {
  SkillCatalogEntryV1,
  SkillCatalogReadV1,
  SkillCatalogSourceV1,
} from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'

/** system skills 根（仓库内 canonical：packages/skills/）。 */
function systemSkillsRoot(): string {
  return fileURLToPath(new URL('../../../packages/skills', import.meta.url))
}

function skillLayersModuleUrl(): URL {
  return new URL('../../../tools/lcos-agent/commands/skill-layers.mjs', import.meta.url)
}

interface SkillLayersModule {
  listLayeredSkills(input: { systemRoot: string; userRoot?: string }): Array<{ id: string; source: string }>
  readLayeredSkillFile(input: { ref: string; systemRoot: string; userRoot?: string }): { skill: string; source: string; ref: string; content: string } | null
  parseFrontmatter(text: string): { meta: Record<string, string>; body: string; hasFrontmatter: boolean }
  userSkillsRootFor(projectRoot: string): string
}

let cachedModule: SkillLayersModule | undefined

async function skillLayers(): Promise<SkillLayersModule> {
  if (cachedModule !== undefined) return cachedModule
  const loaded = (await import(skillLayersModuleUrl().href)) as unknown as SkillLayersModule
  cachedModule = loaded
  return loaded
}

export class SkillCatalogService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  /** systemRoot/userRoot 解析：无 project = 仅 system 层；有 project = 该项目的 user 层。 */
  async #roots(projectId: string | undefined): Promise<{ systemRoot: string; userRoot?: string }> {
    const layers = await skillLayers()
    if (projectId === undefined) return { systemRoot: systemSkillsRoot() }
    const project = this.repository.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    return { systemRoot: systemSkillsRoot(), userRoot: layers.userSkillsRootFor(project.rootPath) }
  }

  async list(projectId?: string, search?: string): Promise<readonly SkillCatalogEntryV1[]> {
    const layers = await skillLayers()
    const { systemRoot, userRoot } = await this.#roots(projectId)
    const needle = search?.trim().toLocaleLowerCase('en-US') ?? ''
    const entries: SkillCatalogEntryV1[] = []
    for (const { id, source } of layers.listLayeredSkills({ systemRoot, ...(userRoot === undefined ? {} : { userRoot }) })) {
      // list 视图取 name/description：读合并视图的 frontmatter（system canonical 身份优先）。
      const read = layers.readLayeredSkillFile({ ref: id, systemRoot, ...(userRoot === undefined ? {} : { userRoot }) })
      if (read === null) continue
      const { meta } = layers.parseFrontmatter(read.content)
      const name = meta.name ?? id
      const description = meta.description ?? ''
      if (needle !== '' && !name.toLocaleLowerCase('en-US').includes(needle) && !description.toLocaleLowerCase('en-US').includes(needle) && !id.toLocaleLowerCase('en-US').includes(needle)) continue
      entries.push({ id, source: source as SkillCatalogSourceV1, name, description })
    }
    return entries
  }

  async read(skillId: string, projectId?: string): Promise<SkillCatalogReadV1 | undefined> {
    const layers = await skillLayers()
    const { systemRoot, userRoot } = await this.#roots(projectId)
    const read = layers.readLayeredSkillFile({ ref: skillId, systemRoot, ...(userRoot === undefined ? {} : { userRoot }) })
    if (read === null) return undefined
    return {
      id: skillId,
      source: read.source === 'merged-user' ? 'user' : read.source as SkillCatalogSourceV1,
      content: read.content,
    }
  }
}