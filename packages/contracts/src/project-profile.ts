/**
 * F6 P1 契约（20260828）：Project Launcher / Source Bay Skills Tab 的后端只读支撑。
 *
 * P1-A1 ProjectSummary：objectCount 口径冻结为 user-visible canonical objects
 * （artifacts + notes + resources；conversation 是会话不是对象，internal row /
 * revision / runtime event 一律不计）。lastMeaningfulEditedAt 来自 Core mutation
 * 活动（artifacts/runs/notes/project 的 max(updated_at)），与 last_opened_at 无关。
 *
 * P1-A2 ProjectVisualProfile：Presentation-only（不影响 Project business truth，
 * 不保存任意 SVG 字节）；glythMarkId 只能取 LCOS organic iconShapes repertoire。
 *
 * P1-B SkillCatalog：方案 1 只读（v0.15 裁定——usage-binding 延后 0.2）。
 * 复用 tools/lcos-agent/commands/skill-layers.mjs 的分层加载（system/user/merged）。
 */

// ==================== P1-A1：Project Summary ====================

export interface ProjectSummaryV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly name: string
  /** user-visible canonical objects 总数（artifacts + notes + resources）。 */
  readonly objectCount: number
  readonly objectCountDetail: {
    readonly artifacts: number
    readonly notes: number
    readonly resources: number
  }
  /** Core mutation 活动时间（max of artifacts/runs/notes/project updated_at）；未有任何活动时省略。 */
  readonly lastMeaningfulEditedAt?: string
}

// ==================== P1-A2：Project Visual Profile ====================

/** 允许的 Glyth Mark repertoire（= 前端 iconShapes.ts 的 LcosIconShape 全集）。 */
export const PROJECT_GLYPH_MARK_REPERTOIRE = [
  'pebble', 'leaf', 'capsule', 'egg', 'squircle', 'petal', 'paper',
] as const
export type ProjectGlyphMarkId = (typeof PROJECT_GLYPH_MARK_REPERTOIRE)[number]

/** 允许的 tint token（与前端主题 token 同源；扩展时两边同步）。 */
export const PROJECT_TINT_TOKENS = [
  'default', 'amber', 'sage', 'sky', 'rose', 'violet',
] as const
export type ProjectTintToken = (typeof PROJECT_TINT_TOKENS)[number]

/** Presentation-only 的项目视觉身份（versioned + CAS；restart 持久）。 */
export interface ProjectVisualProfileV0 {
  readonly schemaVersion: 0
  readonly projectId: string
  /** CAS 版本（从 0 起；PUT 带 expectedVersion，冲突返回 409）。 */
  readonly version: number
  readonly tintToken: ProjectTintToken
  readonly glythMarkId: ProjectGlyphMarkId
  readonly glythMarkColor?: string
  readonly scale?: number
  readonly orientation?: number
  readonly updatedAt: string
}

export interface UpsertProjectVisualProfileInputV0 {
  readonly tintToken: ProjectTintToken
  readonly glythMarkId: ProjectGlyphMarkId
  readonly glythMarkColor?: string
  readonly scale?: number
  readonly orientation?: number
  /** CAS：期望当前版本；首次创建传 0。 */
  readonly expectedVersion: number
}

// ==================== P1-B：Skill Catalog（只读） ====================

export type SkillCatalogSourceV1 = 'system' | 'user' | 'merged'

export interface SkillCatalogEntryV1 {
  readonly id: string
  readonly source: SkillCatalogSourceV1
  readonly name: string
  readonly description: string
}

export interface SkillCatalogReadV1 {
  readonly id: string
  readonly source: SkillCatalogSourceV1
  /** 合并视图正文（merged = system 原文 + ## User extensions + user 正文）。 */
  readonly content: string
}