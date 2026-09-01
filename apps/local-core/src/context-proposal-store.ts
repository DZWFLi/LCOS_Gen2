import { randomUUID } from 'node:crypto'

import type { ContextChangeProposalV1 } from '@local-creative-os/contracts'

import type { ActiveContextProjection } from './active-context-store.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'

export interface CreateContextProposalInput {
  readonly workspaceId?: string
  readonly baseContextVersion: number
  readonly addViewIds: readonly string[]
  readonly removeViewIds: readonly string[]
  readonly targetViewId?: string
  readonly reason: string
}

/**
 * Codex 上下文修改建议。建议不会直接改变 ActiveContext；
 * Accept 后由 Core 执行原子 Context Command，Reject/过期保留审计。
 */
export class ContextProposalStore {
  readonly #proposals = new Map<string, ContextChangeProposalV1[]>()
  readonly #listeners = new Map<string, Set<(projectId: string) => void>>()

  constructor(private readonly metadata?: SqliteMetadataRepository, private readonly projectEvents?: ProjectEventHub) {}

  /** 订阅某项目的提案变化（create/accept/reject 后触发）。 */
  subscribe(projectId: string, listener: (projectId: string) => void): () => void {
    let set = this.#listeners.get(projectId)
    if (set === undefined) {
      set = new Set()
      this.#listeners.set(projectId, set)
    }
    set.add(listener)
    return () => {
      const current = this.#listeners.get(projectId)
      if (current === undefined) return
      current.delete(listener)
      if (current.size === 0) this.#listeners.delete(projectId)
    }
  }

  #emit(projectId: string): void {
    this.projectEvents?.publish(projectId, {
      channel: 'proposal',
      type: 'proposal.changed',
      payload: { invalidated: true },
    })
    const set = this.#listeners.get(projectId)
    if (set === undefined) return
    for (const listener of set) {
      try { listener(projectId) } catch { /* 订阅者异常不能破坏提案存储 */ }
    }
  }

  create(projectId: string, input: CreateContextProposalInput, current: ActiveContextProjection): ContextChangeProposalV1 {
    if (input.baseContextVersion !== current.version) {
      throw new Error(`CONTEXT_STALE: base version ${input.baseContextVersion}, current ${current.version}.`)
    }
    const proposal: ContextChangeProposalV1 = {
      proposalId: `proposal-${randomUUID()}`,
      projectId,
      workspaceId: input.workspaceId ?? current.workspaceId,
      baseContextVersion: input.baseContextVersion,
      addViewIds: [...new Set(input.addViewIds)],
      removeViewIds: [...new Set(input.removeViewIds)],
      ...(input.targetViewId === undefined ? {} : { targetViewId: input.targetViewId }),
      reason: input.reason,
      createdBy: 'codex',
      status: 'pending',
    }
    this.metadata?.saveContextProposal(proposal)
    const existing = this.#proposals.get(projectId) ?? []
    this.#proposals.set(projectId, [...existing, proposal])
    this.#emit(projectId)
    return proposal
  }

  get(projectId: string, proposalId: string): ContextChangeProposalV1 | undefined {
    return (this.#proposals.get(projectId) ?? []).find((proposal) => proposal.proposalId === proposalId)
      ?? this.metadata?.getContextProposal(projectId, proposalId)
  }

  list(projectId: string, workspaceId?: string | null): readonly ContextChangeProposalV1[] {
    const persisted = this.metadata?.listContextProposals(projectId, workspaceId)
    if (persisted !== undefined) return persisted
    const values = this.#proposals.get(projectId) ?? []
    return workspaceId === undefined ? values : values.filter((proposal) => proposal.workspaceId === workspaceId)
  }

  accept(projectId: string, proposalId: string): ContextChangeProposalV1 {
    const proposal = this.get(projectId, proposalId)
    if (proposal === undefined) throw new Error('PROPOSAL_NOT_FOUND')
    if (proposal.status !== 'pending') throw new Error('PROPOSAL_NOT_PENDING')
    return this.#resolve(projectId, proposal, 'accepted')
  }

  reject(projectId: string, proposalId: string): ContextChangeProposalV1 {
    const proposal = this.get(projectId, proposalId)
    if (proposal === undefined) throw new Error('PROPOSAL_NOT_FOUND')
    if (proposal.status !== 'pending') throw new Error('PROPOSAL_NOT_PENDING')
    return this.#resolve(projectId, proposal, 'rejected')
  }

  #resolve(projectId: string, proposal: ContextChangeProposalV1, status: 'accepted' | 'rejected' | 'stale'): ContextChangeProposalV1 {
    const resolved: ContextChangeProposalV1 = { ...proposal, status }
    this.metadata?.saveContextProposal(resolved)
    const proposals = (this.#proposals.get(projectId) ?? []).filter((item) => item.proposalId !== proposal.proposalId)
    this.#proposals.set(projectId, [...proposals, resolved])
    this.#emit(projectId)
    return resolved
  }

  markStale(projectId: string, proposalId: string): ContextChangeProposalV1 {
    const proposal = this.get(projectId, proposalId)
    if (proposal === undefined) throw new Error('PROPOSAL_NOT_FOUND')
    return this.#resolve(projectId, proposal, 'stale')
  }
}
