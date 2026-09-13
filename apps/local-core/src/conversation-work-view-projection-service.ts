import type { ConversationWorkViewAggregateV1, ConversationWorkViewRunV1 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ConversationIdentityService } from './conversation-identity-service.js'
import type { ConversationContinuationService } from './conversation-continuation-service.js'

/**
 * T6 canonical producer：Conversation Work View 聚合。
 * 只读组合既有 receiver / identity / reach / runs(receiver_conversation_id) /
 * continuation journal，不建第二消息 truth；contentStatus 诚实派生。
 */
export class ConversationWorkViewProjectionService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly identity: ConversationIdentityService,
    private readonly continuation: ConversationContinuationService | undefined,
  ) {}

  get(projectId: string, connectedConversationId: string): ConversationWorkViewAggregateV1 | undefined {
    const connectedConversation = this.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (connectedConversation === undefined) return undefined
    const chain = this.identity.resolveChain(projectId, connectedConversationId)
    const reach = this.identity.reach(projectId, connectedConversationId)
    const contentStatus = chain?.conversationSession === undefined ? 'identity_only' : 'content_pending'
    const runs = this.metadata.listRunsByReceiverConversation(projectId, connectedConversationId, 20).map((run): ConversationWorkViewRunV1 => ({
      runId: String(run.id),
      status: run.status,
      instruction: run.instruction,
      updatedAt: run.updatedAt,
    }))
    const operations = (this.continuation?.list(projectId) ?? []).filter((op) => op.connectedConversationId === connectedConversationId)
    return {
      schemaVersion: 1,
      projectId,
      connectedConversationId,
      connectedConversation,
      ...(chain === undefined ? {} : { identity: chain }),
      ...(reach === undefined ? {} : { reach }),
      contentStatus,
      runs,
      operations,
      updatedAt: connectedConversation.updatedAt,
    }
  }
}
