/**
 * T7（组 1）：真实 Huabu Agentlet Gateway transport（非 fake）。
 *
 * 连接 Huabu Agentlet Gateway 的 WS 控制通道（server/spawn|stop|list|sendResource，
 * 见 huabu/external/agentlet/spec/protocol.md）。Node ≥21 提供全局 WebSocket。
 *
 * 诚实边界：
 * - 本文件是真实 transport（真进程/真发送/真取消的证据通道），不是测试替身；
 * - 但 spawn 仍需要有效的 sessionSpec（命令/工作目录），由环境变量提供；
 *   未配置命令时 spawn 返回 capability 级错误（不冒充成功）。
 * - 连接失败/超时 → classifyHuabuTransportErrorV1（timeout/断线 = outcomeUnknown，
 *   绝不自动 retry）。
 */

import { randomUUID } from 'node:crypto'
import type { CapabilityClaimV1 } from '@local-creative-os/contracts'
import { classifyHuabuTransportErrorV1, type HuabuAgentletSessionInfoV1, type HuabuAgentletTransportV1 } from './huabu-agentlet-continuation-adapter.js'

interface GatewayRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: string
  readonly method: string
  readonly params?: unknown
}

interface GatewayRpcResponse<T> {
  readonly id: string
  readonly result?: T
  readonly error?: { readonly code?: number; readonly message?: string }
}

interface SpawnResult { readonly sessionId: string; readonly pid: number }
interface StopResult { readonly stopped: boolean }
interface ListResult { readonly agents: readonly { readonly sessionId: string; readonly appId?: string; readonly pid?: number; readonly cwd?: string; readonly status?: string }[] }

export interface HuabuAgentletGatewayTransportOptionsV1 {
  /** Gateway WS URL，如 ws://127.0.0.1:3001/api/acp/agent。 */
  readonly gatewayUrl: string
  /** spawn 用的 sessionSpec.command（未配置 → spawn 诚实失败，不冒充）。 */
  readonly spawnCommand?: string
  readonly spawnCwd?: string
  readonly timeoutMs?: number
}

export class HuabuAgentletGatewayTransportV1 implements HuabuAgentletTransportV1 {
  readonly kind = 'huabu-agentlet-gateway'
  private readonly timeoutMs: number

  constructor(private readonly options: HuabuAgentletGatewayTransportOptionsV1) {
    this.timeoutMs = options.timeoutMs ?? 10_000
  }

  async probe(): Promise<{ readonly session: Readonly<Partial<Record<'createSession' | 'continueExisting' | 'send' | 'status' | 'cancel' | 'recoverExisting', CapabilityClaimV1>>>; readonly limitations?: readonly string[] }> {
    try {
      await this.request<ListResult>('server/list', {})
      const now = new Date().toISOString()
      const claim = (): CapabilityClaimV1 => ({ value: true, source: 'gateway_probe' as const, observedAt: now })
      return {
        session: {
          createSession: claim(),
          continueExisting: claim(),
          send: claim(),
          status: claim(),
          cancel: claim(),
          recoverExisting: claim(),
        },
      }
    } catch (error: unknown) {
      return {
        session: {},
        limitations: [`gateway probe failed: ${error instanceof Error ? error.message : String(error)}`],
      }
    }
  }

  async spawn(params: { readonly agentletId: string; readonly appId: string; readonly sessionId?: string }): Promise<{ readonly sessionId: string; readonly pid: number; readonly cwd?: string }> {
    if (this.options.spawnCommand === undefined) {
      throw new Error('No spawn command configured (HUABU_AGENTLET_SPAWN_COMMAND); cannot spawn a real agent.')
    }
    const result = await this.request<SpawnResult>('server/spawn', {
      appId: params.appId,
      ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
      sessionSpec: {
        command: this.options.spawnCommand,
        ...(this.options.spawnCwd === undefined ? {} : { cwd: this.options.spawnCwd }),
      },
    })
    return { sessionId: result.sessionId, pid: result.pid, ...(this.options.spawnCwd === undefined ? {} : { cwd: this.options.spawnCwd }) }
  }

  async stop(_params: { readonly agentletId: string; readonly sessionId: string }): Promise<{ readonly stopped: boolean }> {
    const result = await this.request<StopResult>('server/stop', { sessionId: _params.sessionId })
    return { stopped: result.stopped }
  }

  async list(_agentletId: string): Promise<{ readonly agents: readonly HuabuAgentletSessionInfoV1[] }> {
    const result = await this.request<ListResult>('server/list', {})
    return {
      agents: result.agents.map((agent) => ({
        sessionId: agent.sessionId,
        ...(agent.appId === undefined ? {} : { appId: agent.appId }),
        ...(agent.pid === undefined ? {} : { pid: agent.pid }),
        ...(agent.cwd === undefined ? {} : { cwd: agent.cwd }),
        status: agent.status ?? 'running',
      })),
    }
  }

  async getSession(_agentletId: string, sessionId: string): Promise<HuabuAgentletSessionInfoV1 | undefined> {
    const listed = await this.list(_agentletId)
    return listed.agents.find((agent) => agent.sessionId === sessionId)
  }

  async sendResource(params: { readonly agentletId: string; readonly sessionId: string; readonly text?: string; readonly resourceRef?: string }): Promise<void> {
    if (params.text === undefined && params.resourceRef === undefined) return
    await this.request<Record<string, never>>('server/sendResource', {
      destination: `${params.sessionId}:${params.resourceRef ?? 'prompt'}`,
      content: params.text ?? params.resourceRef,
    })
  }

  /** 单次 WS JSON-RPC 请求：连接 → 发帧 → 按 id 关联响应 → 关闭。 */
  private async request<T>(method: string, params: unknown): Promise<T> {
    const socket = new WebSocket(this.options.gatewayUrl)
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error(`gateway connect failed: ${this.options.gatewayUrl}`))
    })
    const id = `lcos-${randomUUID()}`
    try {
      const response = await new Promise<GatewayRpcResponse<T>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('gateway request timed out')), this.timeoutMs)
        socket.onmessage = (event: MessageEvent<string>) => {
          let message: GatewayRpcResponse<T>
          try {
            message = JSON.parse(String(event.data)) as GatewayRpcResponse<T>
          } catch {
            return // 非 JSON 帧（日志等）忽略
          }
          if (message.id !== id) return
          clearTimeout(timer)
          if (message.error !== undefined) {
            reject(new Error(message.error.message ?? `gateway ${method} failed`))
          } else {
            resolve(message)
          }
        }
        socket.onclose = () => {
          clearTimeout(timer)
          reject(new Error('gateway connection closed'))
        }
      })
      if (response.result === undefined) throw new Error(`gateway ${method} returned no result`)
      return response.result
    } finally {
      socket.close()
    }
  }
}

/** 组合错误分类：真实 transport 的异常 → provider error（timeout/断线 = outcomeUnknown）。 */
export function classifyGatewayTransportErrorV1(error: unknown): ReturnType<typeof classifyHuabuTransportErrorV1> {
  return classifyHuabuTransportErrorV1(error)
}
