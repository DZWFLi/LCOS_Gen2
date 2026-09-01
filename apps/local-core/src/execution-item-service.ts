import type { ProjectId } from '@local-creative-os/domain'
import { deriveAvailableActions, executionItemNeedsAttention } from '@local-creative-os/contracts'
import type { AgentletRunV1, ExecutionItemCapabilities, ExecutionItemState, ExecutionItemV1 } from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { AgentletRuntimeService } from './agentlet-runtime-service.js'

/**
 * ExecutionItemV1 读模型（S1）：从 canonical Run/ArtifactReturn 数据投影统一执行读模型。
 * 单一来源 Core——本 service 禁止 import bridge-rest-client（S1 gate 红线）。
 * availableActions 由 DEFAULT_CAPABILITIES × run 状态纯推导，不查 Bridge 副本。
 */

/** 当前 Core 声明的控制能力（= S0 census controlOperations 支持矩阵；gate 逐项对照）。 */
export const EXECUTION_ITEM_DEFAULT_CAPABILITIES: ExecutionItemCapabilities = {
  pause: false,
  resume: false,
  cancel: true,
  retry: true,
  answerInput: true,
}

/** 投影上限：Execution Stack 一页足够；不做分页（真实需要时 EXTEND）。 */
const MAX_ITEMS = 50

export class ExecutionItemService {
  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly agentletRuntime?: AgentletRuntimeService,
  ) {}

  project(projectId: ProjectId): readonly ExecutionItemV1[] {
    const runs = this.repository.getProjectRuns(projectId, MAX_ITEMS)
    const agentletItems = this.#agentletItems(projectId)
    const runItems = runs.map((run): ExecutionItemV1 => {
      const returns = this.repository.getArtifactReturns(run.id)
      const firstReturn = returns.at(-1)
      return {
        schemaVersion: 1,
        kind: 'run',
        id: `execution-${String(run.id)}`,
        runId: String(run.id),
        targetRef: run.targetArtifactId === undefined ? null : { kind: 'artifact', artifactId: String(run.targetArtifactId) },
        label: run.shortSummary ?? run.instruction.slice(0, 80),
        state: run.status,
        progress: null,
        needsAttention: executionItemNeedsAttention(run.status),
        availableActions: deriveAvailableActions(run.status, EXECUTION_ITEM_DEFAULT_CAPABILITIES),
        resultRef: firstReturn === undefined ? null : String(firstReturn.targetArtifactId),
        proposalRef: null,
        provider: run.provider,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
      }
    })
    return [...runItems, ...agentletItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_ITEMS)
  }

  /** agentlet run → ExecutionItemV1（kind:'agentlet'；只读投影，不引入 bridge，availableActions 诚实为空）。 */
  #agentletItems(projectId: ProjectId): readonly ExecutionItemV1[] {
    if (this.agentletRuntime === undefined) return []
    const runs = this.agentletRuntime.runs(String(projectId))
    return runs.map((run): ExecutionItemV1 => {
      const state = mapAgentletState(run.status)
      return {
        schemaVersion: 1,
        kind: 'agentlet',
        id: 'execution-agentlet-' + run.id,
        runId: run.id,
        targetRef: null,
        label: run.instruction ?? run.agentlet,
        state,
        progress: run.progress ?? null,
        needsAttention: executionItemNeedsAttention(state),
        availableActions: [],
        resultRef: null,
        proposalRef: null,
        provider: 'codex' as const,
        createdAt: run.startedAt,
        updatedAt: run.finishedAt ?? run.startedAt,
      }
    })
  }
}

/** AgentletRunStatusV1 → ExecutionItemState（时间戳/超时一律归为 failed 语义）。 */
function mapAgentletState(status: AgentletRunV1['status']): ExecutionItemState {
  switch (status) {
    case 'running': return 'running'
    case 'exited': return 'completed'
    case 'failed':
    case 'timeout': return 'failed'
  }
}