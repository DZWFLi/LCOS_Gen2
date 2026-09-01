import { randomUUID } from 'node:crypto'

import type { ProjectEventEnvelope, ProjectEventReconnectV1 } from '@local-creative-os/contracts'

type PublishInput<Payload> = Omit<ProjectEventEnvelope<Payload>, 'runtimeId' | 'projectId' | 'projectSeq' | 'timestamp'>
type ProjectEventListener = (event: ProjectEventEnvelope) => void

interface ProjectEventState {
  nextSeq: number
  events: ProjectEventEnvelope[]
  listeners: Set<ProjectEventListener>
}

export class ProjectEventHub {
  readonly runtimeId: string
  readonly #projects = new Map<string, ProjectEventState>()

  constructor(
    private readonly maxEventsPerProject = 2_048,
    private readonly maxAgeMs = 2 * 60_000,
    private readonly now: () => Date = () => new Date(),
    runtimeId = randomUUID(),
  ) {
    this.runtimeId = runtimeId
  }

  publish<Payload>(projectId: string, input: PublishInput<Payload>): ProjectEventEnvelope<Payload> {
    const state = this.#state(projectId)
    const event: ProjectEventEnvelope<Payload> = {
      ...input,
      runtimeId: this.runtimeId,
      projectId,
      projectSeq: state.nextSeq++,
      timestamp: this.now().toISOString(),
    }
    state.events.push(event)
    this.#trim(state)
    for (const listener of state.listeners) {
      try { listener(event) } catch { /* observers cannot break committed writes */ }
    }
    return event
  }

  reconnect(projectId: string, lastSeenSeq: number, runtimeId?: string): ProjectEventReconnectV1 {
    const state = this.#state(projectId)
    const currentSeq = state.nextSeq - 1
    if (runtimeId !== undefined && runtimeId !== this.runtimeId) return { kind: 'snapshot_required', runtimeId: this.runtimeId, currentSeq }
    const first = state.events[0]
    if (first === undefined || lastSeenSeq < first.projectSeq - 1) return { kind: 'snapshot_required', runtimeId: this.runtimeId, currentSeq }
    return { kind: 'replay', runtimeId: this.runtimeId, currentSeq, events: state.events.filter((event) => event.projectSeq > lastSeenSeq) }
  }

  subscribe(projectId: string, listener: ProjectEventListener): () => void {
    const state = this.#state(projectId)
    state.listeners.add(listener)
    return () => state.listeners.delete(listener)
  }

  currentSeq(projectId: string): number { return this.#state(projectId).nextSeq - 1 }

  debugSnapshot(): Record<string, { projectSeq: number; subscribers: number; bufferSize: number; oldestSeq: number | null }> {
    return Object.fromEntries([...this.#projects.entries()].map(([projectId, state]) => [projectId, {
      projectSeq: state.nextSeq - 1,
      subscribers: state.listeners.size,
      bufferSize: state.events.length,
      oldestSeq: state.events[0]?.projectSeq ?? null,
    }]))
  }

  #state(projectId: string): ProjectEventState {
    let state = this.#projects.get(projectId)
    if (state === undefined) {
      state = { nextSeq: 1, events: [], listeners: new Set() }
      this.#projects.set(projectId, state)
    }
    return state
  }

  #trim(state: ProjectEventState): void {
    const cutoff = this.now().getTime() - this.maxAgeMs
    while (state.events.length > this.maxEventsPerProject || (state.events[0] !== undefined && Date.parse(state.events[0].timestamp) < cutoff)) state.events.shift()
  }
}
