/**
 * SkillAuthorDispatchService — P0-D semantic execution bridge.
 *
 * 施工边界（勿越界）：
 *   - 本 service 只做「把 Skill Author semantic 炼制交给语义执行源」的 dispatch / ingest 缝合。
 *   - proposal 的 review / accept / install 全走既有 SkillProposalService + SkillPackageService（CAS）。
 *   - 运行态唯一投影 ExecutionItemV1：agentlet run 经 agentlet line 运行。
 *   - 不绕开 SkillProposalService 直接 install；不 fallback「差不多解析」。
 */

import { SKILL_AUTHOR_AGENTLET_ID, validateSkillAuthorResult } from '@local-creative-os/contracts'
import type { SkillAuthorResultV1, SkillAuthorExecuteIntentV1, SkillProposalV1 } from '@local-creative-os/contracts'
import { skillIdFromPrompt } from '@local-creative-os/contracts'

import type { AgentletRuntimeService } from './agentlet-runtime-service.js'
import type { IntelligenceProviderService } from './intelligence-provider-service.js'
import type { SkillProposalService } from './skill-proposal-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'

export interface SkillAuthorSemanticProvider {
  readonly id: string
  /** 接收 completed run 现场 + intent，产出结构化 Skill Author 结果；非法输出应 throw。 */
  generate(intent: SkillAuthorExecuteIntentV1, snapshot: SkillAuthorRunSnapshotV1): Promise<SkillAuthorResultV1>
}

export interface SkillAuthorRunSnapshotV1 {
  readonly prompt: string
  readonly outputIntent: 'create' | 'revise' | 'analyze'
  readonly provider: 'workbuddy' | 'codex'
  readonly runCompletedAt: string
}

export interface SkillAuthorDispatchResultV1 {
  readonly run: {
    readonly id: string
    readonly agentletId: string
    readonly status: 'running'
    readonly sessionId: string
  }
}

export interface SkillAuthorIngestResultV1 {
  readonly ok: true
  readonly proposalId: string
  readonly status: string
}

export class SkillAuthorDispatchService {
  readonly #repository: SqliteMetadataRepository
  readonly #agentletRuntime: AgentletRuntimeService | undefined
  readonly #skillProposals: SkillProposalService | undefined
  readonly #provider: SkillAuthorSemanticProvider
  readonly #intelligence: IntelligenceProviderService | undefined

  constructor(deps: {
    readonly repository: SqliteMetadataRepository
    readonly agentletRuntime?: AgentletRuntimeService
    readonly skillProposals?: SkillProposalService
    readonly intelligence?: IntelligenceProviderService
    readonly provider?: SkillAuthorSemanticProvider
  }) {
    this.#repository = deps.repository
    this.#agentletRuntime = deps.agentletRuntime
    this.#skillProposals = deps.skillProposals
    this.#intelligence = deps.intelligence
    this.#provider = deps.provider ?? ruleBasedSkillAuthorProvider()
  }

  dispatch(intent: SkillAuthorExecuteIntentV1): SkillAuthorDispatchResultV1 {
    if (intent.schemaVersion !== 1) throw new Error('INVALID_ARGUMENT: skill-author intent schemaVersion must be 1.')
    if (intent.runId.length === 0) throw new Error('INVALID_ARGUMENT: runId is required.')
    if (this.#agentletRuntime === undefined) throw new Error('UNAVAILABLE: agentlet runtime is not configured.')
    if (this.#skillProposals === undefined) throw new Error('UNAVAILABLE: skill proposal service is not configured.')
    const run = this.#agentletRuntime.launch(intent.projectId, SKILL_AUTHOR_AGENTLET_ID, {
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
   *   合法 → 把 draft 落成 SkillProposalV1（pending, createdBy=system），复用 proposal review 流。
   *   非法 → 抛 SKILL_AUTHOR_INVALID_OUTPUT，不产生 proposal，不 install。
   */
  ingest(projectId: string, sessionId: string, result: unknown): SkillAuthorIngestResultV1 {
    if (this.#skillProposals === undefined) throw new Error('UNAVAILABLE: skill proposal service is not configured.')
    let parsed: SkillAuthorResultV1
    try {
      validateSkillAuthorResult(result)
      parsed = result as SkillAuthorResultV1
    } catch (error: unknown) {
      throw new Error(`SKILL_AUTHOR_INVALID_OUTPUT: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (parsed.source.runId.length === 0) throw new Error('SKILL_AUTHOR_INVALID_OUTPUT: source runId is empty.')

    // 复用 S3 落盘语义：proposal 不直接 install；accept 才经 SkillPackageService.create（CAS）。
    const proposalId = `skill-author-${Date.now()}`
    const now = new Date().toISOString()
    const proposal: SkillProposalV1 = {
      schemaVersion: 1,
      proposalId: `skill-author-proposal-${proposalId}`,
      projectId,
      source: parsed.source,
      draft: parsed.draft,
      status: 'pending',
      createdBy: 'system',
      createdAt: now,
      updatedAt: now,
    }
    this.#repository.saveSkillProposal(proposal)
    void sessionId
    return { ok: true, proposalId: proposal.proposalId, status: proposal.status }
  }

  /** P0-D harness 语义生成 seam：Core 侧调真实 LLM（凭证在 Core），返回结构化结果或 unavailable。 */
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

/** 默认规则 provider：从 completed run 现场产出一个可复用 skill 底稿（Method/Fact 骨架）。 */
function ruleBasedSkillAuthorProvider(): SkillAuthorSemanticProvider {
  return {
    id: 'lcos-skill-author-rule-v1',
    async generate(intent: SkillAuthorExecuteIntentV1, snapshot: SkillAuthorRunSnapshotV1): Promise<SkillAuthorResultV1> {
      const baseId = skillIdFromPrompt(snapshot.prompt)
      const description = `从 Run ${intent.runId} 提炼的可复用方法（${snapshot.outputIntent}）。`.slice(0, 200)
      const content = `---
name: ${baseId}
description: ${description}
version: 0.1.0
---

# ${baseId}

## 何时用 / 何时不用

用：与来源 Run 相同类型的任务。不用：一次性事实整理。

## 方法（规则提炼底稿，待 Skill Author 语义提炼后复核）

1. 按来源 prompt 的方法组织同类任务。
2. 产出意图：${snapshot.outputIntent}。

## 来源

- Run：${intent.runId}（provider ${snapshot.provider}，completed at ${snapshot.runCompletedAt}）
`
      return {
        schemaVersion: 1,
        kind: 'skill-proposal',
        agentletId: 'lcos-skill-author',
        draft: { skillId: baseId, name: baseId, description, content },
        methodFact: { methods: ['按来源 prompt 组织同类任务'], facts: [] },
        source: {
          runId: intent.runId,
          prompt: snapshot.prompt,
          intent: snapshot.outputIntent,
          orderedReferenceCount: 0,
          provider: snapshot.provider,
          runCompletedAt: snapshot.runCompletedAt,
        },
        summary: `已生成可复用 Skill 底稿「${baseId}」`,
      }
    },
  }
}