/**
 * CompanionProjectionV1 — Floating Companion 的统一读模型（P0，验收裁决 §7）。
 *
 * 命题：Companion / Floating Panel 不再拼 project/receiver/context/capture/returns/
 * execution/runtime 七套状态，只消费 Core 的一个 CompanionProjectionV1 投影。
 * 本契约是纯读模型，零新状态存储；每个字段都由既有 service 的读面聚合而来。
 *
 * 红线：desktop 只允许 import @local-creative-os/contracts 的类型，禁止 import
 * local-core 的业务 service（该红线由 S4 gate 做源码级校验）。
 */

import type { ArtifactReturnAction } from './index.js'
import type { ExecutionItemAction, ExecutionItemV1 } from './execution-item.js'
import type { CaptureStagingItemV0 } from './capture.js'
import type { ConnectedConversationV1, ProjectHandoffPackV1, ProjectReceiverBindingV1 } from './receiver.js'
import type { RuntimeProviderStatus } from './index.js'
import type { ActiveContextV2 } from './index.js'

/** 语义：pending_review 的 Artifact Return 投影精简视图（不泄露 domain 行的 raw 字段）。 */
export interface CompanionPendingReturnV1 {
  readonly schemaVersion: 1
  readonly returnId: string
  readonly runId: string
  readonly targetArtifactId: string
  readonly canonicalPath: string
  readonly action: ArtifactReturnAction
  readonly runLabel: string
  readonly createdAt: string
}

export interface CompanionReceiverV1 {
  readonly schemaVersion: 1
  readonly binding: ProjectReceiverBindingV1 | null
  readonly conversations: readonly ConnectedConversationV1[]
  readonly pendingHandoff: ProjectHandoffPackV1 | null
}

export interface CompanionRuntimeStatusV1 {
  readonly providers: readonly RuntimeProviderStatus[]
  /** 任一 provider 非 offline => bridge 在线（派生，不新状态）。 */
  readonly bridgeOnline: boolean
}

export interface CompanionProjectionV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly project: {
    readonly id: string
    readonly name: string
    readonly rootPath: string
    readonly activeConversationId: string | null
  } | null
  readonly receiver: CompanionReceiverV1
  readonly activeContext: ActiveContextV2 | null
  readonly recentCapture: readonly CaptureStagingItemV0[]
  readonly pendingReturns: readonly CompanionPendingReturnV1[]
  readonly executionItems: readonly ExecutionItemV1[]
  /** 全局动作面板的派生动作集（各 executionItems 的 availableActions 并集，按规范顺序去重）。 */
  readonly availableActions: readonly ExecutionItemAction[]
  readonly runtimeStatus: CompanionRuntimeStatusV1
  readonly generatedAt: string
}

/** 全局 availableActions 的规范顺序（与 execution-item 支持矩阵一致）。 */
export const COMPANION_ACTION_ORDER: readonly ExecutionItemAction[] = ['pause', 'resume', 'cancel', 'retry', 'answer_input']

/** 纯函数：从一组 executionItems 派生全局 availableActions（并集 + 规范序去重）。 */
export function deriveCompanionAvailableActions(items: readonly ExecutionItemV1[]): readonly ExecutionItemAction[] {
  const present = new Set<ExecutionItemAction>()
  for (const item of items) {
    for (const action of item.availableActions) present.add(action)
  }
  return COMPANION_ACTION_ORDER.filter((action) => present.has(action))
}
