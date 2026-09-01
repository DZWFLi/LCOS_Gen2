/**
 * HU-2: Session ReadSet —— Agent 真正 full-read 过的 revision 基线。
 * Runtime ephemeral LRU（重启即丢，Agent 需重读）；Context relevance ≠ write authorization。
 */
export interface SessionReadLeaseV0 {
  readonly sessionId: string
  readonly projectId: string
  readonly artifactId: string
  readonly revisionId: string
  readonly contentHash?: string
  readonly fullyReadAt: string
}

const MAX_SESSIONS = 200
const MAX_LEASES_PER_SESSION = 500

export class SessionReadSet {
  readonly #sessions = new Map<string, Map<string, SessionReadLeaseV0>>()

  recordFullRead(input: {
    readonly sessionId: string
    readonly projectId: string
    readonly artifactId: string
    readonly revisionId: string
    readonly contentHash?: string
  }): SessionReadLeaseV0 {
    let leases = this.#sessions.get(input.sessionId)
    if (leases === undefined) {
      if (this.#sessions.size >= MAX_SESSIONS) {
        const oldest = this.#sessions.keys().next().value
        if (oldest !== undefined) this.#sessions.delete(oldest)
      }
      leases = new Map()
      this.#sessions.set(input.sessionId, leases)
    }
    const lease: SessionReadLeaseV0 = {
      sessionId: input.sessionId,
      projectId: input.projectId,
      artifactId: input.artifactId,
      revisionId: input.revisionId,
      ...(input.contentHash === undefined ? {} : { contentHash: input.contentHash }),
      fullyReadAt: new Date().toISOString(),
    }
    leases.set(input.artifactId, lease)
    if (leases.size > MAX_LEASES_PER_SESSION) {
      const oldestKey = leases.keys().next().value
      if (oldestKey !== undefined) leases.delete(oldestKey)
    }
    return lease
  }

  getLease(sessionId: string, artifactId: string): SessionReadLeaseV0 | undefined {
    return this.#sessions.get(sessionId)?.get(artifactId)
  }

  clearSession(sessionId: string): void {
    this.#sessions.delete(sessionId)
  }

  size(): number {
    let total = 0
    for (const leases of this.#sessions.values()) total += leases.size
    return total
  }
}
