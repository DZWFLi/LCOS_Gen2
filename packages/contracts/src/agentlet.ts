/**
 * Agentlet V1 — 任务四 P3：可插拔外部 agent 的打包与运行契约（借鉴 huabu agentlet，MIT）。
 *
 * 一个 agentlet = 一个目录（agentlet.yaml + 启动脚本 + system_prompt.md）。
 * 宿主（local-core）解析 manifest、以标准 env 契约 spawn 子进程；
 * 子进程经 Reachback HTTP 通道读写画布（读走 /space/、写走 CAS 守卫的
 * curation/text，sessionId 归因进 change-set）。
 *
 * 换 agent = 换一个目录：manifest 的 command 按 harness 声明
 * （node 脚本 / codex CLI / claude CLI …），env 契约不变。
 */

/** manifest 里的 schema 固定值。 */
export const AGENTLET_SCHEMA_V1 = 'lcos-agentlet-schema-v1'

export interface AgentletSummaryV1 {
  readonly name: string
  readonly description: string
  /** manifest command 声明的 harness 列表（首个为默认）。 */
  readonly harnesses: readonly string[]
  readonly timeoutSeconds: number
}

export type AgentletRunStatusV1 = 'running' | 'exited' | 'failed' | 'timeout'

export interface AgentletRunV1 {
  readonly id: string
  readonly agentlet: string
  readonly projectId: string
  readonly harness: string
  /** 写通道的 CAS/ChangeSet 归因 ID（actor=agent/<sessionId>）。 */
  readonly sessionId: string
  readonly instruction?: string
  readonly status: AgentletRunStatusV1
  /** 0-1；无进度来源时为 undefined（S6 事件流接入后填充）。 */
  readonly progress?: number
  readonly pid?: number
  readonly exitCode?: number
  /** 失败/超时的尾部 stderr 摘录（排障用）。 */
  readonly diagnostics?: string
  readonly startedAt: string
  readonly finishedAt?: string
}