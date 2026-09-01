/**
 * SkillProposalService — RunRecipe → Skill Proposal seam（S3，审计 §6）。
 *
 * Completed Run → RunRecipe 摘要 → Skill Proposal（pending）→ accept = Skill Builder。
 *
 * 复用红线（gate 机器断言，零旁路）：
 *   1. 状态机四态与 context_proposals 一致（pending/accepted/rejected/stale）；
 *   2. 事件走 ProjectEventHub 同款 proposal.changed（与 ContextProposalStore #emit
 *      完全同 channel/type/payload——Execution Stack 已订阅该通道，零新审批 UI）；
 *   3. accept 落盘必须经 SkillPackageService.create（继承 S2 写保护沙箱 + provenance）。
 *
 * draft 是机器起草的结构化底稿：正文如实引用 run 的 prompt 与上下文结构，
 * 不编造方法论；用户审批时可编辑（S2 update）。
 */
import { randomUUID } from 'node:crypto'

import { skillIdFromPrompt } from '@local-creative-os/contracts'
import type { SkillProposalAcceptResultV1, SkillProposalSourceV1, SkillProposalV1 } from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { SkillPackageService } from './skill-package-service.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'

const INTENT_LABEL: Record<SkillProposalSourceV1['intent'], string> = {
  create: '新建产出',
  revise: '修订目标',
  analyze: '分析参考',
}

export class SkillProposalService {
  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly skillPackages: SkillPackageService,
    private readonly projectEvents?: ProjectEventHub,
  ) {}

  /** 与 ContextProposalStore #emit 同款事件（channel/type/payload 全一致——复用现有流）。 */
  #emit(projectId: string): void {
    this.projectEvents?.publish(projectId, {
      channel: 'proposal',
      type: 'proposal.changed',
      payload: { invalidated: true },
    })
  }

  /** Completed Run → Skill Proposal（run 结果 → 可复用方法结构化 → pending 提案）。 */
  async proposeFromRun(runIdInput: string): Promise<SkillProposalV1> {
    const runId = runIdInput as Parameters<SqliteMetadataRepository['getRun']>[0]
    const run = this.repository.getRun(runId)
    if (run === undefined) throw new Error(`Run not found: ${runId}`)
    if (run.status !== 'completed') throw new Error(`RUN_NOT_COMPLETED: only completed runs can become skill proposals (status=${run.status}).`)

    const prompt = run.instruction.trim()
    if (prompt.length === 0) throw new Error('Run instruction is empty — nothing to distill into a skill.')
    const orderedReferences = this.repository.getRunOrderedReferences(String(runId))
    const baseId = skillIdFromPrompt(prompt)
    const skillId = await this.#uniqueSkillId(String(run.projectId), baseId)

    const source: SkillProposalSourceV1 = {
      runId: String(runId),
      prompt,
      intent: run.outputIntent,
      orderedReferenceCount: orderedReferences.length,
      provider: run.provider,
      runCompletedAt: run.updatedAt,
    }
    const description = `从 Run ${String(runId)} 提炼的可复用方法（${INTENT_LABEL[run.outputIntent]}）。`.slice(0, 200)
    const draft = {
      skillId,
      name: skillId,
      description,
      content: buildDraftSkillMd(skillId, description, source),
    }
    const now = new Date().toISOString()
    const proposal: SkillProposalV1 = {
      schemaVersion: 1,
      proposalId: `skill-proposal-${randomUUID()}`,
      projectId: String(run.projectId),
      source,
      draft,
      status: 'pending',
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    }
    this.repository.saveSkillProposal(proposal)
    this.#emit(proposal.projectId)
    return proposal
  }

  /** skill id 去重：user 层已有同名 skill 或同项目有 pending 同 id 提案时追加序号。 */
  async #uniqueSkillId(projectId: string, baseId: string): Promise<string> {
    const existing = new Set(await this.skillPackages.listUserSkillIds(projectId))
    for (const proposal of this.repository.listSkillProposals(projectId)) {
      if (proposal.status === 'pending') existing.add(proposal.draft.skillId)
    }
    if (!existing.has(baseId)) return baseId
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${baseId}-${index}`
      if (!existing.has(candidate)) return candidate
    }
    throw new Error(`Cannot derive a unique skill id from "${baseId}".`)
  }

  list(projectId: string): readonly SkillProposalV1[] {
    return this.repository.listSkillProposals(projectId)
  }

  get(projectId: string, proposalId: string): SkillProposalV1 | undefined {
    return this.repository.getSkillProposal(projectId, proposalId)
  }

  /** accept = Skill Builder：复用 S2 SkillPackageService.create 落成 project user skill。 */
  async accept(projectId: string, proposalId: string): Promise<SkillProposalAcceptResultV1> {
    const proposal = this.repository.getSkillProposal(projectId, proposalId)
    if (proposal === undefined) throw new Error('SKILL_PROPOSAL_NOT_FOUND')
    if (proposal.status !== 'pending') throw new Error('SKILL_PROPOSAL_NOT_PENDING')
    // 落盘走 S2 Builder（写保护沙箱 + 结构校验 + provenance 全继承）——本 service 不直写文件。
    const created = await this.skillPackages.create(projectId, proposal.draft.skillId, proposal.draft.content)
    const resolved: SkillProposalV1 = { ...proposal, status: 'accepted', builtSkillId: created.id, updatedAt: new Date().toISOString() }
    this.repository.saveSkillProposal(resolved)
    this.#emit(projectId)
    return { proposal: resolved, skillId: created.id }
  }

  reject(projectId: string, proposalId: string): SkillProposalV1 {
    const proposal = this.repository.getSkillProposal(projectId, proposalId)
    if (proposal === undefined) throw new Error('SKILL_PROPOSAL_NOT_FOUND')
    if (proposal.status !== 'pending') throw new Error('SKILL_PROPOSAL_NOT_PENDING')
    const resolved: SkillProposalV1 = { ...proposal, status: 'rejected', updatedAt: new Date().toISOString() }
    this.repository.saveSkillProposal(resolved)
    this.#emit(projectId)
    return resolved
  }
}

/** draft SKILL.md 生成：结构如实来自 run recipe，不编造方法论。 */
function buildDraftSkillMd(skillId: string, description: string, source: SkillProposalSourceV1): string {
  return `---
name: ${skillId}
description: ${description}
version: 0.1.0
---

# ${skillId}

## 何时用 / 何时不用

用：与来源 Run 相同类型的任务（${INTENT_LABEL[source.intent]}），希望按同一方法复用。
不用：一次性事实整理、与来源 prompt 无关的新任务类型。

## 方法（来自 Run ${source.runId} 的结构化提炼）

来源 Run prompt：

\`\`\`text
${source.prompt}
\`\`\`

执行要点（系统从完成 Run 提炼的候选底稿，待 Skill Author 进一步完成 Method-vs-Fact 与 Root/Subskill 提炼后，方可视为成熟 Skill）：
1. 按来源 prompt 的方法组织同类任务。
2. ${source.orderedReferenceCount > 0 ? `复用来源 Run 的参考结构（${source.orderedReferenceCount} 项 ordered references）。` : '本方法无固定参考结构。'}
3. 产出意图：${INTENT_LABEL[source.intent]}。

## 来源

- Run：${source.runId}（provider ${source.provider}，completed at ${source.runCompletedAt}）
`
}
