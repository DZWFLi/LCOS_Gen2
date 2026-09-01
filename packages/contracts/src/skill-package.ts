import type { SkillCompositionV1 } from './skill-composition.js'

/**
 * SkillPackageV1 — Skill 一等对象 CRUD 契约（S2，审计 P0-3）。
 *
 * 存储裁定（closeout 记录）：project-local 目录 `<projectRoot>/.creative-os/skills/<id>/`
 * 而非 Core 表——(1) 读取层 skill-layers.mjs（CLI/Web 共享）已落地该位置，CRUD 写同处
 * 双向立即可见、零迁移；(2) Skill 是多文件包（SKILL.md + references/ + scripts/），
 * 行式表存不下目录结构；(3) user 影子化 system 的分层合并语义依赖目录形态。
 *
 * 系统层 `packages/skills/` 是写保护对象：所有写操作物理上只 resolve 在 userRoot 内
 * （service 不持有 systemRoot 写路径）；install = 从 system 层只读复制到 user 层。
 *
 * provenance 用 sidecar `.provenance.json`（不进 SKILL.md——frontmatter 是用户可编辑区，
 * provenance 是 Core 管理的审计事实，两者分离）。
 */

/** Skill 来源层（与 SkillCatalogSourceV1 对齐 + install 语义）。 */
export type SkillPackageOriginV1 = 'user' | 'installed'

/** provenance：Core 管理的审计事实（sidecar 存储，每次写操作更新）。 */
export interface SkillPackageProvenanceV1 {
  readonly origin: SkillPackageOriginV1
  /** installed 时记录来源 system skill id。 */
  readonly sourceSkillId?: string
  readonly createdAt: string
  readonly updatedAt: string
  /** 历史版本号（每次 version-bump 追加）。 */
  readonly versionHistory: readonly string[]
}

/** Skill 包读模型（list 单项）。 */
export interface SkillPackageV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly name: string
  readonly description: string
  readonly version: string | null
  readonly role: string | null
  /** v0.15 如实为空数组（S8 依赖契约落地后由 Skill 作者声明）。 */
  readonly requiredCapabilities: readonly string[]
  readonly optionalCapabilities: readonly string[]
  readonly source: 'system' | 'user' | 'merged'
  readonly disabled: boolean
  readonly provenance: SkillPackageProvenanceV1 | null
  /** Root/Subskill composition（S8；无则为 null，S2 兼容）。 */
  readonly composition: SkillCompositionV1 | null
}

/** 创建输入：content 为完整 SKILL.md（frontmatter + 正文）。 */
export interface CreateSkillPackageInputV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly content: string
}

export interface UpdateSkillPackageInputV1 {
  readonly schemaVersion: 1
  /** 覆盖完整 SKILL.md 内容。 */
  readonly content: string
}

export interface RenameSkillPackageInputV1 {
  readonly schemaVersion: 1
  readonly newId: string
}

/** 结构校验结果（validate 不落盘）。 */
export interface SkillPackageValidationV1 {
  readonly schemaVersion: 1
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

/** skill id 合法字符：小写字母/数字/连字符（与目录名安全要求一致）。 */
export function isValidSkillPackageId(id: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}

/** SKILL.md 结构校验（与读取层 validUserSkillIds 同一判据：frontmatter + name + description）。 */
export function validateSkillPackageContent(content: string): SkillPackageValidationV1 {
  const errors: string[] = []
  const warnings: string[] = []
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)
  if (match === null) {
    return { schemaVersion: 1, valid: false, errors: ['SKILL.md 缺少 frontmatter（--- 块）'], warnings }
  }
  const fields = new Map<string, string>()
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv !== null) fields.set(kv[1]!, kv[2]!.trim().replace(/^["']|["']$/g, ''))
  }
  if ((fields.get('name') ?? '') === '') errors.push('frontmatter 缺少 name')
  if ((fields.get('description') ?? '') === '') errors.push('frontmatter 缺少 description')
  if (!fields.has('version')) warnings.push('未声明 version（建议声明以便版本管理）')
  if (!fields.has('role')) warnings.push('未声明 role')
  return { schemaVersion: 1, valid: errors.length === 0, errors, warnings }
}
