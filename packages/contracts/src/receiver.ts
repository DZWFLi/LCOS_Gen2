/** RECEIVER-0 会话承接关系层（43H 数据模型 + 43J 接口的最小落地）。
 *  ConnectedConversation 记录"哪个对话连接到了哪个项目可继续做"。
 *  与 ProviderSessionBindingV1（lease 运行时层）分离并存：binding 管 watchdog/lease/failureCount，
 *  connected conversation 管用户视角的承接关系。数据模型存原料不存结论（status 由投影层算）。 */

/** 投影层状态结论：ready=空闲可承接，working=执行中，waiting=等待外部输入，offline=执行器离线。 */
export type ConnectedConversationStatus = 'ready' | 'working' | 'waiting' | 'offline'

export interface ConnectedConversationV1 {
  readonly schemaVersion: 1
  readonly id: string
  readonly projectId: string
  readonly provider: 'codex' | 'workbuddy'
  readonly executorId: string
  /** 对外部执行器会话的稳定引用（connect 语义由调用方提供，create 语义由 Core 生成）。 */
  readonly conversationRef: string
  /**
   * Conversation Identity Bridge（20260827 P0）：canonical 链接到的导入会话 ID。
   * 只由显式 link-session 写入；undefined = 未链接（诚实缺席，不按 provider/title/时间猜）。
   */
  readonly conversationSessionId?: string
  readonly label: string
  /** 原料字段（投影层算 status）：waitingReason ≠ null → waiting；isRunning → working；否则 ready。 */
  readonly isRunning: boolean
  readonly waitingReason: string | null
  readonly lastActiveAt: string
  readonly workspaceRef: string | null
  readonly branchRef: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ProjectReceiverBindingV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly connectedConversationIds: readonly string[]
  readonly activeReceiverId: string | null
  readonly revision: number
}

/** 状态投影纯函数：从原料算结论，存储层永不持久化 status。
 *  offline 留给运行时在线探测层（0.1 原料不含 executor 心跳）。 */
export function projectConnectedConversationStatusV1(conversation: ConnectedConversationV1): ConnectedConversationStatus {
  if (conversation.waitingReason !== null) return 'waiting'
  return conversation.isRunning ? 'working' : 'ready'
}

/** RECEIVER-3 Handoff 快照：切换 Active Receiver 时的「不失忆」承接包（方案 43E 字段表的 0.1 最小子集）。
 *  语义与 ContinuityAttachBundleV1 不同：Attach Bundle 是发给 Harness 的执行包，
 *  Handoff Pack 是切换现场快照，供新 Receiver 收到首条用户消息时注入 Project state。
 *  43E 的 context/execution/review 可选段暂不建（数据源未就绪，不造假字段）。 */
export interface ProjectHandoffPackV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  /** 从哪个会话切来（null=首次承接，无前手）。 */
  readonly fromConversationId: string | null
  /** 切到哪个会话（即新 Active Receiver 的 connected conversation id）。 */
  readonly toConversationId: string
  /** 切换时的当前视图现场（kind 三类 + surfaceId 视图身份）。 */
  readonly surface: { readonly kind: 'main' | 'context' | 'workflow'; readonly surfaceId: string }
  /** 切换时的当前选中实体 id 列表（冻结现场，不随后续选中变化）。 */
  readonly selectionEntityIds: readonly string[]
  readonly createdAt: string
  /** 注入首条消息后标记消费（null=尚未消费；消费后不再注入，幂等）。 */
  readonly consumedAt: string | null
}
