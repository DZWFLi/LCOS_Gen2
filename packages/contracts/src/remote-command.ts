/**
 * RemoteCommandEnvelopeV1 — RESERVE（S12，审计 §12）。
 *
 * 边界：
 *   - Cloud Gateway 是唯一未来消费者；localhost MCP 永不直接暴露公网。
 *   - 路由层只加 envelope 解析中间件 seam（本地透传），不实现 relay / Cloud account / auth。
 *   - idempotency key 规则：同一 requestId 在同一 project 重复提交必须幂等（后续实现真去重，
 *     本契约只定格规则与校验器）。
 */

/** mutation 分类（读/写/控制）。 */
export type RemoteMutationClassV1 = 'read' | 'write' | 'control'

/** 远程命令信封（RESERVE：类型 seam + 校验器，零运行时 relay）。 */
export interface RemoteCommandEnvelopeV1 {
  readonly schemaVersion: 1
  /** 幂等键：同一 project + requestId 重复提交语义相同。 */
  readonly requestId: string
  readonly userId: string
  readonly deviceId?: string
  readonly projectId: string
  readonly sourceApp: string
  readonly capability: string
  readonly targetRef?: string
  readonly payloadRef?: string
  readonly mutationClass: RemoteMutationClassV1
  readonly createdAt: string
}

/** idempotency key 规则（封闭明文）：requestId 非空、长度受限、无空白。 */
export function isValidRemoteRequestId(requestId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(requestId)
}

/** envelope 结构校验（fail-close）：非法 envelope 抛错。 */
export function validateRemoteCommandEnvelope(input: unknown): asserts input is RemoteCommandEnvelopeV1 {
  if (typeof input !== 'object' || input === null) throw new Error('Remote command envelope must be an object.')
  const value = input as Partial<RemoteCommandEnvelopeV1>
  if (value.schemaVersion !== 1) throw new Error('Remote command schemaVersion must be 1.')
  if (typeof value.requestId !== 'string' || !isValidRemoteRequestId(value.requestId)) {
    throw new Error('Remote command requestId is invalid (must match /^[A-Za-z0-9_-]{1,128}$/).')
  }
  if (typeof value.userId !== 'string' || value.userId.length === 0) throw new Error('Remote command userId is required.')
  if (typeof value.projectId !== 'string' || value.projectId.length === 0) throw new Error('Remote command projectId is required.')
  if (typeof value.sourceApp !== 'string' || value.sourceApp.length === 0) throw new Error('Remote command sourceApp is required.')
  if (typeof value.capability !== 'string' || value.capability.length === 0) throw new Error('Remote command capability is required.')
  if (value.mutationClass !== 'read' && value.mutationClass !== 'write' && value.mutationClass !== 'control') {
    throw new Error('Remote command mutationClass must be read|write|control.')
  }
  if (typeof value.createdAt !== 'string' || value.createdAt.length === 0) throw new Error('Remote command createdAt is required.')
}