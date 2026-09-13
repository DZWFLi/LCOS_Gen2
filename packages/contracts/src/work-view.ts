/**
 * Sprint 2B 补（T6）：Conversation Work View 聚合契约。
 *
 * 唯一 region identity：`lcos:conversation:<connectedConversationId>`（T4 §2.3）。
 * contentStatus 诚实派生：identity_only=未链接导入会话；content_pending=已链接但
 * 内容未投影/未就绪；content_ready=投影 receipt 已确认（T1 后接）。聚合永远可返回
 * partial（identity-only 也可打开），不做第二消息 truth。
 */

import type { ConnectedConversationV1 } from './receiver.js'
import type { ConversationIdentityChainV1 } from './conversation-identity.js'
import type { ConversationReachResultV0 } from './run-assembly.js'
import type { ContinuationRecoveryProjectionV1 } from './conversation-continuation.js'

/** Work View 中该会话关联的 Run 摘要（关联键 = runs.receiver_conversation_id）。 */
export interface ConversationWorkViewRunV1 {
  readonly runId: string
  readonly status: string
  readonly instruction: string
  readonly updatedAt: string
}

export interface ConversationWorkViewAggregateV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly connectedConversationId: string
  readonly connectedConversation: ConnectedConversationV1
  /** 链接的导入会话身份链（未链接 = undefined，不猜）。 */
  readonly identity?: ConversationIdentityChainV1
  /** 会话可达性（P0-D3）。 */
  readonly reach?: ConversationReachResultV0
  readonly contentStatus: 'identity_only' | 'content_pending' | 'content_ready'
  /** 该承接会话关联的 Run（按 receiver_conversation_id；attention/waiting 据此定位）。 */
  readonly runs: readonly ConversationWorkViewRunV1[]
  /** 该承接会话的续工操作投影（Recovery section 数据源）。 */
  readonly operations: readonly ContinuationRecoveryProjectionV1[]
  readonly updatedAt: string
}
