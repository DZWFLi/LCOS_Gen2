import type { AgentExecutionPlanV1, CreateRunProposal, RunProposalResult } from '@local-creative-os/contracts'

/**
 * GUI fallback：只根据“新节点开关”和明确单一编辑目标生成安全默认值。
 * 创作语义由 Agent/Skill 生成 AgentExecutionPlanV1；Core 不解析自然语言。
 * Proposal 不是执行记录：真正发送后才冻结 ContextManifest。
 */

function inferIntent(input: { readonly createAsNewNode?: boolean; readonly editTargetCount: number }): CreateRunProposal['intent'] {
  if (input.createAsNewNode === true) return 'create'
  if (input.editTargetCount === 1) return 'revise'
  return 'analyze'
}

function defaultResultPolicy(intent: CreateRunProposal['intent']): CreateRunProposal['resultPolicy'] {
  switch (intent) {
    case 'analyze': return { type: 'reply_only' }
    case 'create': return { type: 'create_artifact' }
    case 'revise': return { type: 'draft_revision_per_target' }
  }
}

function oneLineSummary(proposal: CreateRunProposal): string {
  const provider = proposal.requestedProvider === 'auto' ? 'Auto' : proposal.requestedProvider
  const contextCount = proposal.orderedReferences?.length ?? proposal.contextItems.length
  switch (proposal.intent) {
    case 'analyze':
      return `将参考 ${contextCount} 项，由 ${provider} 分析并${proposal.resultPolicy.type === 'reply_only' ? '直接回复' : '生成分析结果'}。`
    case 'create':
      return `将参考 ${contextCount} 项，由 ${provider} 新建${proposal.resultPolicy.type === 'create_collection' ? '一个内容集合' : '新内容'}。`
    case 'revise': {
      const target = proposal.editTargets[0]
      const targetLabel = target === undefined ? '（未指定目标）' : `「${target.artifactId ?? '?'} · ${target.baseRevisionId?.slice(0, 8) ?? '?'}」`
      const targets = proposal.editTargets.length > 1 ? `等 ${proposal.editTargets.length} 个对象` : ''
      return `将参考 ${contextCount} 项，由 ${provider} 修改${targetLabel}${targets}，生成新 Draft Revision。`
    }
  }
}

export type ProposeRunInput =
  & Omit<CreateRunProposal, 'intent' | 'resultPolicy'>
  & {
    readonly intent?: CreateRunProposal['intent']
    readonly resultPolicy?: CreateRunProposal['resultPolicy']
    readonly createAsNewNode?: boolean
    readonly decisionSource?: 'agent' | 'fallback'
  }

export function proposeRun(input: ProposeRunInput): RunProposalResult {
  const prompt = input.prompt.trim()
  if (prompt.length === 0) throw new Error('Run prompt is required.')
  if (!Array.isArray(input.editTargets) || input.editTargets.some((target) =>
    typeof target !== 'object' || target === null
    || typeof (target as { artifactId?: unknown }).artifactId !== 'string'
    || typeof (target as { baseRevisionId?: unknown }).baseRevisionId !== 'string',
  )) {
    throw new Error('editTargets 每个条目必须是 { artifactId: string, baseRevisionId: string }。')
  }
  const intent = input.intent ?? inferIntent({ ...(input.createAsNewNode === undefined ? {} : { createAsNewNode: input.createAsNewNode }), editTargetCount: input.editTargets.length })

  // Domain Guard（6.3）：analyze 禁止写目标文件；create 只能新建。
  let editTargets = input.editTargets
  if (intent === 'analyze' && editTargets.length > 0) {
    throw new Error('analyze 不允许指定修改目标；请把对象放入参考（Context）。')
  }
  if (intent === 'create' && editTargets.length > 0) {
    throw new Error('create 只能创建新 Artifact；修改已有对象请选择 revise。')
  }

  let resultPolicy = input.resultPolicy
  if (intent === 'revise' && resultPolicy?.type !== 'draft_revision_per_target') {
    if (resultPolicy !== undefined) {
      throw new Error('revise 的结果去向只能是“每个目标生成新 Draft Revision”。')
    }
    resultPolicy = defaultResultPolicy('revise')
  }
  if (intent === 'analyze' && resultPolicy !== undefined && !['reply_only', 'create_artifact'].includes(resultPolicy.type)) {
    throw new Error('analyze 的结果去向只能是直接回复或创建分析 Artifact。')
  }
  if (intent === 'create' && resultPolicy !== undefined && !['create_artifact', 'create_collection'].includes(resultPolicy.type)) {
    throw new Error('create 的结果去向只能是新建 Artifact 或内容集合。')
  }
  resultPolicy ??= defaultResultPolicy(intent)

  const proposal: CreateRunProposal = {
    projectId: input.projectId,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    prompt,
    intent,
    requestedProvider: input.requestedProvider,
    contextItems: input.contextItems,
    editTargets,
    resultPolicy,
    // F6 B6（P0-F）：Unified Contract 字段原样透传——CommandDraft→Proposal→Run 全链同一 identity。
    ...(input.receiverRef === undefined ? {} : { receiverRef: input.receiverRef }),
    ...(input.orderedReferences === undefined ? {} : { orderedReferences: input.orderedReferences }),
    ...(input.resultSlotId === undefined ? {} : { resultSlotId: input.resultSlotId }),
  }

  const summary = oneLineSummary(proposal)
  const ambiguity = intent === 'revise' && editTargets.length === 0
    ? { question: 'Agent 还不能确定要修改哪一项。请只保留一个主要对象，或打开“结果作为新节点”。' }
    : intent === 'revise' && editTargets.length > 1
      ? { question: '有多个同等修改目标。请只保留一个主要对象，其他内容继续作为参考。' }
      : undefined
  return {
    proposal,
    summary,
    confidence: ambiguity === undefined ? 'high' : 'low',
    decisionSource: input.decisionSource ?? 'fallback',
    ...(ambiguity === undefined ? {} : { ambiguity }),
  }
}


/**
 * Agent/Skill 已完成语义理解后的最小 Core Guard。
 * 这里只校验对象合同和 Run 生命周期组合，不重新解释自然语言。
 */
export function validateAgentExecutionPlan(input: AgentExecutionPlanV1): AgentExecutionPlanV1 {
  if (input.schemaVersion !== 1) throw new Error('Agent Plan schemaVersion must be 1.')
  const humanSummary = input.humanSummary.trim()
  if (!humanSummary || humanSummary.length > 500) throw new Error('Agent Plan humanSummary must be 1–500 characters.')
  if (!Array.isArray(input.risks) || input.risks.some((risk) => typeof risk !== 'string' || risk.length > 500)) {
    throw new Error('Agent Plan risks must be short strings.')
  }
  if (typeof input.requiresConfirmation !== 'boolean') throw new Error('Agent Plan requiresConfirmation must be boolean.')
  const guarded = proposeRun({
    projectId: input.projectId,
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    prompt: input.prompt,
    intent: input.intent,
    requestedProvider: input.requestedProvider,
    contextItems: input.contextItems,
    editTargets: input.editTargets,
    resultPolicy: input.resultPolicy,
    ...(input.receiverRef ? { receiverRef: input.receiverRef } : {}),
    ...(input.orderedReferences ? { orderedReferences: input.orderedReferences } : {}),
    ...(input.resultSlotId ? { resultSlotId: input.resultSlotId } : {}),
    decisionSource: 'agent',
  }).proposal
  return {
    schemaVersion: 1,
    ...guarded,
    humanSummary,
    risks: [...input.risks],
    requiresConfirmation: input.requiresConfirmation,
  }
}
