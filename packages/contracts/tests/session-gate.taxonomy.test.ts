import { describe, expect, it } from 'vitest'
import {
  SESSION_PHASE_TRANSITIONS,
  RUN_STATUS_TO_SESSION_PHASE,
  isSessionTransitionAllowed,
  markSessionFresh,
  markSessionStale,
  type SessionLifecycleStateV1,
} from '../src/session-lifecycle'
import {
  evaluateExecutionGate,
  riskOfOperation,
  type ExecutionGateInput,
  type GateActorRole,
  type MutationRisk,
  type OperationScope,
  type PermissionScope,
} from '../src/execution-gate'

function session(phase: SessionLifecycleStateV1['phase'], staleFrom?: SessionLifecycleStateV1['staleFrom']): SessionLifecycleStateV1 {
  return { phase, ...(staleFrom === undefined ? {} : { staleFrom }), updatedAt: '2026-08-27T12:00:00.000Z' }
}

function gate(risk: MutationRisk, actor: GateActorRole, grantedScope: PermissionScope, operationScope: OperationScope, targets?: string[]): ExecutionGateInput {
  return { risk, actor, grantedScope, operationScope, ...(targets === undefined ? {} : { targets }) }
}

describe('Session 七态 taxonomy（G3）', () => {
  it('主轨六态 + stale = 七态；stale 不在转移表（旁路语义走 markStale/markFresh）', () => {
    const phases = Object.keys(SESSION_PHASE_TRANSITIONS)
    expect(phases).toHaveLength(6)
    expect(phases).not.toContain('stale')
  })

  it('核心转移合法：dormant→connecting→online→busy→waiting_input→busy→online', () => {
    expect(isSessionTransitionAllowed('dormant', 'connecting')).toBe(true)
    expect(isSessionTransitionAllowed('connecting', 'online')).toBe(true)
    expect(isSessionTransitionAllowed('online', 'busy')).toBe(true)
    expect(isSessionTransitionAllowed('busy', 'waiting_input')).toBe(true)
    expect(isSessionTransitionAllowed('waiting_input', 'busy')).toBe(true)
    expect(isSessionTransitionAllowed('busy', 'online')).toBe(true)
  })

  it('掉线/恢复链合法：活跃态→disconnected→connecting；显式关闭合法但执行中不许静默回 dormant', () => {
    for (const from of ['online', 'busy', 'waiting_input', 'connecting'] as const) {
      expect(isSessionTransitionAllowed(from, 'disconnected')).toBe(true)
    }
    expect(isSessionTransitionAllowed('disconnected', 'connecting')).toBe(true)
    // 显式关闭（空闲/掉线态 → dormant）合法
    expect(isSessionTransitionAllowed('online', 'dormant')).toBe(true)
    expect(isSessionTransitionAllowed('disconnected', 'dormant')).toBe(true)
    // 执行中/连接中不许静默关闭：busy/waiting_input/connecting → dormant 非法
    for (const from of ['busy', 'waiting_input', 'connecting'] as const) {
      expect(isSessionTransitionAllowed(from, 'dormant')).toBe(false)
    }
  })

  it('非法转移被拒：dormant→busy（未连接不许执行）；online→waiting_input（无 run 不等输入）', () => {
    expect(isSessionTransitionAllowed('dormant', 'busy')).toBe(false)
    expect(isSessionTransitionAllowed('online', 'waiting_input')).toBe(false)
  })

  it('run 状态投影：终态→online（会话不死）；running→busy；waiting_input 直通', () => {
    expect(RUN_STATUS_TO_SESSION_PHASE.completed).toBe('online')
    expect(RUN_STATUS_TO_SESSION_PHASE.failed).toBe('online')
    expect(RUN_STATUS_TO_SESSION_PHASE.canceled).toBe('online')
    expect(RUN_STATUS_TO_SESSION_PHASE.running).toBe('busy')
    expect(RUN_STATUS_TO_SESSION_PHASE.waiting_input).toBe('waiting_input')
    expect(RUN_STATUS_TO_SESSION_PHASE.created).toBe('connecting')
    expect(RUN_STATUS_TO_SESSION_PHASE.queued).toBe('connecting')
  })

  it('stale 旁路：进入保留主轨前态；退出回到前态；无前态兜底 online', () => {
    const busy = session('busy')
    const stale = markSessionStale(busy, 'revision changed by others', '2026-08-27T12:01:00.000Z')
    expect(stale.phase).toBe('stale')
    expect(stale.staleFrom).toBe('busy')
    const recovered = markSessionFresh(stale, 're-read', '2026-08-27T12:02:00.000Z')
    expect(recovered.phase).toBe('busy')
    const orphanStale = markSessionStale(session('stale'), 'again', '2026-08-27T12:03:00.000Z')
    expect(orphanStale.staleFrom).toBe('online')
  })
})

describe('Execution Gate taxonomy（G5/G11）', () => {
  it('safe 永远 allow（读零打扰，不受空间限制）；read_only 边界只拦写', () => {
    expect(evaluateExecutionGate(gate('safe', 'user', 'read_only', 'workspace'))).toEqual({ kind: 'allow' })
    expect(evaluateExecutionGate(gate('reversible', 'user', 'read_only', 'scene'))).toMatchObject({ kind: 'deny' })
  })

  it('reversible 覆盖→allow / 越界→confirm（ChangeSet 记账是静默的资格）', () => {
    expect(evaluateExecutionGate(gate('reversible', 'mcp_executor', 'scene', 'scene'))).toEqual({ kind: 'allow' })
    expect(evaluateExecutionGate(gate('reversible', 'mcp_executor', 'scene', 'project'))).toMatchObject({ kind: 'confirm', risk: 'reversible' })
  })

  it('structural 覆盖→preview（先看 diff）/ 越界→confirm', () => {
    expect(evaluateExecutionGate(gate('structural', 'user', 'project', 'scene'))).toEqual({ kind: 'preview', risk: 'structural', targets: [] })
    expect(evaluateExecutionGate(gate('structural', 'user', 'scene', 'project', ['布局重排']))).toMatchObject({ kind: 'confirm', targets: ['布局重排'] })
  })

  it('destructive/protected 覆盖→confirm / 越界→deny；scope 包含链 scene⊂project⊂workspace', () => {
    expect(evaluateExecutionGate(gate('destructive', 'user', 'project', 'scene'))).toMatchObject({ kind: 'confirm', risk: 'destructive' })
    expect(evaluateExecutionGate(gate('destructive', 'user', 'scene', 'project'))).toMatchObject({ kind: 'deny' })
    expect(evaluateExecutionGate(gate('protected', 'cli', 'workspace', 'workspace'))).toMatchObject({ kind: 'confirm' })
    expect(evaluateExecutionGate(gate('protected', 'user', 'project', 'workspace'))).toMatchObject({ kind: 'deny' })
  })

  it('mcp_agent 对 destructive/protected 一律 deny（agent 不代用户删除）', () => {
    expect(evaluateExecutionGate(gate('destructive', 'mcp_agent', 'workspace', 'scene'))).toMatchObject({ kind: 'deny' })
    expect(evaluateExecutionGate(gate('protected', 'mcp_agent', 'workspace', 'workspace'))).toMatchObject({ kind: 'deny' })
    // 但 reversible/structural 照常走矩阵（agent 的常规作业面不受限）
    expect(evaluateExecutionGate(gate('reversible', 'mcp_agent', 'project', 'project'))).toEqual({ kind: 'allow' })
  })

  it('操作风险映射 fail-closed：未登记操作按 protected 处理', () => {
    expect(riskOfOperation('space.read')).toBe('safe')
    expect(riskOfOperation('curation.text.update')).toBe('reversible')
    expect(riskOfOperation('presentation.apply')).toBe('structural')
    expect(riskOfOperation('artifact.delete')).toBe('destructive')
    expect(riskOfOperation('project.delete')).toBe('protected')
    expect(riskOfOperation('totally.unknown.op')).toBe('protected')
  })
})
