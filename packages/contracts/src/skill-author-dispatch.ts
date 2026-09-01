/**
 * SkillAuthorDispatch — P0-D semantic execution bridge contract.
 *
 * 边界（P0-D 施工定义）：
 *   - 本契约只负责「把 Skill Author semantic 炼制交给语义执行源」的 input/output 形状。
 *   - proposal 的 review / accept / install 全走既有 SkillProposalService + SkillPackageService（CAS）。
 *   - 运行态唯一投影 ExecutionItemV1，本契约结果挂在执行记录上，不另立一套 run state。
 */

import type { SkillProposalDraftV1, SkillProposalSourceV1 } from './skill-proposal.js'
import type { SkillCompositionV1 } from './skill-composition.js'

/** lcos-skill-author 的 canonical agentlet identity。 */
export const SKILL_AUTHOR_AGENTLET_ID = 'lcos-skill-author' as const

/** Skill Author 语义执行的 input（GUI / RunRecipe → Local Core skill-author dispatch route）。 */
export interface SkillAuthorExecuteIntentV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  /** 来源 completed Run id（必须是 completed，才能炼制）。 */
  readonly runId: string
  /** 用户的一句话炼制意图（可空，缺省沿用 Run prompt）。 */
  readonly intent?: string
}

/** Method vs Fact 判定：换项目还能成立的才进 Method；一次性事实不进 Skill。 */
export interface SkillAuthorMethodFactV1 {
  readonly methods: readonly string[]
  readonly facts: readonly string[]
}

/** Skill Author 语义执行的结构化结果（harness 必须产出并通过 schema validation）。 */
export interface SkillAuthorResultV1 {
  readonly schemaVersion: 1
  readonly kind: 'skill-proposal'
  readonly agentletId: 'lcos-skill-author'
  /** 结构化 Skill 底稿（复用 S3 SkillProposalDraftV1）。 */
  readonly draft: SkillProposalDraftV1
  /** Method vs Fact 判定结果（骨架证据）。 */
  readonly methodFact: SkillAuthorMethodFactV1
  /** Root/Subskill 组成（复用 S8 SkillCompositionV1）。 */
  readonly composition?: SkillCompositionV1
  /** 来源 Run 摘要（复用 S3 SkillProposalSourceV1）。 */
  readonly source: SkillProposalSourceV1
  /** 一句话摘要，供 ExecutionItem / Review UI 展示。 */
  readonly summary: string
}

/** P0-D 封闭错误码表：不合法的输出必须是 invalid_output。 */
export type SkillAuthorDispatchErrorCodeV1 = 'invalid_output' | 'runtime_failed' | 'unavailable'

/**
 * 校验 harness 产出是否合法 Skill Author 结果（fail-close）。
 * 任一结构性不满足即抛错；调用方应转为 invalid_output 失败，不得降级成「差不多解析」。
 */
export function validateSkillAuthorResult(input: unknown): asserts input is SkillAuthorResultV1 {
  if (typeof input !== 'object' || input === null) throw new Error('Skill Author result must be an object.')
  const value = input as Partial<SkillAuthorResultV1>
  if (value.schemaVersion !== 1) throw new Error('Skill Author result schemaVersion must be 1.')
  if (value.kind !== 'skill-proposal') throw new Error('Skill Author result kind must be "skill-proposal".')
  if (value.agentletId !== 'lcos-skill-author') throw new Error('Skill Author result agentletId must be "lcos-skill-author".')
  if (typeof value.summary !== 'string' || value.summary.length === 0) throw new Error('Skill Author result summary is required.')
  const draft = value.draft
  if (typeof draft !== 'object' || draft === null) throw new Error('Skill Author result draft is required.')
  if (typeof draft.skillId !== 'string' || draft.skillId.length === 0) throw new Error('Draft skillId is required.')
  if (typeof draft.name !== 'string' || draft.name.length === 0) throw new Error('Draft name is required.')
  if (typeof draft.content !== 'string' || draft.content.length === 0) throw new Error('Draft content is required.')
  const methodFact = value.methodFact
  if (typeof methodFact !== 'object' || methodFact === null) throw new Error('Skill Author result methodFact is required.')
  if (!Array.isArray(methodFact.methods)) throw new Error('methodFact.methods must be an array.')
  if (!Array.isArray(methodFact.facts)) throw new Error('methodFact.facts must be an array.')
  const source = value.source
  if (typeof source !== 'object' || source === null) throw new Error('Skill Author result source is required.')
  if (typeof source.runId !== 'string' || source.runId.length === 0) throw new Error('Source runId is required.')
}