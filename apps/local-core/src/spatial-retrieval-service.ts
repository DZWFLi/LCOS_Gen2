import type { SqliteMetadataRepository } from './metadata-repository.js'

export type SpatialRetrievalReasonV1 =
  | 'same-parent'
  | 'parent-child'
  | 'presentation-edge'
  | 'geometric-near'
  | 'same-top-level'

export interface SpatialRetrievalCandidateV1 {
  readonly viewId: string
  readonly artifactId: string
  readonly title: string
  readonly source: 'spatial'
  readonly reason: SpatialRetrievalReasonV1
  /** spatial/presentation hint（0–1），不是 semantic confidence。 */
  readonly signal: number
  readonly edgeDistance?: number
  readonly relativeDirection?: 'above' | 'below' | 'left' | 'right' | 'overlap'
}

const DEFAULT_LIMIT = 6
const GEOMETRIC_TOP = 6
const HIERARCHY_TOP = 4
const EDGE_TOP = 3
const GEOMETRIC_SCALE_PX = 600
const GEOMETRIC_WEIGHT = 0.35


type Rect = { x: number; y: number; width: number; height: number }

function edgeDistance(left: Rect, right: Rect): number {
  const dx = Math.max(left.x - (right.x + right.width), right.x - (left.x + left.width), 0)
  const dy = Math.max(left.y - (right.y + right.height), right.y - (left.y + left.height), 0)
  return Math.hypot(dx, dy)
}

function directionFrom(reference: Rect, candidate: Rect): 'above' | 'below' | 'left' | 'right' | 'overlap' {
  if (edgeDistance(reference, candidate) === 0) return 'overlap'
  const rx = reference.x + reference.width / 2
  const ry = reference.y + reference.height / 2
  const cx = candidate.x + candidate.width / 2
  const cy = candidate.y + candidate.height / 2
  const dx = cx - rx
  const dy = cy - ry
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'above' : 'below')
}

function hull(rects: readonly Rect[]): Rect | undefined {
  if (rects.length === 0) return undefined
  const minX = Math.min(...rects.map((rect) => rect.x))
  const minY = Math.min(...rects.map((rect) => rect.y))
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width))
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * HU-4：把用户“摆出来的关系”变成确定性 Recall hint。
 * 只读 Presentation（hierarchy / presentationEdges / positions / membership），
 * 绝不写 Domain relation；不依赖 Ollama / vector。
 */
export class SpatialRetrievalService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  retrieve(projectId: string, seedViewIds: readonly string[], limit = DEFAULT_LIMIT): readonly SpatialRetrievalCandidateV1[] {
    const graph = this.repository.get(projectId)
    if (graph === undefined) return []
    const rootScope = graph.scopes.find((scope) => scope.kind === 'root') ?? graph.scopes[0]
    if (rootScope === undefined) return []
    const presentation = this.repository.getPresentationView(projectId, `presentation:context:${String(rootScope.id)}`)
    const state = presentation?.state
    const hierarchy = state?.hierarchy ?? { parentByViewId: {}, orderByParent: {} }
    const members = new Set(state?.memberViewIds ?? [])
    const edges = state?.presentationEdges ?? []
    const positions = state?.positions ?? {}
    const views = new Map(graph.artifactViews.map((view) => [String(view.id), view]))
    const artifacts = new Map(graph.artifacts.map((artifact) => [String(artifact.id), artifact]))
    const seedSet = new Set(seedViewIds.filter((id) => views.has(id)))
    if (seedSet.size === 0) return []

    const posOf = (viewId: string): { x: number; y: number } | undefined => {
      const manual = positions[viewId]
      if (manual !== undefined) return manual
      const view = views.get(viewId)
      return view === undefined ? undefined : view.position
    }
    const scored = new Map<string, { reason: SpatialRetrievalReasonV1; signal: number; edgeDistance?: number; relativeDirection?: SpatialRetrievalCandidateV1['relativeDirection'] }>()
    const add = (viewId: string, reason: SpatialRetrievalReasonV1, signal: number, detail?: { edgeDistance?: number; relativeDirection?: SpatialRetrievalCandidateV1['relativeDirection'] }): void => {
      if (!views.has(viewId) || seedSet.has(viewId)) return
      const current = scored.get(viewId)
      if (current === undefined || signal > current.signal) scored.set(viewId, { reason, signal, ...detail })
    }

    // Hierarchy（§8）：same-parent 0.70 / parent-child 0.80 / same-top-level 0.30
    for (const seed of seedSet) {
      const parent = hierarchy.parentByViewId[seed] ?? null
      const siblings = parent === null ? [] : (hierarchy.orderByParent[parent] ?? []).filter((id) => id !== seed && members.has(id))
      siblings.slice(0, HIERARCHY_TOP).forEach((id) => add(id, 'same-parent', 0.7))
      const parentNode = parent !== null && members.has(parent) ? [parent] : []
      const children = (hierarchy.orderByParent[seed] ?? []).filter((id) => members.has(id))
      ;[...parentNode, ...children].slice(0, HIERARCHY_TOP).forEach((id) => add(id, 'parent-child', 0.8))
      if (parent === null || hierarchy.orderByParent[parent] === undefined) {
        const topLevel = (hierarchy.orderByParent[''] ?? []).filter((id) => id !== seed && members.has(id))
        topLevel.slice(0, HIERARCHY_TOP).forEach((id) => add(id, 'same-top-level', 0.3))
      }
    }

    // Presentation edges（§9）：1-hop 0.75；只当 recall hint，不写 Domain relation。
    for (const seed of seedSet) {
      const oneHop = edges
        .filter((edge) => edge.fromViewId === seed || edge.toViewId === seed)
        .map((edge) => (edge.fromViewId === seed ? edge.toViewId : edge.fromViewId))
        .filter((id) => views.has(id))
      oneHop.slice(0, EDGE_TOP).forEach((id) => add(id, 'presentation-edge', 0.75))
    }

    // Geometric locality：用多选 hull + 节点真实 bounds 的 edge-to-edge distance。
    // 距离只生成 recall evidence，不等价于 Related truth。
    const rectOf = (viewId: string): Rect | undefined => {
      const view = views.get(viewId)
      const point = posOf(viewId)
      if (view === undefined || point === undefined) return undefined
      return { x: point.x, y: point.y, width: Math.max(1, view.size.width), height: Math.max(1, view.size.height) }
    }
    const seedHull = hull([...seedSet].map((id) => rectOf(id)).filter((rect): rect is Rect => rect !== undefined))
    if (seedHull !== undefined) {
      const nearest = graph.artifactViews
        .filter((view) => !seedSet.has(String(view.id)))
        .flatMap((view) => {
          const rect = rectOf(String(view.id))
          if (rect === undefined) return []
          return [{
            id: String(view.id),
            distance: edgeDistance(seedHull, rect),
            direction: directionFrom(seedHull, rect),
          }]
        })
        .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
        .slice(0, GEOMETRIC_TOP)
      for (const item of nearest) {
        add(
          item.id,
          'geometric-near',
          GEOMETRIC_WEIGHT * (1 / (1 + item.distance / GEOMETRIC_SCALE_PX)),
          { edgeDistance: item.distance, relativeDirection: item.direction },
        )
      }
    }

    return [...scored.entries()]
      .sort((left, right) => right[1].signal - left[1].signal)
      .slice(0, Math.max(1, Math.min(16, Math.floor(limit))))
      .map(([viewId, { reason, signal, edgeDistance: distance, relativeDirection }]) => {
        const view = views.get(viewId)
        const artifact = view === undefined ? undefined : artifacts.get(String(view.artifactId))
        return {
          viewId,
          artifactId: artifact?.id ?? '',
          title: artifact?.title ?? viewId,
          source: 'spatial' as const,
          reason,
          signal,
          ...(distance === undefined ? {} : { edgeDistance: distance }),
          ...(relativeDirection === undefined ? {} : { relativeDirection }),
        }
      })
  }
}
