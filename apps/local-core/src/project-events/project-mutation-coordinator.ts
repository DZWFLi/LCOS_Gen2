import type { MutationReceipt, ProjectEventOrigin } from '@local-creative-os/contracts'

import type { ProjectEventHub } from './project-event-hub.js'

interface ReceiptEntry { readonly expiresAt: number; readonly receipt: MutationReceipt }

export class ProjectMutationCoordinator {
  readonly #receipts = new Map<string, ReceiptEntry>()

  constructor(
    private readonly events: ProjectEventHub,
    private readonly ttlMs = 5 * 60_000,
    private readonly maxReceipts = 4_096,
    private readonly now: () => Date = () => new Date(),
  ) {}

  commit<Response>(args: {
    readonly projectId: string
    readonly origin: ProjectEventOrigin
    readonly persist: () => { readonly response: Response; readonly resultingVersion?: number }
  }): MutationReceipt<Response> {
    this.#prune()
    const key = this.#key(args.projectId, args.origin.operationId)
    const existing = this.#receipts.get(key)?.receipt
    if (existing !== undefined) return existing as MutationReceipt<Response>
    const result = args.persist()
    const receipt: MutationReceipt<Response> = {
      runtimeId: this.events.runtimeId,
      projectId: args.projectId,
      operationId: args.origin.operationId,
      origin: args.origin,
      ...(result.resultingVersion === undefined ? {} : { resultingVersion: result.resultingVersion }),
      projectSeq: this.events.currentSeq(args.projectId),
      response: result.response,
      committedAt: this.now().toISOString(),
    }
    this.#receipts.set(key, { receipt, expiresAt: this.now().getTime() + this.ttlMs })
    this.#prune()
    return receipt
  }

  lookup(projectId: string, operationId: string): MutationReceipt | undefined {
    this.#prune()
    return this.#receipts.get(this.#key(projectId, operationId))?.receipt
  }

  #key(projectId: string, operationId: string): string { return `${projectId}::${operationId}` }

  #prune(): void {
    const now = this.now().getTime()
    for (const [key, entry] of this.#receipts) if (entry.expiresAt <= now) this.#receipts.delete(key)
    while (this.#receipts.size > this.maxReceipts) this.#receipts.delete(this.#receipts.keys().next().value as string)
  }
}
