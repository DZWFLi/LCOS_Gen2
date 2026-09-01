/**
 * CuratorDispatch — P0-C semantic execution bridge contract.
 *
 * 边界（P0-C 施工定义）：
 *   - 本契约只负责「把 Curator semantic intent 交给语义执行源」的 input/output 形状。
 *   - proposal 后续 lifecycle（persist / ghost preview / apply / accept / rollback）
 *     完全归既有 ReorganizeService 所有，本契约不重复定义。
 *   - 运行态唯一投影是 ExecutionItemV1；本契约结果挂在 ExecutionItem.resultRef/proposalRef，
 *     不另立一套 run state。
 */

import type { ReorganizeProposalV0 } from './reorganize.js'

/** lcos-project-curator 的 canonical agentlet identity（agentlet registry / capability 层消费）。 */
export const CURATOR_AGENTLET_ID = 'lcos-project-curator' as const

/** Curator 能处理的语义 intent（P0-C 第一刀只做 reorganize）。 */
export type CuratorIntentV0 = 'reorganize'

/** Curator semantic execution 的 input（GUI → Local Core curator dispatch route）。 */
export interface CuratorReorganizeIntentV1 {
  readonly schemaVersion: 1
  /** 目标 project。 */
  readonly projectId: string
  /** 要整理的目标 presentation（presentationId = presentation:context:<scopeId>）。 */
  readonly presentationId: string
  /** 目标 surface / context scope。 */
  readonly surfaceKind: 'main' | 'context' | 'workflow'
  readonly surfaceId: string
  /** 当前 Selection（实体视图 id 列表；空 = 整个画布）。 */
  readonly selectionViewIds: readonly string[]
  /** 用户的一句话语义意图（例如「按内容关系分组，减少交叉线」）。 */
  readonly intent: string
  /** 用户明确要求保留的 pinned 视图 id（curator 不得移动这些）。 */
  readonly lockedViewIds?: readonly string[]
}

/** Curator 语义执行的结构化结果（harness 必须产出并通过 schema validation）。 */
export interface CuratorReorganizeResultV1 {
  readonly schemaVersion: 1
  readonly kind: 'reorganize-proposal'
  readonly agentletId: 'lcos-project-curator'
  /** 结构化 ReorganizeProposalV0；content 归 ReorganizeService，此处只作传输。 */
  readonly proposal: ReorganizeProposalV0
  /** 一句话摘要，供 ExecutionItem / Review UI 展示。 */
  readonly summary: string
  /** 保留的 preset 位置坐标（presentation-only），用于 ghost preview。 */
  readonly positionPlan?: Readonly<Record<string, { readonly x: number; readonly y: number }>>
}

/** P0-C 封闭错误码表：不合法的输出必须是 invalid_output，不 fallback「差不多解析」。 */
export type CuratorDispatchErrorCodeV1 = 'invalid_output' | 'runtime_failed' | 'unavailable'

export interface CuratorDispatchFailureV1 {
  readonly code: CuratorDispatchErrorCodeV1
  readonly message: string
}

/**
 * 校验 harness 产出是否为合法 ReorganizeProposalV0。
 * 任一结构性不满足即抛错（fail-close）；调用方应转为 invalid_output 失败，
 * 不得降级成「差不多解析」，也不得产出 ghost / 修改 canvas。
 */
export function validateCuratorReorganizeResult(input: unknown): asserts input is CuratorReorganizeResultV1 {
  if (typeof input !== 'object' || input === null) throw new Error('Curator result must be an object.')
  const value = input as Partial<CuratorReorganizeResultV1>
  if (value.schemaVersion !== 1) throw new Error('Curator result schemaVersion must be 1.')
  if (value.kind !== 'reorganize-proposal') throw new Error('Curator result kind must be "reorganize-proposal".')
  if (value.agentletId !== 'lcos-project-curator') throw new Error('Curator result agentletId must be "lcos-project-curator".')
  if (typeof value.summary !== 'string' || value.summary.length === 0) throw new Error('Curator result summary is required.')
  const proposal = value.proposal
  if (typeof proposal !== 'object' || proposal === null) throw new Error('Curator result proposal is required.')
  if (typeof proposal.projectId !== 'string' || proposal.projectId.length === 0) throw new Error('Proposal projectId is required.')
  if (typeof proposal.presentationId !== 'string' || proposal.presentationId.length === 0) throw new Error('Proposal presentationId is required.')
  if (typeof proposal.baseVersion !== 'number' || !Number.isInteger(proposal.baseVersion)) throw new Error('Proposal baseVersion must be an integer.')
  if (!Array.isArray(proposal.mergeCandidates)) throw new Error('Proposal mergeCandidates must be an array.')
  if (!Array.isArray(proposal.removeMemberViewIds)) throw new Error('Proposal removeMemberViewIds must be an array.')
  if (!Array.isArray(proposal.artifactDeleteCandidates)) throw new Error('Proposal artifactDeleteCandidates must be an array.')
}