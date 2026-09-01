import { randomUUID } from 'node:crypto'

import type { ConnectedConversationV1, ProjectEventOrigin, ProjectHandoffPackV1, ProjectReceiverBindingV1 } from '@local-creative-os/contracts'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'

export interface ConnectConversationInput {
  readonly projectId: string
  readonly conversationRef: string
  readonly executorId: string
  readonly provider: 'codex' | 'workbuddy'
  readonly label?: string
}

export interface CreateConversationInput {
  readonly projectId: string
  readonly provider: 'codex' | 'workbuddy'
  readonly executorId: string
  readonly label?: string
}

/** RECEIVER-3 Handoff 准备入参：切换现场的真实状态（surface=当前视图，selection=当前选中）。 */
export interface PrepareHandoffInput {
  readonly projectId: string
  /** 前手会话（切换前的 active receiver；null=首次承接无前手）。 */
  readonly fromConversationId: string | null
  /** 新承接会话（切换目标）。 */
  readonly toConversationId: string
  readonly surface: { readonly kind: 'main' | 'context' | 'workflow'; readonly surfaceId: string }
  readonly selectionEntityIds: readonly string[]
}

/**
 * RECEIVER-0 会话承接运行时（43J 接口落地）。
 * 只管用户视角的承接关系（哪个对话连接到哪个项目可继续做）；
 * watchdog/lease/failureCount 属于 ProviderSessionBinding（lease 运行时层），两者并存互不取代。
 * RECEIVER-3：Handoff 快照只做「准备 + 消费」，切换动作本身零副作用（不触发任何 send/run）。
 */
export class ReceiverRuntimeService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly events: ProjectEventHub,
  ) {}

  listProjectConversations(projectId: string): readonly ConnectedConversationV1[] {
    return this.metadata.listConnectedConversations(projectId)
  }

  /** connect 语义：把已存在的外部会话登记为可继续的承接对话（同 ref 幂等刷新）。 */
  connectConversation(input: ConnectConversationInput, origin?: ProjectEventOrigin): ConnectedConversationV1 {
    const project = this.metadata.getProject(input.projectId)
    if (project === undefined) throw new Error('Project not found.')
    const now = new Date().toISOString()
    const conversation = this.metadata.upsertConnectedConversation({
      schemaVersion: 1,
      id: `connected-conversation-${randomUUID()}`,
      projectId: input.projectId,
      provider: input.provider,
      executorId: input.executorId,
      conversationRef: input.conversationRef,
      label: input.label?.trim() === undefined || input.label.trim() === '' ? input.conversationRef : input.label.trim(),
      isRunning: false,
      waitingReason: null,
      lastActiveAt: now,
      workspaceRef: null,
      branchRef: null,
      createdAt: now,
      updatedAt: now,
    })
    this.events.publish(input.projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [conversation.id],
      payload: { kind: 'receiver.connected', connectedConversationId: conversation.id, provider: conversation.provider, conversationRef: conversation.conversationRef },
    })
    return conversation
  }

  /** create 语义：新开一个尚未绑定外部会话的承接对话（conversationRef 由 Core 生成占位）。 */
  createConversation(input: CreateConversationInput, origin?: ProjectEventOrigin): ConnectedConversationV1 {
    const project = this.metadata.getProject(input.projectId)
    if (project === undefined) throw new Error('Project not found.')
    const now = new Date().toISOString()
    const conversationRef = `pending-${randomUUID()}`
    const conversation = this.metadata.upsertConnectedConversation({
      schemaVersion: 1,
      id: `connected-conversation-${randomUUID()}`,
      projectId: input.projectId,
      provider: input.provider,
      executorId: input.executorId,
      conversationRef,
      label: input.label?.trim() === undefined || input.label.trim() === '' ? '新承接对话' : input.label.trim(),
      isRunning: false,
      waitingReason: null,
      lastActiveAt: now,
      workspaceRef: null,
      branchRef: null,
      createdAt: now,
      updatedAt: now,
    })
    this.events.publish(input.projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [conversation.id],
      payload: { kind: 'receiver.created', connectedConversationId: conversation.id, provider: conversation.provider, conversationRef },
    })
    return conversation
  }

  /** activeReceiverId 必须指向已存在的 connected conversation（承接层内部一致性）。 */
  setActiveReceiver(projectId: string, connectedConversationId: string, origin?: ProjectEventOrigin): ProjectReceiverBindingV1 {
    const project = this.metadata.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const conversation = this.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (conversation === undefined) throw new Error('Connected conversation not found in project.')
    const current = this.metadata.getProjectReceiverBinding(projectId)
    this.metadata.saveProjectReceiverBinding({
      projectId,
      activeReceiverId: conversation.id,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    })
    this.events.publish(projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [conversation.id],
      payload: { kind: 'receiver.activated', connectedConversationId: conversation.id, provider: conversation.provider },
    })
    return this.metadata.getProjectReceiverBinding(projectId)
  }

  /** 断开承接：若该对话是 active receiver，则同时清空 activeReceiverId 并推进 revision。 */
  disconnectConversation(projectId: string, connectedConversationId: string, origin?: ProjectEventOrigin): { readonly deleted: boolean } {
    const project = this.metadata.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const conversation = this.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (conversation === undefined) return { deleted: false }
    const binding = this.metadata.getProjectReceiverBinding(projectId)
    const deleted = this.metadata.deleteConnectedConversation(projectId, connectedConversationId)
    if (deleted && binding.activeReceiverId === connectedConversationId) {
      this.metadata.saveProjectReceiverBinding({
        projectId,
        activeReceiverId: null,
        revision: binding.revision + 1,
        updatedAt: new Date().toISOString(),
      })
    }
    this.events.publish(projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [connectedConversationId],
      payload: { kind: 'receiver.disconnected', connectedConversationId, provider: conversation.provider },
    })
    return { deleted }
  }

  getProjectReceiverBinding(projectId: string): ProjectReceiverBindingV1 {
    const project = this.metadata.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    return this.metadata.getProjectReceiverBinding(projectId)
  }

  // ==================== RECEIVER-3：Handoff 快照（prepare → 读 pending → consume） ====================

  /** 准备 Handoff：切换确认后冻结现场（surface + selection + from/to）。
   *  只存快照，绝不触发任何 send/run；同一 to 会话重复 prepare 覆盖旧 pending。 */
  prepareHandoff(input: PrepareHandoffInput, origin?: ProjectEventOrigin): ProjectHandoffPackV1 {
    const project = this.metadata.getProject(input.projectId)
    if (project === undefined) throw new Error('Project not found.')
    if (this.metadata.getConnectedConversation(input.projectId, input.toConversationId) === undefined) {
      throw new Error('Connected conversation not found in project.')
    }
    if (input.fromConversationId !== null
      && this.metadata.getConnectedConversation(input.projectId, input.fromConversationId) === undefined) {
      throw new Error('From conversation not found in project.')
    }
    const pack: ProjectHandoffPackV1 = {
      schemaVersion: 1,
      projectId: input.projectId,
      fromConversationId: input.fromConversationId,
      toConversationId: input.toConversationId,
      surface: input.surface,
      selectionEntityIds: [...input.selectionEntityIds],
      createdAt: new Date().toISOString(),
      consumedAt: null,
    }
    this.metadata.savePendingProjectHandoffPack(pack)
    this.events.publish(input.projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [input.toConversationId],
      payload: { kind: 'receiver.handoff_prepared', fromConversationId: input.fromConversationId, toConversationId: input.toConversationId, surfaceKind: input.surface.kind },
    })
    return pack
  }

  /** 读 pending（未消费的 Handoff 快照）；无则 null。前端切换后可查，发送前判断是否注入。 */
  getPendingHandoff(projectId: string, toConversationId: string): ProjectHandoffPackV1 | null {
    const project = this.metadata.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    return this.metadata.getPendingProjectHandoffPack(projectId, toConversationId)
  }

  /** 消费 pending：注入首条消息后调用，返回被消费的快照并标记 consumedAt。
   *  幂等：无 pending（已消费或从未准备）返回 null，不报错。 */
  consumePendingHandoff(projectId: string, toConversationId: string, origin?: ProjectEventOrigin): ProjectHandoffPackV1 | null {
    const project = this.metadata.getProject(projectId)
    if (project === undefined) throw new Error('Project not found.')
    const consumed = this.metadata.markProjectHandoffPackConsumed(projectId, toConversationId, new Date().toISOString())
    if (consumed === null) return null
    this.events.publish(projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin }),
      entityRefs: [toConversationId],
      payload: { kind: 'receiver.handoff_consumed', fromConversationId: consumed.fromConversationId, toConversationId, surfaceKind: consumed.surface.kind },
    })
    return consumed
  }
}
