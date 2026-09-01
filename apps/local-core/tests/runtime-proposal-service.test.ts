import { describe, expect, it } from 'vitest'

import { proposeRun, validateAgentExecutionPlan, type ProposeRunInput } from '../src/runtime-proposal-service.js'

function base(overrides: Partial<ProposeRunInput> = {}): ProposeRunInput {
  return {
    projectId: 'project-proposal',
    prompt: '分析这些参考材料的节奏问题',
    requestedProvider: 'auto',
    contextItems: [{ artifactId: 'a1', revisionId: 'r1', order: 1 }],
    editTargets: [],
    ...overrides,
  }
}

describe('Runtime Proposal Service (Gate F)', () => {
  it('uses only obvious UI facts for fallback intent', () => {
    const analyze = proposeRun(base())
    expect(analyze.proposal.intent).toBe('analyze')
    expect(analyze.proposal.resultPolicy).toEqual({ type: 'reply_only' })
    expect(analyze.decisionSource).toBe('fallback')

    const create = proposeRun(base({ createAsNewNode: true }))
    expect(create.proposal.intent).toBe('create')
    expect(create.proposal.resultPolicy).toEqual({ type: 'create_artifact' })

    const revise = proposeRun(base({
      editTargets: [{ artifactId: 'script', baseRevisionId: 'rev-current' }],
    }))
    expect(revise.proposal.intent).toBe('revise')
    expect(revise.proposal.resultPolicy).toEqual({ type: 'draft_revision_per_target' })
  })

  it('does not use prompt keywords as a second semantic decision engine', () => {
    const result = proposeRun(base({ prompt: '创建新文件并修改一下脚本' }))
    expect(result.proposal.intent).toBe('analyze')
  })

  it('validates an Agent-authored plan without reinterpreting its creative intent', () => {
    const plan = validateAgentExecutionPlan({
      schemaVersion: 1,
      projectId: 'project-proposal',
      prompt: '把开场压缩到三秒',
      intent: 'revise',
      requestedProvider: 'codex',
      contextItems: [{ artifactId: 'a1', revisionId: 'r1', order: 1 }],
      editTargets: [{ artifactId: 'script', baseRevisionId: 'rev-current' }],
      resultPolicy: { type: 'draft_revision_per_target' },
      humanSummary: '将修改《脚本》，并参考 1 项内容。',
      risks: [],
      requiresConfirmation: false,
    })
    expect(plan.intent).toBe('revise')
    expect(plan.humanSummary).toContain('脚本')
  })

  it('keeps Receiver / ordered references / ResultSlot through Agent validation', () => {
    const plan = validateAgentExecutionPlan({
      schemaVersion: 1,
      projectId: 'project-proposal',
      prompt: '按这些参考继续生成',
      intent: 'create',
      requestedProvider: 'auto',
      contextItems: [],
      editTargets: [],
      resultPolicy: { type: 'create_artifact' },
      receiverRef: { connectedConversationId: 'cc-r1c' },
      orderedReferences: [
        { ref: { type: 'scope', scopeId: 'scope-context' }, order: 0, mode: 'summary' },
        { ref: { type: 'artifact', artifactId: 'artifact-image' }, order: 1 },
      ],
      resultSlotId: 'slot-r1c',
      humanSummary: '交给当前对话，参考上下文和图片继续生成。',
      risks: [],
      requiresConfirmation: false,
    })
    expect(plan.receiverRef).toEqual({ connectedConversationId: 'cc-r1c' })
    expect(plan.orderedReferences?.map((item) => item.ref.type)).toEqual(['scope', 'artifact'])
    expect(plan.resultSlotId).toBe('slot-r1c')
  })

  it('rejects unsafe or internally inconsistent Agent plans', () => {
    expect(() => validateAgentExecutionPlan({
      schemaVersion: 1,
      projectId: 'project-proposal',
      prompt: '分析',
      intent: 'analyze',
      requestedProvider: 'codex',
      contextItems: [],
      editTargets: [{ artifactId: 'script', baseRevisionId: 'rev-current' }],
      resultPolicy: { type: 'reply_only' },
      humanSummary: '分析脚本。',
      risks: [],
      requiresConfirmation: false,
    })).toThrow(/analyze 不允许/)

    expect(() => validateAgentExecutionPlan({
      schemaVersion: 1,
      projectId: 'project-proposal',
      prompt: '创建',
      intent: 'create',
      requestedProvider: 'codex',
      contextItems: [],
      editTargets: [],
      resultPolicy: { type: 'draft_revision_per_target' },
      humanSummary: '创建新内容。',
      risks: [],
      requiresConfirmation: false,
    })).toThrow(/create 的结果去向/)
  })

  it('returns a minimal ambiguity only when fallback revise lacks a valid single target', () => {
    const result = proposeRun(base({ intent: 'revise', resultPolicy: { type: 'draft_revision_per_target' } }))
    expect(result.confidence).toBe('low')
    expect(result.ambiguity?.question).toContain('修改哪一项')
  })
})
