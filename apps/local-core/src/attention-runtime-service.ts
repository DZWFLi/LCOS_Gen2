import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import type {
  AttentionEvidenceV0,
  AttentionProjectionV0,
  AttentionRuntimeSnapshotV0,
  ContextContentLevelV0,
  ContextPackItemV0,
  ContextPackV0,
  ContinuityCandidateV0,
  IntentCandidateV0,
  IntentTypeV0,
  OpenLoopV0,
  SideEffectClassV0,
  SkillTargetProposalV0,
  WorkStateSnapshotV0,
} from '@local-creative-os/contracts'
import type { ProjectId } from '@local-creative-os/domain'
import type { ActiveContextStore } from './active-context-store.js'
import type { IntelligenceProviderService } from './intelligence-provider-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ProjectSearchService } from './project-search-service.js'
import type { SpatialRetrievalService } from './spatial-retrieval-service.js'

const DEFAULT_CONTEXT_BUDGET = 1_000
const MAX_RETRIEVAL = 8
const MAX_RELATED = 14
const MAX_MODEL_CACHE = 128
const TEXT_MIME = new Set(['text/plain', 'text/markdown', 'text/html', 'application/json', 'application/xml'])

function hashOf(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20)
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function confidenceBand(value: number): IntentCandidateV0['confidenceBand'] {
  if (value >= 0.82) return 'high'
  if (value >= 0.55) return 'medium'
  return 'low'
}

function expectedOutput(type: IntentTypeV0): string | undefined {
  switch (type) {
    case 'revise': return '更新后的版本或修改稿'
    case 'review': return '审核结论与修改建议'
    case 'extract_actions': return '结构化修改项 / Action Items'
    case 'create_brief': return '可交付 Brief'
    case 'compare': return '差异与取舍结论'
    case 'research': return '研究结论与来源'
    case 'organize': return '整理后的项目结构'
    case 'execute_skill': return 'Skill 执行准备'
    default: return undefined
  }
}

function skillHints(type: IntentTypeV0): readonly string[] {
  switch (type) {
    case 'revise': return ['script-revision']
    case 'review': return ['review']
    case 'extract_actions': return ['feedback-to-actions']
    case 'create_brief': return ['supplier-brief-builder']
    case 'compare': return ['compare-versions']
    case 'research': return ['research']
    case 'organize': return ['project-organize']
    case 'execute_skill': return ['selected-skill']
    default: return []
  }
}

function sideEffectFor(type: IntentTypeV0): SideEffectClassV0 {
  switch (type) {
    case 'understand':
    case 'compare':
    case 'review':
    case 'research':
    case 'unknown':
      return 'READ_ONLY'
    case 'revise':
      return 'LOCAL_MUTATION'
    default:
      return 'PREPARE'
  }
}

async function readPrefix(path: string | undefined, chars: number): Promise<string> {
  if (path === undefined || chars <= 0) return ''
  try {
    const handle = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(128_000, chars * 4 + 4))
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
      return buffer.subarray(0, bytesRead).toString('utf8').slice(0, chars).trim()
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

export interface AttentionRuntimeRequestV0 {
  readonly workspaceId?: string | null
  readonly explicitAction?: string
  readonly tokenBudget?: number
  readonly expandViewIds?: readonly string[]
  readonly fullViewIds?: readonly string[]
  /** B6 continuity：resume 时用绑定会话的 selectedViewIds 作为 Attention 恢复 seed。 */
  readonly seedViewIds?: readonly string[]
  readonly intentPolicy?: 'rules_only' | 'allow_model'
}

export class AttentionRuntimeService {
  readonly #modelCache = new Map<string, Promise<IntentCandidateV0 | undefined>>()

  constructor(
    private readonly repository: SqliteMetadataRepository,
    private readonly activeContext: ActiveContextStore,
    private readonly search: ProjectSearchService | undefined,
    private readonly spatial: SpatialRetrievalService | undefined,
    private readonly intelligence: IntelligenceProviderService,
  ) {}

  async snapshot(projectId: string, request: AttentionRuntimeRequestV0 = {}, signal?: AbortSignal): Promise<AttentionRuntimeSnapshotV0> {
    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error(`Project not found: ${projectId}`)
    const workspaceId = request.workspaceId ?? null
    const active = this.activeContext.get(projectId, graph, workspaceId)
    const workState = this.#workState(projectId, active)
    const intent = await this.#resolveIntent(projectId, workState, request.explicitAction, signal, request.intentPolicy !== 'rules_only')
    const attention = await this.#attention(projectId, workState, intent, request.seedViewIds ?? [])
    const candidates = this.#continuityCandidates(workState, intent, attention, active.dismissedContinuityKeys ?? [])
    const contextPack = await this.#composeContextPack(
      projectId,
      workState,
      intent,
      attention,
      request.tokenBudget ?? DEFAULT_CONTEXT_BUDGET,
      request.expandViewIds ?? [],
      request.fullViewIds ?? [],
    )
    const skillTarget = this.#routeSkillTarget(workState, intent)
    return { schemaVersion: 0, workState, intent, attention, candidates, contextPack, skillTarget }
  }

  workState(projectId: string, workspaceId: string | null = null): WorkStateSnapshotV0 {
    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error(`Project not found: ${projectId}`)
    return this.#workState(projectId, this.activeContext.get(projectId, graph, workspaceId))
  }

  async resolveIntent(projectId: string, request: { readonly workspaceId?: string | null; readonly explicitAction?: string } = {}): Promise<IntentCandidateV0> {
    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error(`Project not found: ${projectId}`)
    const workState = this.#workState(projectId, this.activeContext.get(projectId, graph, request.workspaceId ?? null))
    return this.#resolveIntent(projectId, workState, request.explicitAction)
  }

  async attention(projectId: string, request: { readonly workspaceId?: string | null; readonly explicitAction?: string } = {}): Promise<AttentionProjectionV0> {
    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error(`Project not found: ${projectId}`)
    const workState = this.#workState(projectId, this.activeContext.get(projectId, graph, request.workspaceId ?? null))
    const intent = await this.#resolveIntent(projectId, workState, request.explicitAction)
    return this.#attention(projectId, workState, intent)
  }

  dismissCandidate(projectId: string, workspaceId: string | null, key: string): WorkStateSnapshotV0 {
    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error(`Project not found: ${projectId}`)
    const current = this.activeContext.get(projectId, graph, workspaceId)
    this.activeContext.update(projectId, graph, {
      ...(workspaceId === null ? {} : { workspaceId }),
      scopeId: current.scopeId ?? '',
      selectedViewIds: current.selectedViewIds,
      pinnedContextIds: current.pinnedContextIds,
      excludedContextIds: current.excludedContextIds,
      lockedContextIds: current.lockedContextIds ?? [],
      ...(current.currentSurface === undefined ? {} : { currentSurface: current.currentSurface }),
      ...(current.currentHarness === undefined ? {} : { currentHarness: current.currentHarness }),
      ...(current.explicitIntent === undefined ? {} : { explicitIntent: current.explicitIntent }),
      dismissedContinuityKeys: unique([...(current.dismissedContinuityKeys ?? []), key]).slice(-50),
      ...(current.targetArtifactId === null ? {} : { targetArtifactId: current.targetArtifactId }),
      ...(current.targetRevisionId === null ? {} : { targetRevisionId: current.targetRevisionId }),
      ...(current.viewport === undefined ? {} : { viewport: { x: current.viewport.x, y: current.viewport.y, zoom: current.viewport.zoom }, visibleViewIds: current.viewport.visibleViewIds }),
      expectedVersion: current.version,
      updatedBy: 'web',
    })
    return this.#workState(projectId, this.activeContext.get(projectId, graph, workspaceId))
  }

  setExplicitIntent(projectId: string, workspaceId: string | null, intent: { readonly type: IntentTypeV0; readonly goal?: string } | null): WorkStateSnapshotV0 {
    const graph = this.repository.get(projectId)
    if (graph === undefined) throw new Error(`Project not found: ${projectId}`)
    const current = this.activeContext.get(projectId, graph, workspaceId)
    this.activeContext.update(projectId, graph, {
      ...(workspaceId === null ? {} : { workspaceId }),
      scopeId: current.scopeId ?? '',
      selectedViewIds: current.selectedViewIds,
      pinnedContextIds: current.pinnedContextIds,
      excludedContextIds: current.excludedContextIds,
      lockedContextIds: current.lockedContextIds ?? [],
      ...(current.currentSurface === undefined ? {} : { currentSurface: current.currentSurface }),
      ...(current.currentHarness === undefined ? {} : { currentHarness: current.currentHarness }),
      explicitIntent: intent,
      dismissedContinuityKeys: current.dismissedContinuityKeys ?? [],
      ...(current.targetArtifactId === null ? {} : { targetArtifactId: current.targetArtifactId }),
      ...(current.targetRevisionId === null ? {} : { targetRevisionId: current.targetRevisionId }),
      ...(current.viewport === undefined ? {} : { viewport: { x: current.viewport.x, y: current.viewport.y, zoom: current.viewport.zoom }, visibleViewIds: current.viewport.visibleViewIds }),
      expectedVersion: current.version,
      updatedBy: 'web',
    })
    return this.#workState(projectId, this.activeContext.get(projectId, graph, workspaceId))
  }

  #openLoops(projectId: string): readonly OpenLoopV0[] {
    const runs = this.repository.getProjectRuns(projectId as ProjectId, 40)
    const loops: OpenLoopV0[] = []
    for (const run of runs) {
      if (['created', 'queued', 'running', 'waiting_input'].includes(run.status)) {
        const viewIds = run.targetArtifactId === undefined
          ? []
          : this.repository.getArtifactViews(String(run.targetArtifactId)).map((view) => String(view.id)).slice(0, 4)
        loops.push({
          key: `run:${String(run.id)}`,
          title: run.instruction || '继续未完成 Agent 工作',
          status: run.status === 'running' || run.status === 'waiting_input' ? 'in_progress' : 'open',
          relatedViewIds: viewIds,
          source: 'runtime',
          updatedAt: run.updatedAt,
        })
      }
      const pending = this.repository.getArtifactReturns(run.id).filter((item) => item.status === 'pending_review')
      for (const item of pending) {
        const views = this.repository.getArtifactViews(String(item.targetArtifactId)).map((view) => String(view.id)).slice(0, 4)
        loops.push({
          key: `artifact-return:${String(item.id)}`,
          title: `审核 Agent 返回结果：${String(item.action)}`,
          status: 'review',
          relatedViewIds: views,
          source: 'artifact-return',
          updatedAt: item.createdAt,
        })
      }
    }
    return loops.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 12)
  }

  #workState(projectId: string, active: ReturnType<ActiveContextStore['get']>): WorkStateSnapshotV0 {
    const recentDelta = (active.recentChanges ?? [])
      .filter((change) => change.kind !== 'viewport')
      .slice(-8)
      .map((change) => ({
        id: `${active.projectId}:${change.version}:${change.kind}`,
        kind: change.kind,
        summary: change.summary,
        viewIds: change.viewIds ?? [],
        occurredAt: change.occurredAt,
        source: change.updatedBy,
      }))
    const openLoops = this.#openLoops(projectId)
    const semanticFingerprint = hashOf({
      projectId,
      workspaceId: active.workspaceId,
      scopeId: active.scopeId,
      selected: active.selectedViewIds,
      pinned: active.pinnedContextIds,
      excluded: active.excludedContextIds,
      locked: active.lockedContextIds ?? [],
      surface: active.currentSurface ?? null,
      harness: active.currentHarness ?? null,
      intent: active.explicitIntent ?? null,
      recent: recentDelta.map((item) => [item.kind, item.viewIds, item.summary]),
      loops: openLoops.map((item) => [item.key, item.status, item.updatedAt]),
    })
    const activeContextRef = active.scopeId?.startsWith('context:') ? active.scopeId : undefined
    const activeWorkflowRef = active.scopeId?.startsWith('workflow:') ? active.scopeId : undefined
    return {
      schemaVersion: 0,
      projectId,
      workspaceId: active.workspaceId,
      scopeId: active.scopeId,
      ...(active.currentSurface === undefined ? {} : { currentSurface: active.currentSurface }),
      ...(active.currentHarness === undefined ? {} : { currentHarness: active.currentHarness }),
      selectedViewIds: active.selectedViewIds,
      pinnedViewIds: active.pinnedContextIds,
      excludedViewIds: active.excludedContextIds,
      lockedViewIds: active.lockedContextIds ?? [],
      ...(activeContextRef === undefined ? {} : { activeContextRef }),
      ...(activeWorkflowRef === undefined ? {} : { activeWorkflowRef }),
      ...(active.explicitIntent === undefined ? {} : { explicitIntent: active.explicitIntent }),
      recentDelta,
      openLoops,
      semanticFingerprint,
      updatedAt: active.updatedAt,
    }
  }

  #viewTitles(projectId: string, viewIds: readonly string[]): readonly string[] {
    const graph = this.repository.get(projectId)
    if (graph === undefined) return []
    const artifacts = new Map(graph.artifacts.map((artifact) => [String(artifact.id), artifact]))
    return viewIds.flatMap((id) => {
      const view = graph.artifactViews.find((candidate) => String(candidate.id) === id)
      const artifact = view === undefined ? undefined : artifacts.get(String(view.artifactId))
      return artifact === undefined ? [] : [artifact.title]
    })
  }

  #ruleIntent(workState: WorkStateSnapshotV0, explicitAction?: string): IntentCandidateV0 {
    const now = new Date().toISOString()
    if (workState.explicitIntent !== undefined) {
      const type = workState.explicitIntent.type
      const output = expectedOutput(type)
      return {
        type,
        objectViewIds: workState.selectedViewIds,
        goal: workState.explicitIntent.goal?.trim() || this.#defaultGoal(type, workState),
        constraints: this.#viewTitles(workState.projectId, workState.lockedViewIds),
        ...(output === undefined ? {} : { expectedOutput: output }),
        evidenceKeys: ['explicit-intent'],
        suggestedSkillIds: skillHints(type),
        confidence: 0.99,
        confidenceBand: 'high',
        source: 'explicit',
        createdAt: now,
      }
    }
    const text = [explicitAction ?? '', ...workState.openLoops.slice(0, 3).map((item) => item.title)].join(' ').toLowerCase()
    const rules: readonly { readonly type: IntentTypeV0; readonly rx: RegExp; readonly confidence: number }[] = [
      { type: 'compare', rx: /对比|比较|差异|compare|diff/, confidence: 0.92 },
      { type: 'review', rx: /审核|复核|检查|review|verify|验收/, confidence: 0.9 },
      { type: 'extract_actions', rx: /修改项|行动项|action items?|反馈.*整理|feedback.*action/, confidence: 0.9 },
      { type: 'create_brief', rx: /brief|简报|供应商|交付说明/, confidence: 0.88 },
      { type: 'revise', rx: /修改|修订|改稿|调整|revise|rewrite|update|edit/, confidence: 0.86 },
      { type: 'research', rx: /研究|调研|查找|搜索|research|look up/, confidence: 0.85 },
      { type: 'organize', rx: /整理|归纳|组织|分类|organize|group/, confidence: 0.82 },
      { type: 'execute_skill', rx: /skill|技能|执行方法|run skill/, confidence: 0.85 },
      { type: 'continue_work', rx: /继续|接着|resume|continue|未完成/, confidence: 0.8 },
    ]
    const matched = rules.find((rule) => rule.rx.test(text))
    let type: IntentTypeV0
    let confidence: number
    if (matched !== undefined) {
      type = matched.type
      confidence = matched.confidence
    } else if (workState.selectedViewIds.length >= 2) {
      type = 'understand'
      confidence = 0.62
    } else if (workState.selectedViewIds.length === 1 || workState.pinnedViewIds.length > 0) {
      type = 'understand'
      confidence = 0.58
    } else if (workState.openLoops.length > 0) {
      type = 'continue_work'
      confidence = 0.68
    } else {
      type = 'unknown'
      confidence = 0.3
    }
    const output = expectedOutput(type)
    return {
      type,
      objectViewIds: unique([...workState.selectedViewIds, ...workState.openLoops.slice(0, 2).flatMap((item) => item.relatedViewIds)]),
      goal: explicitAction?.trim() || this.#defaultGoal(type, workState),
      constraints: this.#viewTitles(workState.projectId, workState.lockedViewIds),
      ...(output === undefined ? {} : { expectedOutput: output }),
      evidenceKeys: unique([
        ...(explicitAction?.trim() ? ['explicit-action'] : []),
        ...workState.selectedViewIds.map((id) => `selected:${id}`),
        ...workState.openLoops.slice(0, 2).map((item) => item.key),
      ]),
      suggestedSkillIds: skillHints(type),
      confidence,
      confidenceBand: confidenceBand(confidence),
      source: matched !== undefined ? 'rule' : 'fallback',
      createdAt: now,
    }
  }

  #defaultGoal(type: IntentTypeV0, workState: WorkStateSnapshotV0): string {
    const titles = this.#viewTitles(workState.projectId, workState.selectedViewIds).slice(0, 2)
    const subject = titles.length ? titles.join('、') : '当前工作'
    switch (type) {
      case 'continue_work': return `继续 ${workState.openLoops[0]?.title ?? subject}`
      case 'compare': return `比较 ${subject}`
      case 'revise': return `修改 ${subject}`
      case 'review': return `审核 ${subject}`
      case 'extract_actions': return `从 ${subject} 提炼修改项`
      case 'create_brief': return `基于 ${subject} 生成 Brief`
      case 'organize': return `整理 ${subject}`
      case 'research': return `围绕 ${subject} 补充研究`
      case 'execute_skill': return `为 ${subject} 准备 Skill`
      case 'understand': return `理解 ${subject}`
      default: return '确认当前工作目标'
    }
  }

  async #resolveIntent(projectId: string, workState: WorkStateSnapshotV0, explicitAction?: string, signal?: AbortSignal, allowModel = true): Promise<IntentCandidateV0> {
    const rule = this.#ruleIntent(workState, explicitAction)
    if (!allowModel || rule.source === 'explicit' || rule.confidence >= 0.82 || (explicitAction?.trim().length ?? 0) > 0) return rule
    const key = hashOf({ fingerprint: workState.semanticFingerprint, action: explicitAction ?? '' })
    const cached = signal === undefined ? this.#modelCache.get(key) : undefined
    if (cached !== undefined) return (await cached) ?? rule
    const promise = this.intelligence.inferIntent({
      ...(explicitAction?.trim() ? { explicitAction: explicitAction.trim() } : {}),
      selectionTitles: this.#viewTitles(projectId, workState.selectedViewIds),
      pinnedTitles: this.#viewTitles(projectId, workState.pinnedViewIds),
      openLoops: workState.openLoops.slice(0, 5).map((item) => item.title),
      recentDelta: workState.recentDelta.slice(-5).map((item) => item.summary),
      ...(workState.currentSurface === undefined ? {} : { currentSurface: workState.currentSurface }),
    }, signal).then((model): IntentCandidateV0 | undefined => {
      if (model === undefined) return undefined
      const confidence = clamp(model.confidence)
      const output = model.expectedOutput ?? expectedOutput(model.type)
      return {
        type: model.type,
        objectViewIds: unique([...workState.selectedViewIds, ...workState.openLoops.slice(0, 2).flatMap((item) => item.relatedViewIds)]),
        goal: model.goal,
        constraints: unique([...model.constraints, ...this.#viewTitles(projectId, workState.lockedViewIds)]),
        ...(output === undefined ? {} : { expectedOutput: output }),
        evidenceKeys: unique([...workState.selectedViewIds.map((id) => `selected:${id}`), ...workState.openLoops.slice(0, 2).map((item) => item.key)]),
        suggestedSkillIds: skillHints(model.type),
        confidence,
        confidenceBand: confidenceBand(confidence),
        source: 'model',
        modelProviderId: model.providerId,
        ...(model.model === undefined ? {} : { modelId: model.model }),
        createdAt: new Date().toISOString(),
      }
    }).catch(() => undefined)
    if (signal === undefined) {
      this.#modelCache.set(key, promise)
      if (this.#modelCache.size > MAX_MODEL_CACHE) this.#modelCache.delete(this.#modelCache.keys().next().value as string)
    }
    return (await promise) ?? rule
  }

  async #attention(projectId: string, workState: WorkStateSnapshotV0, intent: IntentCandidateV0, seedViewIds: readonly string[] = []): Promise<AttentionProjectionV0> {
    const graph = this.repository.get(projectId)
    if (graph === undefined) return { selected: [], pinned: [], related: [], retrieved: [] }
    const views = new Map(graph.artifactViews.map((view) => [String(view.id), view]))
    const artifacts = new Map(graph.artifacts.map((artifact) => [String(artifact.id), artifact]))
    const excluded = new Set(workState.excludedViewIds)
    const selectedSet = new Set(workState.selectedViewIds)
    const pinnedSet = new Set(workState.pinnedViewIds)
    const lockedSet = new Set(workState.lockedViewIds)
    const seeds = unique([...workState.selectedViewIds, ...workState.pinnedViewIds, ...intent.objectViewIds, ...seedViewIds]).filter((id) => views.has(id))
    const all = new Map<string, AttentionEvidenceV0[]>()
    const titleOf = (viewId: string): { title: string; artifactId?: string } => {
      const view = views.get(viewId)
      const artifact = view === undefined ? undefined : artifacts.get(String(view.artifactId))
      return artifact === undefined ? { title: viewId } : { title: artifact.title, artifactId: String(artifact.id) }
    }
    const add = (viewId: string, source: AttentionEvidenceV0['source'], bucket: AttentionEvidenceV0['bucket'], strength: number, reason: string, extra: Partial<AttentionEvidenceV0> = {}): void => {
      if (!views.has(viewId) || excluded.has(viewId)) return
      const identity = titleOf(viewId)
      const item: AttentionEvidenceV0 = {
        key: `${source}:${viewId}`,
        viewId,
        ...(identity.artifactId === undefined ? {} : { artifactId: identity.artifactId }),
        title: identity.title,
        bucket,
        source,
        strength: clamp(strength),
        reason,
        provenance: extra.provenance ?? `project:${projectId}`,
        ...(extra.relationPath === undefined ? {} : { relationPath: extra.relationPath }),
        ...(extra.spatial === undefined ? {} : { spatial: extra.spatial }),
        ...(extra.freshness === undefined ? {} : { freshness: extra.freshness }),
      }
      all.set(viewId, [...(all.get(viewId) ?? []), item])
    }

    for (const id of workState.selectedViewIds) add(id, 'selected', 'selected', 1, '用户明确选择')
    for (const id of workState.pinnedViewIds) if (!selectedSet.has(id)) add(id, 'pinned', 'pinned', 0.98, '用户明确 Pin')
    for (const id of workState.lockedViewIds) if (!selectedSet.has(id) && !pinnedSet.has(id)) add(id, 'locked', 'pinned', 0.97, 'Locked / Preserve：可以理解，但不要建议修改')

    const viewIdsByArtifact = new Map<string, string[]>()
    for (const view of graph.artifactViews) {
      const key = String(view.artifactId)
      viewIdsByArtifact.set(key, [...(viewIdsByArtifact.get(key) ?? []), String(view.id)])
    }
    const endpoints = new Set<string>()
    for (const seed of seeds) {
      endpoints.add(`view:${seed}`)
      const view = views.get(seed)
      if (view !== undefined) endpoints.add(`artifact:${String(view.artifactId)}`)
    }
    const viewsForEndpoint = (type: string, id: string): readonly string[] => {
      if (type === 'view') return views.has(id) ? [id] : []
      if (type === 'artifact') return viewIdsByArtifact.get(id) ?? []
      return []
    }
    for (const relation of graph.relations) {
      const sourceKey = `${relation.sourceEntityType}:${relation.sourceEntityId}`
      const targetKey = `${relation.targetEntityType}:${relation.targetEntityId}`
      const sourceSeed = endpoints.has(sourceKey)
      const targetSeed = endpoints.has(targetKey)
      if (!sourceSeed && !targetSeed) continue
      const other = sourceSeed
        ? viewsForEndpoint(relation.targetEntityType, relation.targetEntityId)
        : viewsForEndpoint(relation.sourceEntityType, relation.sourceEntityId)
      for (const viewId of other) add(viewId, 'explicit_relation', 'related', 0.94, `显式 Relation：${relation.kind}`, { relationPath: [String(relation.id)] })
    }

    const presentations = this.repository.listPresentationViews(projectId)
    const addLocality = (capability: 'context' | 'custom' | 'workflow', source: AttentionEvidenceV0['source'], strength: number, label: string): void => {
      for (const presentation of presentations.filter((item) => item.capability === capability)) {
        const members = presentation.state.memberViewIds
        if (!members.some((id) => seeds.includes(id))) continue
        for (const id of members) if (!seeds.includes(id)) add(id, source, 'related', strength, `${label}：${presentation.scopeId}`, { provenance: presentation.id })
      }
    }
    addLocality('context', 'same_context', 0.84, '同一 Context')
    addLocality('custom', 'same_collection', 0.81, '同一 Collection / local group')
    addLocality('workflow', 'workflow_requirement', 0.88, '同一 Workflow Requirement')

    const currentWorkspace = workState.workspaceId === null ? undefined : graph.workspaces.find((item) => String(item.id) === workState.workspaceId)
    if (currentWorkspace !== undefined) {
      const members = currentWorkspace.focusedViewIds.map(String)
      if (members.some((id) => seeds.includes(id))) {
        for (const id of members) if (!seeds.includes(id)) add(id, 'same_scene', 'related', 0.7, `同一工作现场：${currentWorkspace.name}`, { provenance: `workspace:${String(currentWorkspace.id)}` })
      }
      const sceneProjection = presentations.find((item) => item.id === `presentation:custom:workspace:${String(currentWorkspace.id)}`)
      if (sceneProjection !== undefined) {
        for (const id of sceneProjection.state.memberViewIds) if (!seeds.includes(id)) add(id, 'same_scene', 'related', 0.7, `同一工作现场：${currentWorkspace.name}`, { provenance: sceneProjection.id })
      }
    }

    const now = Date.now()
    for (const delta of workState.recentDelta) {
      const ageMs = Math.max(0, now - Date.parse(delta.occurredAt))
      const freshness = Math.exp(-ageMs / (1000 * 60 * 60 * 24 * 3))
      for (const id of delta.viewIds) if (!seeds.includes(id)) add(id, 'recent_delta', 'related', 0.58 + 0.12 * freshness, `最近变化：${delta.summary}`, { freshness })
    }

    if (this.spatial !== undefined && seeds.length > 0) {
      for (const candidate of this.spatial.retrieve(projectId, seeds, MAX_RELATED)) {
        add(candidate.viewId, 'spatial_neighbourhood', 'related', candidate.signal, `空间邻近：${candidate.reason}`, {
          spatial: {
            ...(candidate.edgeDistance === undefined ? {} : { edgeDistance: candidate.edgeDistance }),
            ...(candidate.relativeDirection === undefined ? {} : { relativeDirection: candidate.relativeDirection }),
          },
          provenance: 'presentation:spatial',
        })
      }
    }

    const retrievalAllowed = intent.type !== 'unknown' && intent.goal.trim().length >= 3
    if (retrievalAllowed && this.search !== undefined) {
      const result = await this.search.search(projectId, intent.goal, { limit: MAX_RETRIEVAL, types: ['artifact'], related: false })
      const maxScore = Math.max(1, ...result.hits.map((hit) => hit.score))
      for (const hit of result.hits) {
        const viewId = hit.viewId === undefined ? (viewIdsByArtifact.get(hit.entityId)?.[0]) : String(hit.viewId)
        if (viewId === undefined) continue
        add(viewId, 'semantic_retrieval', 'retrieved', 0.5 + 0.4 * (hit.score / maxScore), `Intent 检索：${hit.snippet}`, { provenance: `search:${hit.source}` })
      }
    }

    const choose = (viewId: string): AttentionEvidenceV0 | undefined => {
      const list = all.get(viewId)
      if (!list?.length) return undefined
      const precedence = new Map<AttentionEvidenceV0['source'], number>([
        ['selected', 100], ['pinned', 95], ['locked', 94], ['explicit_relation', 90], ['workflow_requirement', 86],
        ['same_context', 82], ['same_collection', 80], ['same_scene', 70], ['recent_delta', 65],
        ['semantic_retrieval', 60], ['spatial_neighbourhood', 50], ['agent_requested', 40],
      ])
      const best = [...list].sort((a, b) => (precedence.get(b.source) ?? 0) - (precedence.get(a.source) ?? 0) || b.strength - a.strength)[0]
      if (best === undefined) return undefined
      const reasons = unique(list.sort((a, b) => b.strength - a.strength).map((item) => item.reason)).slice(0, 3)
      return { ...best, reason: reasons.join(' · '), strength: Math.max(...list.map((item) => item.strength)) }
    }
    const resolved = [...all.keys()].map(choose).filter((item): item is AttentionEvidenceV0 => item !== undefined)
    const byBucket = (bucket: AttentionEvidenceV0['bucket']) => resolved.filter((item) => item.bucket === bucket).sort((a, b) => b.strength - a.strength || a.viewId.localeCompare(b.viewId))
    return {
      selected: byBucket('selected'),
      pinned: byBucket('pinned'),
      related: byBucket('related').slice(0, MAX_RELATED),
      retrieved: byBucket('retrieved').slice(0, MAX_RETRIEVAL),
    }
  }

  #continuityCandidates(workState: WorkStateSnapshotV0, intent: IntentCandidateV0, attention: AttentionProjectionV0, dismissed: readonly string[]): readonly ContinuityCandidateV0[] {
    const candidates: ContinuityCandidateV0[] = []
    const dismissedSet = new Set(dismissed)
    const preview = { selected: attention.selected.length, pinned: attention.pinned.length, related: attention.related.length, retrieved: attention.retrieved.length }
    const requiredViewIds = unique([...attention.selected, ...attention.pinned, ...attention.related.slice(0, 3), ...attention.retrieved.slice(0, 2)].map((item) => item.viewId))
    const add = (type: ContinuityCandidateV0['type'], stablePart: string, title: string, confidence: number, subtitle?: string): void => {
      const key = `${type}:${intent.type}:${stablePart}`
      if (dismissedSet.has(key)) return
      candidates.push({
        key,
        validityHash: hashOf({ semantic: workState.semanticFingerprint, key }),
        type,
        projectId: workState.projectId,
        workspaceId: workState.workspaceId,
        title,
        ...(subtitle === undefined ? {} : { subtitle }),
        intent,
        evidenceKeys: intent.evidenceKeys,
        attentionPreview: preview,
        requiredViewIds,
        suggestedSkillIds: intent.suggestedSkillIds,
        confidence: clamp(confidence),
        createdAt: new Date().toISOString(),
      })
    }
    const reviewLoop = workState.openLoops.find((item) => item.status === 'review')
    if (reviewLoop !== undefined) add('review', reviewLoop.key, reviewLoop.title, 0.95, 'Agent 已返回结果，等待确认')
    const activeLoop = workState.openLoops.find((item) => item.status !== 'review')
    if (activeLoop !== undefined) add('resolve', activeLoop.key, activeLoop.title, Math.max(0.76, intent.confidence), '项目仍有明确 Open Loop')
    if (intent.type !== 'unknown' && (workState.selectedViewIds.length > 0 || workState.pinnedViewIds.length > 0 || workState.openLoops.length > 0)) {
      add('resume', workState.selectedViewIds.slice(0, 3).join(',') || 'workstate', intent.goal, Math.max(0.72, intent.confidence), '恢复当前 Intent + Attention')
    }
    if (candidates.length === 0 && (workState.selectedViewIds.length > 0 || workState.recentDelta.length > 0)) {
      add('explore', 'current-state', intent.type === 'unknown' ? '检查当前工作现场' : intent.goal, 0.5, '当前没有更明确的未完成动作')
    }
    const priority = { resume: 4, resolve: 3, review: 3, explore: 1 } as const
    return candidates.sort((a, b) => priority[b.type] - priority[a.type] || b.confidence - a.confidence).slice(0, 3)
  }

  async #composeContextPack(
    projectId: string,
    workState: WorkStateSnapshotV0,
    intent: IntentCandidateV0,
    attention: AttentionProjectionV0,
    tokenBudget: number,
    expandViewIds: readonly string[],
    fullViewIds: readonly string[],
  ): Promise<ContextPackV0> {
    const budget = Math.max(240, Math.min(12_000, Math.trunc(tokenBudget)))
    const expand = new Set(expandViewIds)
    const full = new Set(fullViewIds)
    const mandatory = [...attention.selected, ...attention.pinned]
    const optional = [...attention.related, ...attention.retrieved]
      .sort((a, b) => b.strength - a.strength || a.viewId.localeCompare(b.viewId))
    const ordered = [...mandatory, ...optional.filter((item) => !mandatory.some((forced) => forced.viewId === item.viewId))]
    const items: ContextPackItemV0[] = []
    let used = 0
    let truncated = false
    for (const evidence of ordered) {
      let level: ContextContentLevelV0 = mandatory.some((item) => item.viewId === evidence.viewId) ? 'L1' : (evidence.strength >= 0.82 ? 'L1' : 'L0')
      if (expand.has(evidence.viewId)) level = 'L2'
      if (full.has(evidence.viewId)) level = 'L3'
      const remaining = Math.max(0, budget - used)
      const detail = await this.#content(projectId, evidence.viewId, level, remaining)
      const estimatedTokens = detail.estimatedTokens
      if (items.length >= mandatory.length && used + estimatedTokens > budget) {
        truncated = true
        continue
      }
      items.push({
        viewId: evidence.viewId,
        ...(evidence.artifactId === undefined ? {} : { artifactId: evidence.artifactId }),
        title: evidence.title,
        bucket: evidence.bucket,
        source: evidence.source,
        level: detail.level,
        reason: evidence.reason,
        ...(detail.content === undefined ? {} : { content: detail.content }),
        provenance: evidence.provenance,
        estimatedTokens,
      })
      used += estimatedTokens
    }
    return {
      schemaVersion: 0,
      projectId,
      workspaceId: workState.workspaceId,
      intent,
      items,
      selectedCount: items.filter((item) => item.bucket === 'selected').length,
      pinnedCount: items.filter((item) => item.bucket === 'pinned').length,
      relatedCount: items.filter((item) => item.bucket === 'related').length,
      retrievedCount: items.filter((item) => item.bucket === 'retrieved').length,
      estimatedTokens: used,
      tokenBudget: budget,
      truncated,
      createdAt: new Date().toISOString(),
    }
  }

  async #content(projectId: string, viewId: string, requested: ContextContentLevelV0, remainingTokens: number): Promise<{ level: ContextContentLevelV0; content?: string; estimatedTokens: number }> {
    const graph = this.repository.get(projectId)
    const view = graph?.artifactViews.find((item) => String(item.id) === viewId)
    const artifact = view === undefined ? undefined : graph?.artifacts.find((item) => String(item.id) === String(view.artifactId))
    if (artifact === undefined) return { level: 'L0', estimatedTokens: 18 }
    if (requested === 'L0') return { level: 'L0', estimatedTokens: 18 }
    const revisionId = view?.revisionId ?? artifact.currentRevisionId
    const revision = revisionId === undefined ? undefined : graph?.artifactRevisions.find((item) => String(item.id) === String(revisionId))
    const file = revision === undefined ? undefined : graph?.fileRecords.find((item) => String(item.id) === String(revision.fileRecordId))
    if (file === undefined || (!TEXT_MIME.has(file.mimeType) && !file.mimeType.startsWith('text/'))) {
      const content = `${artifact.kind} · ${artifact.availability}`
      return { level: 'L1', content, estimatedTokens: Math.ceil(content.length / 4) + 12 }
    }
    const capByLevel: Record<ContextContentLevelV0, number> = { L0: 0, L1: 720, L2: 2_800, L3: 20_000 }
    const maxChars = Math.max(120, Math.min(capByLevel[requested], Math.max(120, remainingTokens * 4 - 64)))
    const text = await readPrefix(file.observedPath, maxChars)
    if (!text) return { level: 'L0', estimatedTokens: 18 }
    const estimatedTokens = Math.ceil(text.length / 4) + 16
    return { level: requested, content: text, estimatedTokens }
  }

  #routeSkillTarget(workState: WorkStateSnapshotV0, intent: IntentCandidateV0): SkillTargetProposalV0 {
    const suggestions = skillHints(intent.type)
    const sideEffect = sideEffectFor(intent.type)
    return {
      intentType: intent.type,
      ...(suggestions[0] === undefined ? {} : { primarySkillId: suggestions[0] }),
      supportingSkillIds: suggestions.slice(1),
      target: workState.currentHarness ?? 'neutral',
      sideEffect,
      requiresApproval: !['READ_ONLY', 'PREPARE'].includes(sideEffect),
      reason: suggestions.length
        ? `Intent ${intent.type} → ${suggestions.join(' + ')}；执行副作用等级 ${sideEffect}`
        : `Intent ${intent.type} 暂无强制 Skill；保持 harness-neutral`,
    }
  }
}
