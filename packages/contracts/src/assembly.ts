/**
 * F6 Assembly read model contracts（后端同步施工单 P0-B，20260828）。
 *
 * 红线（施工单 §3/§9）：ref 只引用 canonical identity，不复制正文 / membership /
 * relation truth；Material View 与 Relation View 必须读同一份 Project Truth——
 * 这里全部是 read projection，没有第二套 assembly_entities 数据表。
 */

/**
 * Assembly Source Bay 的统一来源引用（P0-B1）。
 * kind 覆盖 Source Bay 四来源（Project/Capture/Sources/Skills）的 canonical 实体：
 * - artifactView / resource / conversation：既有 canonical 实体
 * - capture：Capture staging item（system-level，不属于任何 project）
 * - skill：Skill catalog 条目（system/user/merged 三态 + version）
 * - context / workflow / scene / collection：scope 类 target 兼容引用（只读投影）
 */
export type AssemblySourceRefV1 =
  | { readonly kind: 'artifactView'; readonly id: string }
  | { readonly kind: 'capture'; readonly id: string }
  | { readonly kind: 'resource'; readonly id: string }
  | { readonly kind: 'conversation'; readonly id: string }
  | { readonly kind: 'context'; readonly id: string }
  | { readonly kind: 'workflow'; readonly id: string }
  | { readonly kind: 'scene'; readonly id: string }
  | { readonly kind: 'collection'; readonly id: string }
  | { readonly kind: 'skill'; readonly id: string; readonly source: 'system' | 'user' | 'merged'; readonly version?: string }
  | { readonly kind: 'note'; readonly id: string }

/**
 * Assembly Target Scene 的统一目标引用（P0-B3 + 20260828 补充冻结）：
 * 入口来自 Project root / Conversation / Context / Workflow / Scene。
 * - main：Project Main Presentation（root scope 的 context 投影）——不是 active Workspace 的别名；
 * - scene 与 workspace 同走 working-set membership 通道（scene.id 即 workspaceId）。
 */
export type AssemblyTargetRefV1 =
  | { readonly kind: 'project'; readonly id: string }
  | { readonly kind: 'main' }
  | { readonly kind: 'workspace'; readonly id: string }
  | { readonly kind: 'conversation'; readonly id: string }
  | { readonly kind: 'context'; readonly id: string }
  | { readonly kind: 'workflow'; readonly id: string }
  | { readonly kind: 'scene'; readonly id: string }

/** Warehouse 条目实体类型（read model 行的分类，非新 truth）。 */
export type WarehouseEntityKindV1 = 'artifact' | 'note' | 'conversation' | 'resource' | 'context' | 'workflow' | 'scene' | 'collection'

/** Warehouse read model 单行（P0-B2）：Material View 分页/搜索/筛选的最小稳定形状。 */
export interface WarehouseItemV1 {
  readonly schemaVersion: 1
  readonly entityRef: { readonly type: WarehouseEntityKindV1; readonly id: string; readonly viewId?: string }
  readonly kind: WarehouseEntityKindV1
  readonly title: string
  readonly updatedAt?: string
  /** 预览引用（走既有 preview 通道；无则省略）。 */
  readonly previewRef?: string
  /** provenance 摘要（出生来源一行话；GUI 直建 = 省略）。 */
  readonly provenance?: { readonly origin: 'run-return' | 'import' | 'capture' | 'unknown'; readonly birthRunId?: string }
  /** usage/位置计数（workspace memberships 投影）。 */
  readonly usageCount: number
  /** 是否被请求指定的 target 使用（read projection）。 */
  readonly usedHere?: boolean
  /** relation 邻居提示（Relation View 按需；Material View 可省略）。 */
  readonly relationHint?: { readonly neighborCount: number; readonly topKinds: readonly string[] }
  /** F6 B6（P0-C）：与 web detectFileIdentity 同一 taxonomy 的稳定视觉家族（Core 从 artifact.kind/mimeType/descriptor 派生）。 */
  readonly visualFamily?: 'video' | 'audio' | 'pdf' | 'ppt' | 'image' | 'markdown' | 'link' | 'archive' | 'file'
  readonly mimeType?: string
  readonly fileName?: string
  readonly aspectRatio?: number
}

/** Warehouse 查询参数（P0-B2）：recent/type/source/search/usedHere 四轴 + 分页。 */
export interface WarehouseQueryV1 {
  readonly search?: string
  readonly kinds?: readonly WarehouseEntityKindV1[]
  readonly provenanceOrigin?: 'run-return' | 'import' | 'capture' | 'unknown'
  readonly usedHereTarget?: { readonly kind: 'workspace' | 'scope' | 'conversation'; readonly id: string }
  readonly limit?: number
  readonly cursor?: string
}

export interface WarehouseSnapshotV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly items: readonly WarehouseItemV1[]
  readonly nextCursor?: string
  readonly totalApprox: number
}

/**
 * Semantic Drop 的统一 apply 通道（P0-B4）：sourceRef(s) + targetRef → Core 解析成
 * 既有 canonical mutation（Context/Presentation membership、relation、capture
 * materialize 等）。本 contract 只描述请求/结果形状；实际写仍走各 canonical 服务，
 * 绝不产生第二套 membership。
 */
export interface AssemblyApplyRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly sourceRefs: readonly AssemblySourceRefV1[]
  readonly targetRef: AssemblyTargetRefV1
  /**
   * Drop 落点（20260828 补充冻结 §6：placement 可选、与 semantic membership 分层）：
   * - 新成员：位置并入同一 ChangeSet（undo 连 membership+投影一起撤，§7）；
   * - already-member：纯位置更新，不产生 semantic ChangeSet（§7 纯 placement 不进 semantic history）。
   * key = sourceRef.id。
   */
  readonly placementBySource?: Readonly<Record<string, { readonly x: number; readonly y: number }>>
}

export interface AssemblyApplyItemResultV1 {
  readonly sourceRef: AssemblySourceRefV1
  readonly status: 'applied' | 'skipped' | 'failed'
  /** 实际写入的 canonical 通道（前端可见的"写了哪条 truth"）。 */
  readonly channel: 'workspace-membership' | 'presentation-membership' | 'relation' | 'capture-materialize' | 'already-member' | 'unsupported' | 'error'
  readonly message?: string
  /** membership 落在哪份 Presentation（presentation 通道时返回；projection identity）。 */
  readonly presentationId?: string
  /** 成为成员的 view（projection/member identity）。 */
  readonly memberViewId?: string
  /** 本条 mutation 的 ChangeSet（可撤销语义历史入口）。 */
  readonly changeSetId?: string
  /** placement 是否已持久化（分层：already-member 纯位置更新也为 true）。 */
  readonly placementApplied?: boolean
}

export interface AssemblyApplyResultV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly results: readonly AssemblyApplyItemResultV1[]
  /** fail-close：任一 failed 且无 applied 时整体视为失败；partial 时前端如实展示。 */
  readonly allApplied: boolean
  readonly changeSetId?: string
}
