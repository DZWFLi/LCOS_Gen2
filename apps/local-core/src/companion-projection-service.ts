import type { ProjectId, Run } from '@local-creative-os/domain'
import { deriveCompanionAvailableActions } from '@local-creative-os/contracts'
import type { CompanionPendingReturnV1, CompanionProjectionV1 } from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ReceiverRuntimeService } from './receiver-runtime-service.js'
import type { ActiveContextStore } from './active-context-store.js'
import type { CaptureStagingService } from './capture-staging-service.js'
import type { RuntimeApplicationService } from './runtime-application-service.js'
import type { AgentletRuntimeService } from './agentlet-runtime-service.js'
import { ExecutionItemService } from './execution-item-service.js'

/**
 * CompanionProjectionV1 聚合器（P0，验收裁决 §7）。
 *
 * 只拼既有权属读面：project / receiver / activeContext / recentCapture /
 * pendingReturns / executionItems / runtimeStatus —— 零新状态存储，无副作用。
 * 每个 sub-read 委托给对应 service 的读面，本类不做任何二次写。
 *
 * 红线：desktop 只允许 import 本服务暴露的 /companion 路由，禁止直接 import
 * local-core 各业务 service（S4 gate 源码级校验）。
 */

/** 投影上限：Execution Stack 一页足够；不做分页（真实需要时 EXTEND）。 */
const MAX_ITEMS = 50

export interface CompanionProjectionQueryV1 {
  readonly workspaceId?: string | null
}

export class CompanionProjectionService {
  readonly #executionItems: ExecutionItemService

  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly receiverRuntime: ReceiverRuntimeService,
    private readonly activeContext: ActiveContextStore,
    private readonly captureStaging: CaptureStagingService,
    private readonly runtimeApplication: RuntimeApplicationService,
    private readonly agentletRuntime?: AgentletRuntimeService | undefined,
  ) {
    this.#executionItems = new ExecutionItemService(metadata, agentletRuntime)
  }

  async project(projectId: ProjectId, query: CompanionProjectionQueryV1 = {}): Promise<CompanionProjectionV1> {
    const projectIdStr = String(projectId)
    const now = new Date().toISOString()

    const project = this.metadata.getProject(projectIdStr)

    const binding = project === undefined ? null : this.receiverRuntime.getProjectReceiverBinding(projectIdStr)
    const conversations = project === undefined ? [] : this.receiverRuntime.listProjectConversations(projectIdStr)
    const activeReceiverId = binding?.activeReceiverId ?? null
    const pendingHandoff = project === undefined || activeReceiverId === null
      ? null
      : this.receiverRuntime.getPendingHandoff(projectIdStr, activeReceiverId)

    const graph = this.metadata.get(projectIdStr)
    const activeContext = graph === undefined ? null : this.activeContext.get(projectIdStr, graph, query.workspaceId ?? null)

    const executionItems = this.#executionItems.project(projectId)
    const availableActions = deriveCompanionAvailableActions(executionItems)

    const providers = await this.runtimeApplication.providers().catch(() => [])
    const bridgeOnline = providers.some((provider) => provider.availability !== 'offline')

    return {
      schemaVersion: 1,
      projectId: projectIdStr,
      project: project === undefined ? null : {
        id: String(project.id),
        name: project.name,
        rootPath: project.rootPath,
        activeConversationId: activeReceiverId,
      },
      receiver: {
        schemaVersion: 1,
        binding,
        conversations,
        pendingHandoff,
      },
      activeContext,
      recentCapture: this.captureStaging.listRecent(),
      pendingReturns: this.#pendingReturns(projectId),
      executionItems,
      availableActions,
      runtimeStatus: { providers, bridgeOnline },
      generatedAt: now,
    }
  }

  #pendingReturns(projectId: ProjectId): readonly CompanionPendingReturnV1[] {
    const runs = this.metadata.getProjectRuns(projectId, MAX_ITEMS)
    const results: CompanionPendingReturnV1[] = []
    for (const run of runs) {
      const returns = this.metadata.getArtifactReturns(run.id)
      for (const ret of returns) {
        if (ret.status !== 'pending_review') continue
        results.push({
          schemaVersion: 1,
          returnId: String(ret.id),
          runId: String(ret.runId),
          targetArtifactId: String(ret.targetArtifactId),
          canonicalPath: ret.canonicalPath,
          action: ret.action,
          runLabel: runLabel(run),
          createdAt: ret.createdAt,
        })
      }
    }
    return results
  }
}

function runLabel(run: Run): string {
  return run.shortSummary ?? run.instruction.slice(0, 80)
}
