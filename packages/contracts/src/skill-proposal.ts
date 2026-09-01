/**
 * SkillProposalV1 — RunRecipe → Skill Proposal seam 契约（S3，审计 §6 新链）。
 *
 * 链：Completed Run → RunRecipe 摘要 → Skill Proposal（pending）→ 用户审批
 * → accept = Skill Builder（复用 S2 SkillPackageService.create 落成 project user skill）。
 *
 * 复用红线（gate 机器断言，不许旁路）：
 *   - 状态机四态与 context_proposals CHECK 一致（pending/accepted/rejected/stale）；
 *   - 事件走 ProjectEventHub 同款 proposal.changed（Execution Stack 已订阅该通道，零新审批 UI）；
 *   - accept 的落盘必须经 S2 SkillPackageService.create（继承写保护沙箱 + provenance）。
 *
 * draft 是机器起草的结构化底稿：正文如实引用 run 的 prompt 与上下文结构，
 * 不编造方法论；用户审批时可编辑（S2 update）。
 */

/** 与 context_proposals 状态机一致（复用现有 proposal 生命周期，不新建审批通道）。 */
export type SkillProposalStatusV1 = 'pending' | 'accepted' | 'rejected' | 'stale'

/** RunRecipe 摘要（来源 run 的冻结读模型快照，与 GET /runs/:id/recipe 同源字段）。 */
export interface SkillProposalSourceV1 {
  readonly runId: string
  readonly prompt: string
  readonly intent: 'create' | 'revise' | 'analyze'
  readonly orderedReferenceCount: number
  readonly provider: 'workbuddy' | 'codex'
  readonly runCompletedAt: string
}

/** 机器起草的 Skill 底稿（结构化可复用方法表示）。 */
export interface SkillProposalDraftV1 {
  readonly skillId: string
  readonly name: string
  readonly description: string
  /** 完整 draft SKILL.md（frontmatter + 正文），accept 时原样交给 Skill Builder。 */
  readonly content: string
}

export interface SkillProposalV1 {
  readonly schemaVersion: 1
  readonly proposalId: string
  readonly projectId: string
  readonly source: SkillProposalSourceV1
  readonly draft: SkillProposalDraftV1
  readonly status: SkillProposalStatusV1
  readonly createdBy: 'system' | 'user'
  readonly createdAt: string
  readonly updatedAt: string
  /** accept 后由 Skill Builder 写入的 user skill id。 */
  readonly builtSkillId?: string
}

/** accept 结果（含 Builder 产出的 SkillPackageV1 摘要）。 */
export interface SkillProposalAcceptResultV1 {
  readonly proposal: SkillProposalV1
  readonly skillId: string
}

/** 从 run instruction 提炼合法 skill id（小写/数字/连字符，与 isValidSkillPackageId 对齐）。 */
export function skillIdFromPrompt(prompt: string): string {
  const slug = prompt
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'run-skill'
}
