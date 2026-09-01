/**
 * Spatial Navigation Marker V0（F6A2 后端小刀，20260829）。
 *
 * 前端已冻结 Spatial Marker System（Pin / Edge Cursor / Cluster = 同一 Marker
 * 的 viewport 投影）。Core 只持久化「导航意图」，不持久化任何投影态：
 * - 禁止存 world-pin / edge-cursor / cluster 状态、screen x/y、cluster
 *   membership、camera zoom——全部由前端按 camera/viewport 动态 derive；
 * - targetRef 永远指向 canonical target（view / entity / surface），不复制
 *   目标坐标；目标移动后 resolve 实时返回当前位置；
 * - target 删除 → unresolved；跨 Project → fail-close；禁止 title/provider/
 *   time 模糊重绑（同 Glyth identity 原则）。
 *
 * 纯类型零依赖；持久化属 metadata-repository（schema 48），解析属
 * navigation-marker-service。
 */

/** Marker 指向的 canonical target（与前端 SpatialMarkerTargetRefV0 同构）。 */
export interface SpatialMarkerTargetRefV0 {
  readonly projectId: string
  readonly kind: 'view' | 'entity' | 'surface'
  readonly id: string
}

/** Marker 作用域：本层级（默认，仅所属现场可见）或跨 Surface 穿透（「跨空间标记」）。 */
export type SpatialMarkerScopeV0 = 'local' | 'cross-surface'

/** v0.15 可导航 Surface 的稳定种类全集。 */
export type NavigationSurfaceKindV0 =
  | 'main'
  | 'context'
  | 'workflow'
  | 'scene'
  | 'conversation'
  | 'collection'
  | 'assembly'

/**
 * 稳定 Surface 引用词汇（不是 GUI route string，是可持久 identity）：
 * - 'main'：主画布（root scope）
 * - 'scope:<scopeId>'：Context / Workflow / Collection
 * - 'workspace:<workspaceId>'：Scene
 * - 'conversation:<conversationId>'：Conversation Subcanvas
 * - 'assembly'：Assembly Workspace（capture 侧唯一）
 */
export type StableSurfaceRefV0 =
  | 'main'
  | 'assembly'
  | `scope:${string}`
  | `workspace:${string}`
  | `conversation:${string}`

/** 持久化的 Marker 意图（只存 intent；id 由 Core 分配）。 */
export interface SpatialMarkerIntentV0 {
  readonly id: string
  readonly projectId: string
  readonly targetRef: SpatialMarkerTargetRefV0
  readonly scope: SpatialMarkerScopeV0
  /** 仅 local marker 需要（明确所属现场）；cross-surface marker 不依赖它。 */
  readonly sourceSurfaceRef?: StableSurfaceRefV0
  readonly createdAt: string
  readonly updatedAt: string
}

/** resolve 成功的导航目标。surfaceRef/anchorRef 稳定；worldPosition 每次实时读取（不复制）。 */
export interface ResolvedNavigationTargetV0 {
  readonly projectId: string
  readonly surfaceRef: StableSurfaceRefV0
  readonly surfaceKind: NavigationSurfaceKindV0
  readonly projectionRef?: string
  readonly anchorRef?: string
  readonly worldPosition?: Readonly<{ readonly x: number; readonly y: number }>
  readonly path?: readonly string[]
}

/** resolve 的诚实失败分类（不模糊重绑、不猜目标）。 */
export type NavigationResolutionReasonV0 =
  | 'cross-project'
  | 'target-missing'
  | 'unknown-target-kind'
  | 'unknown-surface'

export type NavigationResolutionV0 =
  | { readonly status: 'resolved'; readonly target: ResolvedNavigationTargetV0 }
  | { readonly status: 'unresolved'; readonly reason: NavigationResolutionReasonV0 }
