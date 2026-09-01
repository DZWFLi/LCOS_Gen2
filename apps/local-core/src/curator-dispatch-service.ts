/**
 * CuratorDispatchService — P0-C semantic execution bridge.
 *
 * 施工边界（勿越界）：
 *   - 本 service 只做「把 Curator semantic intent 交给语义执行源」的 dispatch 与 ingest 缝合。
 *   - proposal 后续 lifecycle（persist / ghost preview / apply / accept / rollback）
 *     完全复用既有 ReorganizeService。本 service 不重写 Reorganize，不造第二套 AI 排版。
 *   - 运行态唯一投影 ExecutionItemV1：agentlet run 经 agentlet line 运行，
 *     proposal 结果挂在执行记录上；不另立 curator run state。
 *   - 不绕开 ReorganizeService 直接 mutate canvas；不 fallback「差不多解析」。
 */

import { CURATOR_AGENTLET_ID, validateCuratorReorganizeResult } from '@local-creative-os/contracts'
import type {
  CuratorDispatchFailureV1,
  CuratorReorganizeIntentV1,
  CuratorReorganizeResultV1,
} from '@local-creative-os/contracts'

import type { AgentletRuntimeService } from './agentlet-runtime-service.js'
import type { IntelligenceProviderService } from './intelligence-provider-service.js'
import type { ReorganizeService } from './reorganize-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'

/**
 * 可注入的语义 provider。P0-C 默认用规则/fake provider 让链路可单测闭环；
 * 真实 LLM provider 在最终本地 E2E 环境替换注入（接 ollama / openai / codex harness）。
 */
export interface CuratorSemanticProvider {
  readonly id: string
  /** 接收 intent + 项目现场快照，产出结构化 ReorganizeProposalV0；非法输出应 throw。 */
  generate(intent: CuratorReorganizeIntentV1, snapshot: CuratorProjectSnapshotV1): Promise<CuratorReorganizeResultV1>
}

export interface CuratorProjectSnapshotV1 {
  readonly presentationVersion: number
  readonly memberViewIds: readonly string[]
  readonly pinnedViewIds: readonly string[]
  readonly selectionViewIds: readonly string[]
  readonly entityTitles: Readonly<Record<string, string>>
}

export interface CuratorDispatchResultV1 {
  readonly run: {
    readonly id: string
    readonly agentletId: string
    readonly status: 'running'
    readonly sessionId: string
  }
}

export interface CuratorIngestResultV1 {
  readonly ok: true
  readonly proposalId: string
  readonly preview: ReturnType<ReorganizeService['preview']>
}

export class CuratorDispatchService {
  readonly #repository: SqliteMetadataRepository
  readonly #agentletRuntime: AgentletRuntimeService | undefined
  readonly #reorganize: ReorganizeService | undefined
  readonly #provider: CuratorSemanticProvider
  readonly #intelligence: IntelligenceProviderService | undefined

  constructor(deps: {
    readonly repository: SqliteMetadataRepository
    readonly agentletRuntime?: AgentletRuntimeService
    readonly reorganize?: ReorganizeService
    readonly intelligence?: IntelligenceProviderService
    readonly provider?: CuratorSemanticProvider
  }) {
    this.#repository = deps.repository
    this.#agentletRuntime = deps.agentletRuntime
    this.#reorganize = deps.reorganize
    this.#intelligence = deps.intelligence
    this.#provider = deps.provider ?? ruleBasedCuratorProvider()
  }

  /**
   * dispatch：把 curator intent 交给 agentlet 语义执行源（真实 spawn 子进程）。
   * 与 RuntimeDispatch 的关系：本刀用 agentlet line（本仓可真闭环）；
   * ExecutionItem 投影另行缝合。此处不自调 provider、不绕 ExecutionItem/Reorganize。
   */
  dispatch(intent: CuratorReorganizeIntentV1): CuratorDispatchResultV1 {
    if (intent.schemaVersion !== 1) throw new Error('INVALID_ARGUMENT: curator intent schemaVersion must be 1.')
    if (intent.presentationId.length === 0) throw new Error('INVALID_ARGUMENT: presentationId is required.')
    if (intent.intent.trim().length === 0) throw new Error('INVALID_ARGUMENT: intent is required.')
    if (this.#agentletRuntime === undefined) throw new Error('UNAVAILABLE: agentlet runtime is not configured.')
    if (this.#reorganize === undefined) throw new Error('UNAVAILABLE: reorganize service is not configured.')

    const run = this.#agentletRuntime.launch(intent.projectId, CURATOR_AGENTLET_ID, {
      instruction: JSON.stringify(intent),
    })
    return {
      run: {
        id: run.id,
        agentletId: run.agentlet,
        status: 'running',
        sessionId: run.sessionId,
      },
    }
  }

  /**
   * ingest：接收 harness 回传的结构化结果。严格 schema validation（fail-close）：
   *   合法 → 复用 ReorganizeService.create 持久化 proposal（ghost/apply 走既有通道）。
   *   非法 → 抛 CURATOR_INVALID_OUTPUT，不产出 ghost，不修改 canvas。
   */
  ingest(projectId: string, sessionId: string, result: unknown): CuratorIngestResultV1 {
    if (this.#reorganize === undefined) throw new Error('UNAVAILABLE: reorganize service is not configured.')
    let parsed: CuratorReorganizeResultV1
    try {
      validateCuratorReorganizeResult(result)
      parsed = result as CuratorReorganizeResultV1
    } catch (error: unknown) {
      const failure: CuratorDispatchFailureV1 = {
        code: 'invalid_output',
        message: `curator harness returned invalid output: ${error instanceof Error ? error.message : String(error)}`,
      }
      throw new Error(`CURATOR_INVALID_OUTPUT: ${failure.message}`)
    }
    if (parsed.proposal.projectId !== projectId) {
      throw new Error('CURATOR_INVALID_OUTPUT: proposal projectId does not match request.')
    }
    const proposal = this.#reorganize.create({
      projectId,
      presentationId: parsed.proposal.presentationId,
      baseVersion: parsed.proposal.baseVersion,
      mergeCandidates: parsed.proposal.mergeCandidates,
      removeMemberViewIds: parsed.proposal.removeMemberViewIds,
      artifactDeleteCandidates: parsed.proposal.artifactDeleteCandidates,
      ...(parsed.proposal.hierarchyPatch === undefined ? {} : { hierarchyPatch: parsed.proposal.hierarchyPatch }),
      ...(parsed.proposal.relationPatch === undefined ? {} : { relationPatch: parsed.proposal.relationPatch }),
      ...(parsed.proposal.emphasisPatch === undefined ? {} : { emphasisPatch: parsed.proposal.emphasisPatch }),
      ...(parsed.proposal.layoutIntent === undefined ? {} : { layoutIntent: parsed.proposal.layoutIntent }),
      ...(parsed.proposal.positionPatch === undefined || parsed.positionPlan === undefined
        ? {}
        : { positionPatch: parsed.positionPlan }),
    })
    void sessionId
    return { ok: true, proposalId: proposal.id, preview: this.#reorganize.preview(proposal.id) }
  }

  /** P0-C harness 语义生成 seam：Core 侧调真实 LLM（凭证在 Core），返回结构化结果或 unavailable。 */
  async semanticGenerate(request: { readonly schemaName: string; readonly schema: Record<string, unknown>; readonly system: string; readonly input: unknown }): Promise<{ readonly ok: boolean; readonly value?: Record<string, unknown>; readonly semanticUnavailable?: boolean }> {
    if (this.#intelligence === undefined) return { ok: false, semanticUnavailable: true }
    return this.#intelligence.generateSemantic(request)
  }

  /** 语义源是否可用（harness 据此决定接入真实 LLM 还是诚实降级）。 */
  async semanticUnavailable(): Promise<boolean> {
    if (this.#intelligence === undefined) return true
    const status = await this.#intelligence.status()
    return !status.available
  }
}

/**
 * 默认规则 provider：从项目现场快照产出「安全 reorder」proposal。
 * 仅用于让 dispatch/ingest 链路可单测闭环（真 proposal，非 mock）——
 * 真实语义分析由最终 E2E 环境的真实 LLM provider 替换本函数注入。
 */
function ruleBasedCuratorProvider(): CuratorSemanticProvider {
  return {
    id: 'lcos-curator-rule-v1',
    async generate(intent: CuratorReorganizeIntentV1, snapshot: CuratorProjectSnapshotV1): Promise<CuratorReorganizeResultV1> {
      const now = new Date().toISOString()
      const members = snapshot.memberViewIds
      const movable = members.filter((id) => !snapshot.pinnedViewIds.includes(id))
      const positionPatch: Record<string, { x: number; y: number }> = {}
      movable.forEach((id, index) => {
        positionPatch[id] = { x: 80 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 180 }
      })
      const proposal: CuratorReorganizeResultV1['proposal'] = {
        schemaVersion: 0,
        id: `reorg-curator-${Date.now()}`,
        projectId: intent.projectId,
        presentationId: intent.presentationId,
        baseVersion: snapshot.presentationVersion,
        status: 'pending',
        mergeCandidates: [],
        removeMemberViewIds: [],
        artifactDeleteCandidates: [],
        ...(Object.keys(positionPatch).length === 0 ? {} : { positionPatch }),
        layoutIntent: { engine: 'manual', preservePinned: true },
        createdAt: now,
      }
      return {
        schemaVersion: 1,
        kind: 'reorganize-proposal',
        agentletId: 'lcos-project-curator',
        proposal,
        summary: `已生成安全位置梳理提案（${movable.length} 个可移动视图）`,
        ...(Object.keys(positionPatch).length === 0 ? {} : { positionPlan: positionPatch }),
      }
    },
  }
}