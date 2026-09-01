import type { ProjectEventOrigin, ProjectGraphSnapshot } from '@local-creative-os/contracts'
import type { ActiveContextV2, AgentContextItem, CanvasContextClusterV1, CanvasContextNodeV1, CanvasContextRecentChangeV1, CanvasContextRelationV1, CanvasContextViewportV1, ExplicitIntentV0 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'

export interface ActiveContextInput {
  readonly workspaceId?: string
  readonly scopeId: string
  readonly selectedViewIds: readonly string[]
  readonly pinnedContextIds: readonly string[]
  readonly excludedContextIds: readonly string[]
  readonly lockedContextIds?: readonly string[]
  readonly currentSurface?: string
  readonly currentHarness?: string
  readonly explicitIntent?: ExplicitIntentV0 | null
  readonly dismissedContinuityKeys?: readonly string[]
  readonly targetArtifactId?: string
  readonly targetRevisionId?: string
  readonly viewport?: { readonly x: number; readonly y: number; readonly zoom: number }
  readonly visibleViewIds?: readonly string[]
  readonly expectedVersion?: number
  readonly updatedBy?: 'web' | 'codex' | 'core'
  readonly sessionId?: string
  readonly origin?: ProjectEventOrigin
}

export interface ActiveContextProjection extends ActiveContextV2 {
  readonly workspaceId: string | null
  readonly scopeId: string | null
  readonly sessionId?: string
  readonly selectedArtifacts: readonly {
    readonly viewId: string
    readonly artifactId: string
    readonly title: string
    readonly kind: string
    readonly revisionId?: string
  }[]
  readonly contextArtifacts: readonly {
    readonly viewId: string
    readonly artifactId: string
    readonly title: string
    readonly kind: string
    readonly revisionId?: string
  }[]
  readonly targetArtifact?: {
    readonly artifactId: string
    readonly title: string
    readonly revisionId?: string
  }
}

export class ActiveContextConflictError extends Error {
  readonly code = 'ACTIVE_CONTEXT_CONFLICT'
  constructor(readonly expectedVersion: number, readonly currentVersion: number) {
    super(`ActiveContext version conflict: expected ${expectedVersion}, current ${currentVersion}.`)
  }
}

function contextKey(projectId: string, workspaceId: string | null | undefined): string {
  return `${projectId}::${workspaceId ?? '__project_overview__'}`
}

function semanticWorkStateFingerprint(value: Pick<ActiveContextV2, 'workspaceId' | 'scopeId' | 'selectedViewIds' | 'pinnedContextIds' | 'excludedContextIds' | 'lockedContextIds' | 'currentSurface' | 'currentHarness' | 'explicitIntent' | 'dismissedContinuityKeys' | 'targetArtifactId' | 'targetRevisionId'>): string {
  return JSON.stringify({
    workspaceId: value.workspaceId,
    scopeId: value.scopeId,
    selectedViewIds: value.selectedViewIds,
    pinnedContextIds: value.pinnedContextIds,
    excludedContextIds: value.excludedContextIds,
    lockedContextIds: value.lockedContextIds ?? [],
    currentSurface: value.currentSurface ?? null,
    currentHarness: value.currentHarness ?? null,
    explicitIntent: value.explicitIntent ?? null,
    dismissedContinuityKeys: value.dismissedContinuityKeys ?? [],
    targetArtifactId: value.targetArtifactId,
    targetRevisionId: value.targetRevisionId,
  })
}

export type ActiveContextListener = (
  projectId: string,
  workspaceId: string | null,
  value: ActiveContextProjection,
) => void

export class ActiveContextStore {
  readonly #values = new Map<string, ActiveContextProjection>()
  readonly #listeners = new Map<string, Set<ActiveContextListener>>()

  constructor(private readonly metadata?: SqliteMetadataRepository, private readonly projectEvents?: ProjectEventHub) {}

  /** Subscribe to version-advancing updates for one project+workspace context. */
  subscribe(projectId: string, workspaceId: string | null, listener: ActiveContextListener): () => void {
    const key = contextKey(projectId, workspaceId)
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

  #emit(projectId: string, workspaceId: string | null, value: ActiveContextProjection): void {
    const set = this.#listeners.get(contextKey(projectId, workspaceId))
    if (set === undefined) return
    for (const listener of set) {
      try {
        listener(projectId, workspaceId, value)
      } catch {
        // A broken subscriber must never break the context store.
      }
    }
  }

  get(projectId: string, graph: ProjectGraphSnapshot, workspaceId: string | null = null): ActiveContextProjection {
    const key = contextKey(projectId, workspaceId)
    const memory = this.#values.get(key)
    if (memory !== undefined) return this.#refreshGraphProjection(graph, memory)
    const persisted = this.metadata?.getActiveContext(projectId, workspaceId)
    if (persisted !== undefined) {
      const projected = this.#refreshGraphProjection(graph, persisted)
      this.#values.set(key, projected)
      return projected
    }
    return this.#project(graph, {
      ...(workspaceId === null ? {} : { workspaceId }),
      scopeId: String(graph.scopes[0]?.id ?? ''),
      selectedViewIds: [],
      pinnedContextIds: [],
      excludedContextIds: [],
    }, 0)
  }

  update(projectId: string, graph: ProjectGraphSnapshot, input: ActiveContextInput): ActiveContextProjection {
    const workspaceId = input.workspaceId ?? null
    const previous = this.get(projectId, graph, workspaceId)
    if (input.expectedVersion !== undefined && previous.version !== input.expectedVersion) {
      throw new ActiveContextConflictError(input.expectedVersion, previous.version)
    }
    const mergedInput: ActiveContextInput = {
      ...input,
      lockedContextIds: input.lockedContextIds ?? previous.lockedContextIds ?? [],
      ...((input.currentSurface ?? previous.currentSurface) === undefined ? {} : { currentSurface: input.currentSurface ?? previous.currentSurface }),
      ...((input.currentHarness ?? previous.currentHarness) === undefined ? {} : { currentHarness: input.currentHarness ?? previous.currentHarness }),
      ...((input.explicitIntent === null ? null : (input.explicitIntent ?? previous.explicitIntent)) === undefined
        ? {}
        : { explicitIntent: input.explicitIntent === null ? null : (input.explicitIntent ?? previous.explicitIntent) }),
      dismissedContinuityKeys: input.dismissedContinuityKeys ?? previous.dismissedContinuityKeys ?? [],
    }
    const candidate = this.#project(graph, mergedInput, previous.version + 1, undefined, previous.recentChanges)
    const semanticChanged = semanticWorkStateFingerprint(previous) !== semanticWorkStateFingerprint(candidate)
    const projected = semanticChanged ? candidate : { ...candidate, version: previous.version }
    const changes = this.#deriveRecentChanges(previous, projected)
    const next: ActiveContextProjection = {
      ...projected,
      recentChanges: [...(previous.recentChanges ?? []), ...changes].slice(-12),
    }
    this.metadata?.saveActiveContext(next)
    this.#values.set(contextKey(projectId, workspaceId), next)
    if (semanticChanged) {
      this.projectEvents?.publish(projectId, {
        channel: 'work_state',
        type: 'work_state.changed',
        ...(input.origin === undefined ? {} : { origin: input.origin }),
        entityRefs: workspaceId === null ? [] : [workspaceId],
        payload: { workspaceId, version: next.version, updatedAt: next.updatedAt, updatedBy: next.updatedBy },
      })
    }
    this.#emit(projectId, workspaceId, next)
    return next
  }

  #refreshGraphProjection(graph: ProjectGraphSnapshot, value: ActiveContextV2): ActiveContextProjection {
    return this.#project(graph, {
      ...(value.workspaceId === null ? {} : { workspaceId: value.workspaceId }),
      scopeId: value.scopeId ?? '',
      selectedViewIds: value.selectedViewIds,
      pinnedContextIds: value.pinnedContextIds,
      excludedContextIds: value.excludedContextIds,
      lockedContextIds: value.lockedContextIds ?? [],
      ...(value.currentSurface === undefined ? {} : { currentSurface: value.currentSurface }),
      ...(value.currentHarness === undefined ? {} : { currentHarness: value.currentHarness }),
      ...(value.explicitIntent === undefined ? {} : { explicitIntent: value.explicitIntent }),
      dismissedContinuityKeys: value.dismissedContinuityKeys ?? [],
      ...(value.targetArtifactId === null ? {} : { targetArtifactId: value.targetArtifactId }),
      ...(value.targetRevisionId === null ? {} : { targetRevisionId: value.targetRevisionId }),
      ...(value.viewport === undefined ? {} : {
        viewport: { x: value.viewport.x, y: value.viewport.y, zoom: value.viewport.zoom },
        visibleViewIds: value.viewport.visibleViewIds,
      }),
      updatedBy: value.updatedBy,
    }, value.version, value.updatedAt, value.recentChanges)
  }

  #project(graph: ProjectGraphSnapshot, input: ActiveContextInput, version: number, updatedAt = new Date().toISOString(), recentChanges: readonly CanvasContextRecentChangeV1[] = []): ActiveContextProjection {
    const views = new Map(graph.artifactViews.map((view) => [String(view.id), view]))
    const artifacts = new Map(graph.artifacts.map((artifact) => [String(artifact.id), artifact]))
    const resolveArtifacts = (viewIds: readonly string[]) => viewIds.flatMap((viewId) => {
      const view = views.get(viewId)
      const artifact = view === undefined ? undefined : artifacts.get(String(view.artifactId))
      if (view === undefined || artifact === undefined) return []
      return [{
        viewId,
        artifactId: String(artifact.id),
        title: artifact.title,
        kind: artifact.kind,
        ...(view.revisionId === undefined && artifact.currentRevisionId === undefined ? {} : { revisionId: String(view.revisionId ?? artifact.currentRevisionId) }),
      }]
    })
    const selectedViewIds = [...new Set(input.selectedViewIds)]
    const selectedArtifacts = resolveArtifacts(selectedViewIds)
    const excluded = new Set(input.excludedContextIds)
    const contextViewIds = [...new Set([...selectedViewIds, ...input.pinnedContextIds])].filter((viewId) => !excluded.has(viewId))
    const contextArtifacts = resolveArtifacts(contextViewIds)
    const targetArtifact = input.targetArtifactId === undefined ? undefined : artifacts.get(input.targetArtifactId)
    const targetProjection = targetArtifact === undefined ? undefined : {
      artifactId: String(targetArtifact.id),
      title: targetArtifact.title,
      ...(input.targetRevisionId === undefined ? {} : { revisionId: input.targetRevisionId }),
    }
    const contextItems: readonly AgentContextItem[] = contextArtifacts.map((item) => ({
      viewId: item.viewId,
      artifactId: item.artifactId,
      ...(item.revisionId === undefined ? {} : { revisionId: item.revisionId }),
      title: item.title,
      kind: item.kind,
      managed: artifacts.get(item.artifactId)?.managed ?? true,
    }))

    const visibleViewIds = [...new Set(input.visibleViewIds ?? contextViewIds)]
    const nodeViewIds = [...new Set([...visibleViewIds, ...contextViewIds])]
    const nodes: readonly CanvasContextNodeV1[] = nodeViewIds.flatMap((viewId) => {
      const view = views.get(viewId)
      const artifact = view === undefined ? undefined : artifacts.get(String(view.artifactId))
      if (view === undefined || artifact === undefined) return []
      return [{
        viewId,
        artifactId: String(artifact.id),
        ...(view.revisionId === undefined && artifact.currentRevisionId === undefined ? {} : { revisionId: String(view.revisionId ?? artifact.currentRevisionId) }),
        title: artifact.title,
        kind: artifact.kind,
        managed: artifact.managed ?? true,
        x: view.position.x,
        y: view.position.y,
        width: view.size.width,
        height: view.size.height,
        status: artifact.availability,
        summary: `${artifact.kind} · ${artifact.availability}`,
      }]
    })
    const visibleArtifactIds = new Set(nodes.map((node) => node.artifactId))
    const visibleViewIdSet = new Set(nodeViewIds)
    const clusterMap = new Map<string, { scopeId: string; kind: string; viewIds: string[]; minX: number; minY: number; maxX: number; maxY: number }>()
    for (const view of graph.artifactViews) {
      const viewId = String(view.id)
      if (visibleViewIdSet.has(viewId)) continue
      const artifact = artifacts.get(String(view.artifactId))
      if (artifact === undefined) continue
      const scopeId = String(view.scopeId)
      const key = `${scopeId}:${artifact.kind}`
      const current = clusterMap.get(key) ?? {
        scopeId,
        kind: artifact.kind,
        viewIds: [],
        minX: view.position.x,
        minY: view.position.y,
        maxX: view.position.x + view.size.width,
        maxY: view.position.y + view.size.height,
      }
      current.viewIds.push(viewId)
      current.minX = Math.min(current.minX, view.position.x)
      current.minY = Math.min(current.minY, view.position.y)
      current.maxX = Math.max(current.maxX, view.position.x + view.size.width)
      current.maxY = Math.max(current.maxY, view.position.y + view.size.height)
      clusterMap.set(key, current)
    }
    const offscreenClusters: readonly CanvasContextClusterV1[] = [...clusterMap.entries()]
      .map(([key, cluster]) => ({
        key,
        scopeId: cluster.scopeId,
        kind: cluster.kind,
        count: cluster.viewIds.length,
        viewIds: cluster.viewIds.slice(0, 50),
        bounds: {
          x: cluster.minX,
          y: cluster.minY,
          width: Math.max(0, cluster.maxX - cluster.minX),
          height: Math.max(0, cluster.maxY - cluster.minY),
        },
      }))
      .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key))
      .slice(0, 24)
    const relations: readonly CanvasContextRelationV1[] = graph.relations.flatMap((relation) => {
      if (relation.sourceEntityType !== 'artifact' || relation.targetEntityType !== 'artifact') return []
      if (!visibleArtifactIds.has(relation.sourceEntityId) && !visibleArtifactIds.has(relation.targetEntityId)) return []
      return [{
        id: String(relation.id),
        sourceArtifactId: relation.sourceEntityId,
        targetArtifactId: relation.targetEntityId,
        kind: relation.kind,
      }]
    })
    const viewport: CanvasContextViewportV1 | undefined = input.viewport === undefined
      ? undefined
      : { ...input.viewport, visibleViewIds }

    return {
      projectId: String(graph.project.id),
      schemaVersion: 2,
      workspaceId: input.workspaceId ?? null,
      scopeId: input.scopeId,
      selectedViewIds,
      selectionOrder: selectedViewIds,
      ...(viewport === undefined ? {} : { viewport }),
      nodes,
      relations,
      offscreenClusters,
      recentChanges,
      targetArtifactId: input.targetArtifactId ?? null,
      targetRevisionId: input.targetRevisionId ?? null,
      pinnedContextIds: [...new Set(input.pinnedContextIds)],
      excludedContextIds: [...new Set(input.excludedContextIds)],
      lockedContextIds: [...new Set(input.lockedContextIds ?? [])],
      ...(input.currentSurface === undefined ? {} : { currentSurface: input.currentSurface }),
      ...(input.currentHarness === undefined ? {} : { currentHarness: input.currentHarness }),
      ...(input.explicitIntent === undefined || input.explicitIntent === null ? {} : { explicitIntent: input.explicitIntent }),
      dismissedContinuityKeys: [...new Set(input.dismissedContinuityKeys ?? [])],
      contextItems,
      version,
      updatedAt,
      updatedBy: input.updatedBy ?? 'web',
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      selectedArtifacts,
      contextArtifacts,
      ...(targetProjection === undefined ? {} : { targetArtifact: targetProjection }),
    }
  }

  #deriveRecentChanges(previous: ActiveContextProjection, next: ActiveContextProjection): readonly CanvasContextRecentChangeV1[] {
    const changes: CanvasContextRecentChangeV1[] = []
    const add = (kind: CanvasContextRecentChangeV1['kind'], summary: string, viewIds?: readonly string[]) => changes.push({
      version: next.version,
      kind,
      summary,
      ...(viewIds === undefined || viewIds.length === 0 ? {} : { viewIds: [...new Set(viewIds)] }),
      occurredAt: next.updatedAt,
      updatedBy: next.updatedBy,
    })
    if (previous.selectedViewIds.join('\u0000') !== next.selectedViewIds.join('\u0000')) {
      add('selection', next.selectedViewIds.length === 0 ? '已清除临时选择' : `已选择 ${next.selectedViewIds.length} 个画布内容`, next.selectedViewIds)
    }
    if (previous.pinnedContextIds.join('\u0000') !== next.pinnedContextIds.join('\u0000')
      || previous.excludedContextIds.join('\u0000') !== next.excludedContextIds.join('\u0000')) {
      add('context', `参考内容已更新：${next.contextItems.length} 项可供 Agent 使用`, [...next.pinnedContextIds, ...next.excludedContextIds])
    }
    if ((previous.lockedContextIds ?? []).join('\u0000') !== (next.lockedContextIds ?? []).join('\u0000')) {
      add('lock', `保留约束已更新：${next.lockedContextIds?.length ?? 0} 项`, next.lockedContextIds)
    }
    if (previous.currentSurface !== next.currentSurface) {
      add('surface', next.currentSurface === undefined ? '已清除当前工作 Surface' : `当前工作 Surface：${next.currentSurface}`)
    }
    if (previous.currentHarness !== next.currentHarness) {
      add('harness', next.currentHarness === undefined ? '已清除当前 Harness' : `当前 Harness：${next.currentHarness}`)
    }
    if (JSON.stringify(previous.explicitIntent ?? null) !== JSON.stringify(next.explicitIntent ?? null)) {
      add('intent', next.explicitIntent === undefined ? '已清除显式工作意图' : `当前工作意图：${next.explicitIntent.goal ?? next.explicitIntent.type}`, next.selectedViewIds)
    }
    if (previous.targetArtifactId !== next.targetArtifactId || previous.targetRevisionId !== next.targetRevisionId) {
      add('target', next.targetArtifactId === null ? '已清除修改目标' : '已更新要修改的内容')
    }
    const beforeViewport = previous.viewport
    const afterViewport = next.viewport
    if ((beforeViewport === undefined) !== (afterViewport === undefined)
      || (beforeViewport !== undefined && afterViewport !== undefined
        && (beforeViewport.x !== afterViewport.x || beforeViewport.y !== afterViewport.y || beforeViewport.zoom !== afterViewport.zoom
          || beforeViewport.visibleViewIds.join('\u0000') !== afterViewport.visibleViewIds.join('\u0000')))) {
      add('viewport', `视口已更新：当前可见 ${afterViewport?.visibleViewIds.length ?? 0} 个内容`)
    }
    return changes
  }
}
