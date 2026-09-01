import { describe, expect, it } from 'vitest'

import {
  CLI_OPERATION_BY_COMMAND,
  MCP_OPERATION_BY_TOOL,
  cliDecisionAllows,
  evaluateCliGate,
  evaluateMcpGate,
  mcpDecisionAllows,
} from '../../../tools/lcos-agent/lib/execution-gate.mjs'

/**
 * Phase 6 Execution Gate · 三入口一致性（G5/G11）。
 * 判定矩阵本体在 packages/contracts（session-gate.taxonomy.test.ts 已逐格覆盖）；
 * 本文件测 CLI/MCP 入口的语义适配层：同一操作从两个口进来拿到同一风险分级。
 */

describe('Execution Gate · CLI 入口（actor=cli, scope=workspace）', () => {
  it('reversible（curation.text.create）覆盖 → allow：ChangeSet 记账是静默资格', async () => {
    const decision = await evaluateCliGate({ operation: 'curation.text.create', targets: ['p1'] })
    expect(decision.kind).toBe('allow')
  })

  it('structural（presentation.apply）覆盖 → preview：放行但调用方须打印预览', async () => {
    const decision = await evaluateCliGate({ operation: 'presentation.apply', targets: ['presentation:main'] })
    expect(decision.kind).toBe('preview')
    expect(cliDecisionAllows(decision, false)).toBe(true)
  })

  it('destructive（artifact.delete）覆盖 → confirm：无 --yes 拒、有 --yes 放', async () => {
    const decision = await evaluateCliGate({ operation: 'artifact.delete', targets: ['node-1'] })
    expect(decision.kind).toBe('confirm')
    expect(cliDecisionAllows(decision, false)).toBe(false)
    expect(cliDecisionAllows(decision, true)).toBe(true)
  })

  it('protected（project.delete）覆盖 → confirm 同样须 --yes', async () => {
    const decision = await evaluateCliGate({ operation: 'project.delete' })
    expect(cliDecisionAllows(decision, false)).toBe(false)
    expect(cliDecisionAllows(decision, true)).toBe(true)
  })

  it('safe（space.read）→ allow 零打扰', async () => {
    expect((await evaluateCliGate({ operation: 'space.read' })).kind).toBe('allow')
  })
})

describe('Execution Gate · MCP 入口（角色映射 G11）', () => {
  it('agent 角色（mcp_agent）：常规作业面不受限（reversible→allow、structural→preview 放行）', async () => {
    const reversible = await evaluateMcpGate({ operation: 'curation.text.create', role: 'agent' })
    expect(reversible.kind).toBe('allow')
    const structural = await evaluateMcpGate({ operation: 'relation.write', role: 'agent' })
    expect(mcpDecisionAllows(structural)).toBe(true)
  })

  it('agent 角色对 destructive/protected 一律 deny（agent 不代用户删除）', async () => {
    const destructive = await evaluateMcpGate({ operation: 'artifact.delete', role: 'agent' })
    expect(destructive.kind).toBe('deny')
    const protectedOp = await evaluateMcpGate({ operation: 'project.delete', role: 'agent' })
    expect(protectedOp.kind).toBe('deny')
    expect(mcpDecisionAllows(destructive)).toBe(false)
  })

  it('executor 角色（mcp_executor）：destructive 走 confirm（人在 GUI 侧决定，MCP 无确认面则阻断）', async () => {
    const decision = await evaluateMcpGate({ operation: 'artifact.delete', role: 'executor' })
    expect(decision.kind).toBe('confirm')
    expect(mcpDecisionAllows(decision)).toBe(false)
  })

  it('三入口一致性：artifact.delete 在 CLI=confirm(--yes 可过)、MCP agent=deny、MCP executor=confirm', async () => {
    const cli = await evaluateCliGate({ operation: 'artifact.delete' })
    const agent = await evaluateMcpGate({ operation: 'artifact.delete', role: 'agent' })
    const executor = await evaluateMcpGate({ operation: 'artifact.delete', role: 'executor' })
    expect(cli.kind).toBe('confirm')
    expect(agent.kind).toBe('deny')
    expect(executor.kind).toBe('confirm')
  })
})

describe('Execution Gate · 操作映射表（CLI 命令 / MCP 工具）', () => {
  it('CLI 写命令全部映射到契约操作键（未映射命令不过门 = 无写面）', () => {
    expect(CLI_OPERATION_BY_COMMAND['node.create-text']).toBe('curation.text.create')
    expect(CLI_OPERATION_BY_COMMAND['node.update-text']).toBe('curation.text.update')
    expect(CLI_OPERATION_BY_COMMAND['curation.apply']).toBe('curation.text.create')
    expect(CLI_OPERATION_BY_COMMAND['presentation.patch']).toBe('presentation.apply')
  })

  it('MCP 写面工具全部映射到契约操作键且风险 ≤ structural（现行工具面无 destructive）', async () => {
    for (const operation of Object.values(MCP_OPERATION_BY_TOOL)) {
      const decision = await evaluateMcpGate({ operation, role: 'agent' })
      expect(mcpDecisionAllows(decision)).toBe(true)
    }
  })

  it('未登记操作 fail-closed：按 protected 处理（agent 被 deny）', async () => {
    const decision = await evaluateMcpGate({ operation: 'totally.unknown.op', role: 'agent' })
    expect(decision.kind).toBe('deny')
  })
})
