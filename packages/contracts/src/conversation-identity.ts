/**
 * Conversation Identity Bridge V1（20260827 P0，前端 0.15 GUI Truth 配合项）。
 *
 * 背景：LCOS 存在两套会话身份——
 *   conversation-*（导入/存档会话 → ConversationSession → conversationArtifact/View）
 *   connected-conversation-*（Runtime Receiver → ActiveReceiver）
 * 两者不是同一个 ID。本契约把链路钉成一条 canonical 解析链：
 *
 *   ConnectedConversation（conversationSessionId 显式链接）
 *     ↕ ConversationSession
 *     ↕ conversationArtifactId
 *     ↕ conversationViewId
 *     ↕ Conversation Glyth（前端渲染物）
 *
 * 解析纪律（前端 brief 原话）：不靠 provider 相同 / title 相同 / 最近时间 / 前端映射表猜。
 * 链接只由显式写入（POST link-session）建立；缺链接时字段诚实缺席（undefined），
 * 决不回退到启发式匹配。
 *
 * Birth Provenance 同时落地：Artifact → birthRunId → RuntimeBinding(externalSessionId)
 *   → ConnectedConversation(conversationRef 唯一命中) → ConversationSession → view。
 * Run→Conversation 这一跳是自然连接键：runtime_bindings.external_session_id 与
 * connected_conversations.conversation_ref 同为「外部执行器会话的稳定引用」（桥 bind 时回绑）。
 */

import type { ConnectedConversationV1 } from './receiver.js'
import type { ConversationSessionV1 } from './conversations.js'
import type { SessionLifecycleStateV1 } from './session-lifecycle.js'

/** 一条 ConnectedConversation 的 canonical 身份链（每跳可缺席，缺席 = 诚实 unknown）。 */
export interface ConversationIdentityChainV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly connectedConversation: ConnectedConversationV1
  /** 链接建立的导入会话；未链接 = undefined（不猜）。 */
  readonly conversationSession?: ConversationSessionV1
  /** 会话入口节点（ConversationSession.conversationArtifactId 透传）。 */
  readonly conversationArtifactId?: string
  /** 会话入口 view（ConversationSession.conversationViewId 透传）。 */
  readonly conversationViewId?: string
  /** 该 provider 的会话生命周期（project×provider 粒度，七态；无行 = 尚无会话记录）。 */
  readonly lifecycle?: SessionLifecycleStateV1
}

/** Active Receiver 的完整身份解析：activeReceiverId → 链 → 画布上那只 Glyth 的控制句柄。 */
export interface ActiveReceiverIdentityV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  /** 无 active receiver = null（不伪造）。 */
  readonly activeReceiverId: string | null
  readonly chain?: ConversationIdentityChainV1
}

/**
 * Artifact 出生谱系：谁生的（只回答 origin，不回答现在谁在用/属于谁——usage 归 0.2 usage-binding）。
 * origin: 'run-return' = 经 ArtifactReturn accept 诞生的 Run 产出（birthRunId 有值）；
 *         'unknown'     = GUI 直建/curation 写入等无 Run 路径（birthRunId undefined，诚实缺席）。
 */
export interface ArtifactBirthProvenanceV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly artifactId: string
  readonly origin: 'run-return' | 'unknown'
  readonly birthRunId?: string
  /** 出生 Run 摘要（status/provider/instruction 首行）。 */
  readonly run?: { readonly id: string; readonly status: string; readonly provider: string; readonly instruction: string }
  /** Run 的桥绑定（externalTaskId/externalSessionId）；未派发 = undefined。 */
  readonly runtimeBinding?: { readonly externalTaskId?: string; readonly externalSessionId?: string }
  /** externalSessionId ↔ conversationRef 唯一命中的承接会话；无 = undefined。 */
  readonly connectedConversation?: ConnectedConversationV1
  /** 该承接会话链接的导入会话（含 conversationArtifactId/ViewId）。 */
  readonly conversationSession?: ConversationSessionV1
  readonly conversationArtifactId?: string
  readonly conversationViewId?: string
}
