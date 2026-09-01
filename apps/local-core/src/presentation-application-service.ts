import type { PresentationStateV0, PresentationViewV0, ProjectEventOrigin } from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { PresentationRepository } from './presentation-repository.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'

/**
 * PresentationApplicationService — Phase B implementation.
 *
 * Presentation owns membership / position / hierarchy / display relation /
 * manual anchor / emphasis / renderer ONLY. It never owns business truth and
 * it never bumps project graphVersion.
 * Routes must not orchestrate presentation logic inline.
 */
export class PresentationConflictError extends Error {
  readonly code = 'STALE_PRESENTATION_VERSION'
  constructor(readonly currentVersion: number) {
    super(`Presentation version conflict: current version is ${currentVersion}.`)
  }
}

export interface PresentationSaveInput {
  readonly presentationId: string
  readonly scopeId: string
  readonly capability: PresentationViewV0['capability']
  readonly renderer: string
  readonly state: PresentationStateV0
  readonly expectedVersion: number
  readonly updatedBy: PresentationViewV0['updatedBy']
  readonly origin?: ProjectEventOrigin
}

export type PresentationChangeListener = (value: { readonly presentationId: string; readonly version: number; readonly updatedAt: string; readonly updatedBy: PresentationViewV0['updatedBy'] }) => void

export class PresentationApplicationService {
  readonly #listeners = new Map<string, Set<PresentationChangeListener>>()
  readonly #projectListeners = new Map<string, Set<PresentationChangeListener>>()

  constructor(
    private readonly repository: PresentationRepository,
    private readonly metadata: SqliteMetadataRepository,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly projectEvents?: ProjectEventHub,
  ) {}

  list(projectId: string): readonly PresentationViewV0[] {
    return this.repository.listPresentationViews(projectId)
  }

  get(projectId: string, presentationId: string): PresentationViewV0 | undefined {
    return this.repository.getPresentationView(projectId, presentationId)
  }

  save(projectId: string, input: PresentationSaveInput): PresentationViewV0 {
    if (this.metadata.getProject(projectId) === undefined) throw new Error('Project not found.')
    const scope = this.metadata.get(projectId)?.scopes.some((item) => String(item.id) === input.scopeId) ?? false
    if (!scope) throw new Error('Scope does not belong to the project.')
    this.#validateState(projectId, input.state)

    const now = this.now()
    const existing = this.repository.getPresentationView(projectId, input.presentationId)
    const view: PresentationViewV0 = {
      schemaVersion: 0,
      id: input.presentationId,
      projectId,
      scopeId: input.scopeId,
      capability: input.capability,
      renderer: input.renderer,
      state: input.state,
      version: existing === undefined ? 0 : existing.version + 1,
      updatedBy: input.updatedBy,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    if (existing === undefined) {
      if (input.expectedVersion !== 0) throw new PresentationConflictError(0)
      this.repository.insertPresentationView(view)
    } else {
      const result = this.repository.compareAndSwapPresentationView(view, input.expectedVersion)
      if (!result.updated) throw new PresentationConflictError(result.currentVersion)
    }
    this.#notify(projectId, input.presentationId, { version: view.version, updatedAt: view.updatedAt, updatedBy: view.updatedBy }, input.origin)
    return view
  }

  delete(projectId: string, presentationId: string): void {
    this.repository.deletePresentationView(projectId, presentationId)
    this.#notify(projectId, presentationId, { version: -1, updatedAt: this.now(), updatedBy: 'core' })
  }

  subscribe(projectId: string, presentationId: string, listener: PresentationChangeListener): () => void {
    const key = `${projectId}::${presentationId}`
    let set = this.#listeners.get(key)
    if (set === undefined) {
      set = new Set()
      this.#listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      const current = this.#listeners.get(key)
      if (current === undefined) return
      current.delete(listener)
      if (current.size === 0) this.#listeners.delete(key)
    }
  }

  /** Project-level invalidation channel. Payloads remain lightweight; clients
   * fetch the authoritative Presentation before applying a newer version. */
  subscribeProject(projectId: string, listener: PresentationChangeListener): () => void {
    let set = this.#projectListeners.get(projectId)
    if (set === undefined) {
      set = new Set()
      this.#projectListeners.set(projectId, set)
    }
    set.add(listener)
    return () => {
      const current = this.#projectListeners.get(projectId)
      if (current === undefined) return
      current.delete(listener)
      if (current.size === 0) this.#projectListeners.delete(projectId)
    }
  }

  #notify(projectId: string, presentationId: string, value: { readonly version: number; readonly updatedAt: string; readonly updatedBy: PresentationViewV0['updatedBy'] }, origin?: ProjectEventOrigin): void {
    const change = { presentationId, ...value }
    this.projectEvents?.publish(projectId, {
      channel: 'presentation',
      type: 'presentation.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [presentationId],
      payload: change,
    })
    for (const set of [this.#listeners.get(`${projectId}::${presentationId}`), this.#projectListeners.get(projectId)]) {
      if (set === undefined) continue
      for (const listener of set) {
        try { listener(change) } catch { /* listener errors never break the save */ }
      }
    }
  }

  #validateState(projectId: string, state: PresentationStateV0): void {
    const members = new Set(state.memberViewIds)
    for (const ref of state.memberEntityRefs ?? []) {
      if (ref.type === 'view') {
        const view = this.metadata.getArtifactView(ref.id)
        if (view === undefined || String(this.metadata.getArtifact(String(view.artifactId))?.projectId ?? '') !== projectId) {
          throw new Error(`Presentation entity ref ${ref.id} does not belong to the project.`)
        }
        continue
      }
      if (ref.type === 'workspace') {
        if (String(this.metadata.getWorkspace(ref.id)?.projectId ?? '') !== projectId) {
          throw new Error(`Presentation workspace ref ${ref.id} does not belong to the project.`)
        }
        continue
      }
      if (ref.type === 'scope') {
        const scopeExists = this.metadata.getScopes(projectId).some((scope) => String(scope.id) === ref.id)
        if (!scopeExists) throw new Error(`Presentation scope ref ${ref.id} does not belong to the project.`)
      }
    }
    for (const viewId of members) {
      const view = this.metadata.getArtifactView(viewId)
      if (view === undefined || String(this.metadata.getArtifact(String(view.artifactId))?.projectId ?? '') !== projectId) {
        throw new Error(`Presentation member ${viewId} does not belong to the project.`)
      }
    }
    for (const [viewId, parentId] of Object.entries(state.hierarchy.parentByViewId)) {
      if (!members.has(viewId)) throw new Error(`Hierarchy references non-member ${viewId}.`)
      if (parentId !== null && !members.has(parentId)) throw new Error(`Hierarchy parent ${parentId} is not a member.`)
    }
    for (const [parentId, order] of Object.entries(state.hierarchy.orderByParent)) {
      if (parentId !== '' && !members.has(parentId)) throw new Error(`Hierarchy order references non-member ${parentId}.`)
      for (const childId of order) {
        if (!members.has(childId)) throw new Error(`Hierarchy order child ${childId} is not a member.`)
      }
    }
    for (const edge of state.presentationEdges) {
      if (!members.has(edge.fromViewId)) throw new Error(`Presentation edge ${edge.id} references non-member ${edge.fromViewId}.`)
      if (!members.has(edge.toViewId)) throw new Error(`Presentation edge ${edge.id} references non-member ${edge.toViewId}.`)
    }
    const colonyIds = new Set<string>()
    for (const colony of state.colonies ?? []) {
      if (!colony.id.trim()) throw new Error('Spatial Colony requires id.')
      if (colonyIds.has(colony.id)) throw new Error(`Spatial Colony id ${colony.id} is duplicated.`)
      colonyIds.add(colony.id)
      if (!['main', 'context', 'workflow'].includes(colony.surface)) throw new Error(`Spatial Colony ${colony.id} has invalid Surface.`)
      if (!Array.isArray(colony.memberIds) || colony.memberIds.length === 0 || colony.memberIds.some((id) => typeof id !== 'string' || !id.trim()) || new Set(colony.memberIds).size !== colony.memberIds.length) {
        throw new Error(`Spatial Colony ${colony.id} member ids must be non-empty unique strings.`)
      }
      if (!Array.isArray(colony.contour?.points) || colony.contour.points.length < 3) throw new Error(`Spatial Colony ${colony.id} requires a closed contour.`)
      for (const point of colony.contour.points) {
        if (![point.x, point.y].every(Number.isFinite)) throw new Error(`Spatial Colony ${colony.id} contour must be finite.`)
      }
    }
    // Compatibility validation for pre-R3-A Presentation state. New writes use colonies.
    const spatialRegionIds = new Set<string>()
    for (const region of state.spatialRegions ?? []) {
      if (!region.id.trim()) throw new Error('Spatial region requires id.')
      if (spatialRegionIds.has(region.id)) throw new Error(`Spatial region id ${region.id} is duplicated.`)
      spatialRegionIds.add(region.id)
      const { x, y, width, height } = region.bounds
      if (![x, y, width, height].every(Number.isFinite)) throw new Error(`Spatial region ${region.id} bounds must be finite.`)
      if (width <= 0 || height <= 0) throw new Error(`Spatial region ${region.id} bounds must be positive.`)
    }
    const surfaceElementIds = new Set<string>()
    for (const element of state.surfaceElements ?? []) {
      if (!element.id.trim()) throw new Error('Surface element requires id.')
      if (surfaceElementIds.has(element.id)) throw new Error(`Surface element id ${element.id} is duplicated.`)
      surfaceElementIds.add(element.id)
      if (element.projectId !== projectId) throw new Error(`Surface element ${element.id} belongs to another project.`)
      const { x, y, w, h } = element.bounds
      if (![x, y, w, h].every(Number.isFinite)) throw new Error(`Surface element ${element.id} bounds must be finite.`)
      if (w <= 0 || h <= 0) throw new Error(`Surface element ${element.id} bounds must be positive.`)
      for (const value of Object.values(element.binding ?? {})) {
        if (typeof value === 'string') {
          if (!value.trim()) throw new Error(`Surface element ${element.id} binding ids must be non-empty strings.`)
          continue
        }
        if (!Array.isArray(value) || value.length === 0
          || value.some((id) => typeof id !== 'string' || !id.trim())
          || new Set(value).size !== value.length) {
          throw new Error(`Surface element ${element.id} binding ids must be non-empty unique strings.`)
        }
      }
      const zIndex = element.presentation?.zIndex
      if (zIndex !== undefined && !Number.isFinite(zIndex)) throw new Error(`Surface element ${element.id} zIndex must be finite.`)
    }
    const workflowActionIds = new Set((state.workflowActions ?? []).map((action) => action.id))
    if (workflowActionIds.size !== (state.workflowActions ?? []).length) throw new Error('Workflow action ids must be unique.')
    for (const action of state.workflowActions ?? []) {
      if (!action.id.trim() || !action.label.trim()) throw new Error('Workflow action requires id and label.')
      for (const viewId of action.attachedViewIds) {
        if (!members.has(viewId)) throw new Error(`Workflow action ${action.id} references non-member ${viewId}.`)
      }
    }
    for (const edge of state.workflowActionEdges ?? []) {
      if (!workflowActionIds.has(edge.fromActionId)) throw new Error(`Workflow action edge ${edge.id} references missing action ${edge.fromActionId}.`)
      if (!workflowActionIds.has(edge.toActionId)) throw new Error(`Workflow action edge ${edge.id} references missing action ${edge.toActionId}.`)
      if (edge.fromActionId === edge.toActionId) throw new Error(`Workflow action edge ${edge.id} cannot self-link.`)
    }
  }
}
