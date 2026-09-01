/**
 * F6 Unified Execution Composer contracts（后端同步施工单 P0-D，20260828）。
 *
 * 四件事：
 * 1. Run 的 canonical Receiver（ReceiverRef——Run 派发目标由 Core 解析，前端不猜 session）；
 * 2. heterogeneous ordered references（artifact/view/scope/workspace/conversation/component）；
 * 3. ResultSlotV0（Blank Result 的 authoritative truth：空槽 → running → review → materialized）；
 * 4. RunRecipeV0（Recipe 聚合只读投影：prompt + receiver + refs + manifest 一次性可读）。
 *
 * 红线：Job/Deployment 不取代 Run 用户层身份；receiver 解析属 Core；未 link 的
 * Glyth fail-close（不伪造 session）。
 */

import type { AssemblyTargetRefV1 } from './assembly.js'

// ==================== P0-D1：ReceiverRef ====================

/** Run 的 canonical receiver：指向一条 ConnectedConversation（Core 解析身份桥）。 */
export interface RunReceiverRefV1 {
  readonly connectedConversationId: string
}

// ==================== P0-D2：heterogeneous ordered references ====================

/** Run 引用的异构实体（V2：不再只有 artifactId/revisionId）。 */
export type RunReferenceRefV2 =
  | { readonly type: 'artifact'; readonly artifactId: string; readonly revisionId?: string }
  | { readonly type: 'view'; readonly viewId: string }
  | { readonly type: 'scope'; readonly scopeId: string }
  | { readonly type: 'workspace'; readonly workspaceId: string }
  | { readonly type: 'conversation'; readonly conversationSessionId: string }
  | { readonly type: 'component'; readonly componentId: string; readonly presentationId?: string }
  // 裁决（20260828）：Note/Resource 不进 OrderedRunReference——F6B 冻结范围即不含；
  // v0.15 fail-honest（不伪装可引用），0.2 再补 canonical explicit reference（显式 parking）。

export interface OrderedRunReferenceV2 {
  readonly ref: RunReferenceRefV2
  readonly order: number
  /** 读取模式：full 全文 / summary 摘要 / structure 结构（默认 full，Core 冻结 manifest 时展开）。 */
  readonly mode?: 'full' | 'summary' | 'structure'
}

// ==================== P0-D3：Conversation Reachability（read projection） ====================

export type ConversationReachTierV0 = 'bound' | 'produced' | 'referenced' | 'participating' | 'retrieved'

export interface ConversationReachItemV0 {
  readonly entityRef: { readonly type: 'artifact' | 'note' | 'conversation' | 'resource' | 'scope' | 'workspace'; readonly id: string; readonly viewId?: string }
  readonly tier: ConversationReachTierV0
  readonly reason: string
  readonly createdAt?: string
  readonly sourceRef?: string
}

export interface ConversationReachResultV0 {
  readonly schemaVersion: 0
  readonly projectId: string
  readonly connectedConversationId: string
  readonly items: readonly ConversationReachItemV0[]
}

// ==================== P0-D5：ResultSlotV0 ====================

export type ResultSlotStatusV0 = 'empty' | 'running' | 'review' | 'materialized'

/**
 * Blank Result 的 authoritative truth：画布上的空结果槽。
 * Run 创建可带 resultSlotId；acceptArtifactReturn 时 materialize accepted 输出到槽位
 * （保留空间位置，绑定为 canonical ArtifactView；不复制 output 节点再删槽）。
 * ResultSlot 自身不是 Artifact provenance。
 */
export interface ResultSlotV0 {
  readonly schemaVersion: 0
  readonly id: string
  readonly projectId: string
  readonly scopeId: string
  readonly workspaceId?: string
  readonly position: { readonly x: number; readonly y: number }
  readonly size?: { readonly width: number; readonly height: number }
  readonly status: ResultSlotStatusV0
  /** materialized 后绑定的 canonical view/artifact（restart 稳定）。 */
  readonly artifactViewId?: string
  readonly artifactId?: string
  /** 当前占用槽位的 run（running/review 期）。 */
  readonly runId?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateResultSlotInputV0 {
  readonly projectId: string
  readonly scopeId: string
  readonly workspaceId?: string
  readonly x: number
  readonly y: number
  readonly width?: number
  readonly height?: number
}

// ==================== P0-D6：RunRecipeV0（聚合只读投影） ====================

export interface RunRecipeV0 {
  readonly schemaVersion: 0
  readonly runId: string
  readonly projectId: string
  readonly prompt: string
  readonly receiver?: { readonly connectedConversationId: string; readonly provider?: string }
  readonly intent: string
  readonly target?: AssemblyTargetRefV1
  readonly orderedReferences: readonly { readonly ref: RunReferenceRefV2; readonly order: number; readonly mode?: string }[]
  readonly resultPolicy?: { readonly type: string }
  readonly resultSlotId?: string
  readonly contextManifestId?: string
  readonly provider?: string
  readonly createdAt: string
}
