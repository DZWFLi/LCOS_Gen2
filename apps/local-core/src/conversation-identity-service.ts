/**
 * Conversation Identity Bridge 运行时（20260827 P0，前端 0.15 GUI Truth 配合项）。
 *
 * 职责：把两套会话身份（connected-conversation-* 承接层 / conversation-* 导入层）
 * 解析成一条 canonical 链，并解析 Artifact 出生谱系。
 *
 * 对标纪律（huabu 同构）：
 * - 身份靠显式绑定，不靠内容相似度（huabu AGENTLET_TOKEN spawn 时注入；本层
 *   link-session 显式写入，未链接 = undefined，绝不回退 provider/title/时间猜）。
 * - 谱系写入时盖戳（huabu canvas-write 的 author:'ai'/labelSource:'agent' 注入点）；
 *   本层 birth_run_id 在 acceptArtifactReturn 的诞生分支落库，读取只投影不推断。
 *
 * Run→Conversation 一跳的连接键是结构事实而非启发式：
 * runtime_bindings.external_session_id === connected_conversations.conversation_ref
 * （两者同为「外部执行器会话的稳定引用」，桥 bind 时回绑——runtime-adapter.ts:358）。
 */

import type {
  ActiveReceiverIdentityV1,
  ConversationReachItemV0,
  ConversationReachResultV0,
  ArtifactBirthProvenanceV1,
  ConversationIdentityChainV1,
} from '@local-creative-os/contracts'

import type { ConversationImportService } from './conversation-import-service.js'
import type { SessionLifecycleService } from './session-lifecycle-service.js'
import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'

export class ConversationIdentityService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly conversations: ConversationImportService,
    private readonly sessionLifecycle: SessionLifecycleService | undefined,
    private readonly events: ProjectEventHub,
  ) {}

  /** 解析一条承接会话的完整身份链；会话不存在 = undefined（路由层 404）。 */
  resolveChain(projectId: string, connectedConversationId: string): ConversationIdentityChainV1 | undefined {
    const connected = this.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (connected === undefined) return undefined
    // 链接指向的导入会话可能已被删除：链 ID 留在 connected 上，会话体诚实缺席。
    const session = connected.conversationSessionId === undefined
      ? undefined
      : this.conversations.getProjection(projectId, connected.conversationSessionId)?.session
    const lifecycle = this.sessionLifecycle?.getState(projectId, connected.provider)
    return {
      schemaVersion: 1,
      projectId,
      connectedConversation: connected,
      ...(session === undefined ? {} : {
        conversationSession: session,
        ...(session.conversationArtifactId === undefined ? {} : { conversationArtifactId: session.conversationArtifactId }),
        ...(session.conversationViewId === undefined ? {} : { conversationViewId: session.conversationViewId }),
      }),
      ...(lifecycle === undefined ? {} : { lifecycle }),
    }
  }

  /** Active Receiver 全链解析：activeReceiverId → 链 → 画布那只 Glyth 的控制句柄。 */
  resolveActiveReceiver(projectId: string): ActiveReceiverIdentityV1 {
    const binding = this.metadata.getProjectReceiverBinding(projectId)
    if (binding.activeReceiverId === null) {
      return { schemaVersion: 1, projectId, activeReceiverId: null }
    }
    const chain = this.resolveChain(projectId, binding.activeReceiverId)
    // disconnect 路由保证 activeReceiverId 清空；防御分支：指向已删会话时链缺席但 id 诚实呈现。
    return {
      schemaVersion: 1,
      projectId,
      activeReceiverId: binding.activeReceiverId,
      ...(chain === undefined ? {} : { chain }),
    }
  }

  /**
   * 显式建立/覆盖链接（唯一写路径）。验证两侧都存在且同项目；
   * 会话侧经 ConversationImportService.getProjection 校验（含已删检测）。
   */
  linkSession(projectId: string, connectedConversationId: string, conversationSessionId: string, origin?: string): ConversationIdentityChainV1 {
    const connected = this.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (connected === undefined) throw new Error('Connected conversation not found.')
    if (this.conversations.getProjection(projectId, conversationSessionId) === undefined) {
      throw new Error('Conversation session not found in project.')
    }
    const updated = this.metadata.linkConnectedConversationSession(projectId, connectedConversationId, conversationSessionId)
    if (updated === undefined) throw new Error('Connected conversation not found.')
    this.events.publish(projectId, {
      channel: 'continuity',
      type: 'continuity.changed',
      ...(origin === undefined ? {} : { origin: origin as never }),
      entityRefs: [connectedConversationId, conversationSessionId],
      payload: {
        kind: 'conversation.identity_linked',
        connectedConversationId,
        conversationSessionId,
        provider: updated.provider,
      },
    })
    const chain = this.resolveChain(projectId, connectedConversationId)
    if (chain === undefined) throw new Error('Identity chain resolution failed after link.')
    return chain
  }

  /**
   * F6 P0-D3（20260828）：Conversation Reachability read projection。
   * 「这只 Glyth 在 LCOS 已经 mapped / produced / referenced 了哪些对象」——
   * 全部从既有 truth 现算（birth_run_id 反查 / relations kind=conversation_context /
   * conversation_file_references / workspace memberships），不建第二套 Project Truth。
   */
  reach(projectId: string, connectedConversationId: string): ConversationReachResultV0 | undefined {
    const connected = this.metadata.getConnectedConversation(projectId, connectedConversationId)
    if (connected === undefined) return undefined
    const items: ConversationReachItemV0[] = []
    const seen = new Set<string>()
    const push = (item: ConversationReachItemV0): void => {
      const key = `${item.entityRef.type}:${item.entityRef.id}`
      if (seen.has(key)) return
      seen.add(key)
      items.push(item)
    }

    // ① produced：birth_run_id → runtime_binding.external_session_id → 本 conversation。
    for (const artifact of this.metadata.getArtifacts(projectId)) {
      const birthRunId = this.metadata.getArtifactBirthRunId(String(artifact.id))
      if (birthRunId === undefined) continue
      const binding = this.metadata.getRuntimeBinding(birthRunId as never)
      if (binding?.externalSessionId === undefined) continue
      const birthConnected = this.metadata.getConnectedConversationByRef(projectId, binding.externalSessionId)
      if (birthConnected === undefined || String(birthConnected.id) !== connectedConversationId) continue
      push({
        entityRef: { type: 'artifact', id: String(artifact.id) },
        tier: 'produced',
        reason: `born from run ${String(birthRunId)} via this conversation`,
        ...(typeof (artifact as { readonly createdAt?: string }).createdAt === 'string' ? { createdAt: (artifact as { readonly createdAt?: string }).createdAt } : {}),
        sourceRef: `run:${String(birthRunId)}`,
      })
    }

    // ② bound：显式 conversation_context relation（source = conversationArtifactId 或 conversation ref）。
    const conversationKeys = new Set<string>([connectedConversationId, connected.conversationRef])
    if (connected.conversationSessionId !== undefined) conversationKeys.add(connected.conversationSessionId)
    for (const relation of this.metadata.getRelations(projectId)) {
      const sourceKey = String(relation.sourceEntityId)
      if (!conversationKeys.has(sourceKey)) continue
      if (relation.kind !== 'conversation_context' && relation.kind !== 'conversation-context') continue
      const targetArtifact = this.metadata.getArtifact(String(relation.targetEntityId))
      if (targetArtifact !== undefined) {
        push({
          entityRef: { type: 'artifact', id: String(relation.targetEntityId) },
          tier: 'bound',
          reason: 'explicit conversation_context binding',
          createdAt: relation.createdAt,
          sourceRef: `relation:${String(relation.id)}`,
        })
      }
    }

    // ③ referenced：conversation_file_references（导入会话维度）。
    if (connected.conversationSessionId !== undefined) {
      for (const artifactId of this.metadata.listArtifactIdsReferencedByConversation(connected.conversationSessionId)) {
        const artifact = this.metadata.getArtifact(artifactId)
        if (artifact === undefined || String(artifact.projectId) !== projectId) continue
        push({
          entityRef: { type: 'artifact', id: artifactId },
          tier: 'referenced',
          reason: 'referenced in imported conversation transcript',
          sourceRef: `conversation-file-reference:${connected.conversationSessionId}`,
        })
      }
    }

    return {
      schemaVersion: 0,
      projectId,
      connectedConversationId,
      items,
    }
  }
  /** Artifact 出生谱系；artifact 不存在 = undefined（路由层 404）。 */
  resolveBirth(projectId: string, artifactId: string): ArtifactBirthProvenanceV1 | undefined {
    const artifact = this.metadata.getArtifact(artifactId)
    if (artifact === undefined) return undefined
    const birthRunId = this.metadata.getArtifactBirthRunId(artifactId)
    const base: ArtifactBirthProvenanceV1 = {
      schemaVersion: 1,
      projectId,
      artifactId,
      origin: birthRunId === undefined ? 'unknown' : 'run-return',
    }
    if (birthRunId === undefined) return base
    const run = this.metadata.getRun(birthRunId as never)
    const binding = this.metadata.getRuntimeBinding(birthRunId as never)
    const connected = binding?.externalSessionId === undefined
      ? undefined
      : this.metadata.getConnectedConversationByRef(projectId, binding.externalSessionId)
    const session = connected?.conversationSessionId === undefined
      ? undefined
      : this.conversations.getProjection(projectId, connected.conversationSessionId)?.session
    return {
      ...base,
      birthRunId,
      ...(run === undefined ? {} : {
        run: {
          id: String(run.id),
          status: run.status,
          provider: run.provider,
          instruction: run.instruction,
        },
      }),
      ...(binding === undefined ? {} : {
        runtimeBinding: {
          ...(binding.externalTaskId === undefined ? {} : { externalTaskId: binding.externalTaskId }),
          ...(binding.externalSessionId === undefined ? {} : { externalSessionId: binding.externalSessionId }),
        },
      }),
      ...(connected === undefined ? {} : { connectedConversation: connected }),
      ...(session === undefined ? {} : {
        conversationSession: session,
        ...(session.conversationArtifactId === undefined ? {} : { conversationArtifactId: session.conversationArtifactId }),
        ...(session.conversationViewId === undefined ? {} : { conversationViewId: session.conversationViewId }),
      }),
    }
  }
}
