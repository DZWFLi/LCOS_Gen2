// Collaboration Contract V1 冻结测试（Gate 1）。
// 目标：把方案 §5-§10 / §21 / §22 的产品语义钉成可回归的形状，
// 防止后续 Track B-E 各自发明第二套 AgentStatus / capability / error。

import { describe, expect, it } from 'vitest'

import {
  collaborationProductErrorV1,
  unavailableCollaborationCapabilitiesV1,
} from '../src/collaboration-contract.js'

import type {
  CollaborationAdapterDescriptorV1,
  CollaborationCapabilitiesV1,
  CollaborationCommandInputV1,
  CollaborationProductErrorCodeV1,
  CollaborationSessionProjectionV1,
  CollaborationTimelineItemKindV1,
  CollaborationTimelineItemV1,
  CollaborationUserStateV1,
} from '../src/collaboration-contract.js'

describe('CollaborationUserStateV1', () => {
  it('只允许 6 个用户态（方案 §7）', () => {
    const states: readonly CollaborationUserStateV1[] = [
      'ready',
      'thinking',
      'working',
      'needs_user',
      'done',
      'unavailable',
    ]
    expect(states).toHaveLength(6)
  })
})

describe('CollaborationCapabilitiesV1', () => {
  it('fail-closed 默认值：动作全 false、诊断入口常开、每个 false 带原因', () => {
    const { capabilities, capabilityReasons } =
      unavailableCollaborationCapabilitiesV1('capability probe 未完成')

    const actionKeys = [
      'canSend',
      'canDelegate',
      'canResume',
      'canFork',
      'canHandoff',
      'canAnswerInput',
      'canApprove',
      'canCancel',
      'canRecover',
    ] as const satisfies readonly (keyof CollaborationCapabilitiesV1)[]

    for (const key of actionKeys) {
      expect(capabilities[key]).toBe(false)
      expect(capabilityReasons[key]).toBe('capability probe 未完成')
    }
    // 诊断是理解「为什么不可用」的入口，永远允许。
    expect(capabilities.canOpenDiagnostics).toBe(true)
  })
})

describe('CollaborationSessionProjectionV1', () => {
  it('最小合法投影不携带 provider / externalSessionId / RuntimeDispatch', () => {
    const { capabilities } = unavailableCollaborationCapabilitiesV1('未探测')

    const projection: CollaborationSessionProjectionV1 = {
      schemaVersion: 1,
      projectId: 'project-1',
      conversationId: 'connected-conversation-1',
      identity: { title: '驻场协作' },
      userState: 'ready',
      relation: { targetRefs: [] },
      activity: {},
      capabilities,
      recentReturns: [],
    }

    expect(projection.schemaVersion).toBe(1)
    // 产品投影的键集合冻结：provider 等工程字段不得出现。
    expect(Object.keys(projection).sort()).toEqual(
      [
        'schemaVersion',
        'projectId',
        'conversationId',
        'identity',
        'userState',
        'relation',
        'activity',
        'capabilities',
        'recentReturns',
      ].sort(),
    )
    expect('provider' in projection).toBe(false)
  })
})

describe('CollaborationTimelineItemV1', () => {
  it('item 种类与方案 §8 对齐（11 种，projection 而非 Turn 表）', () => {
    const kinds: readonly CollaborationTimelineItemKindV1[] = [
      'user_message',
      'agent_message',
      'work_started',
      'progress',
      'input_required',
      'approval_required',
      'result_returned',
      'result_adopted',
      'error',
      'recovered',
      'system_note',
    ]
    expect(kinds).toHaveLength(11)

    const item: CollaborationTimelineItemV1 = {
      schemaVersion: 1,
      itemId: 'run:run-1',
      kind: 'work_started',
      occurredAt: '2026-09-17T08:00:00.000Z',
      title: '开始执行',
      refs: { runId: 'run-1' },
    }
    expect(item.refs?.runId).toBe('run-1')
  })
})

describe('CollaborationProductErrorV1', () => {
  it('产品错误只允许方案 §21 的 8 种 code', () => {
    const codes: readonly CollaborationProductErrorCodeV1[] = [
      'unavailable',
      'needs_recovery',
      'permission_required',
      'input_required',
      'provider_offline',
      'operation_unknown',
      'operation_failed',
      'cancelled',
    ]
    expect(codes).toHaveLength(8)
  })

  it('工厂默认 retryable=false，diagnosticsRef 缺省时不出现在结果里', () => {
    const err = collaborationProductErrorV1('unavailable', '当前协作接不上，可以恢复或新开')
    expect(err.retryable).toBe(false)
    expect('diagnosticsRef' in err).toBe(false)

    const withRef = collaborationProductErrorV1('operation_failed', '执行失败', {
      diagnosticsRef: 'diag:host-timeout',
      retryable: true,
    })
    expect(withRef.diagnosticsRef).toBe('diag:host-timeout')
    expect(withRef.retryable).toBe(true)
  })
})

describe('CollaborationCommandInputV1', () => {
  it('9 种产品动作可按 kind 分发（send 与 delegate 不混）', () => {
    const inputs: readonly CollaborationCommandInputV1[] = [
      { kind: 'send', input: { conversationId: 'c-1', text: '继续' } },
      { kind: 'delegate', input: { projectId: 'p-1', instruction: '整理画布' } },
      { kind: 'resume', input: { conversationId: 'c-1' } },
      { kind: 'fork', input: { conversationId: 'c-1' } },
      { kind: 'handoff', input: { conversationId: 'c-1' } },
      { kind: 'answerInput', input: { pendingInputId: 'pi-1', answer: '是' } },
      { kind: 'approve', input: { returnId: 'r-1', decision: 'accept' } },
      { kind: 'cancel', input: { runId: 'run-1' } },
      { kind: 'recover', input: { continuationOperationId: 'op-1', action: 'reconcile' } },
    ]
    expect(inputs.map((i) => i.kind)).toEqual([
      'send',
      'delegate',
      'resume',
      'fork',
      'handoff',
      'answerInput',
      'approve',
      'cancel',
      'recover',
    ])
  })
})

describe('CollaborationAdapterDescriptorV1', () => {
  it('未探测时 snapshot 诚实缺席（undefined），不伪造能力', () => {
    const descriptor: CollaborationAdapterDescriptorV1 = {
      schemaVersion: 1,
      provider: 'huabu-agentlet',
      adapterId: 'huabu-host-gateway',
    }
    expect(descriptor.capabilitySnapshot).toBeUndefined()
  })
})