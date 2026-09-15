/**
 * T7 Host transport: Local Core calls the Huabu Host over HTTP.
 *
 * The agentlet daemon owns the `/api/acp/agent` WebSocket and sends
 * `agentlet/hello`. Local Core is a consumer of the Huabu Host control
 * facade; it never presents itself as an agentlet and never sends
 * `server/*` frames directly to the daemon.
 */

import type { CapabilityClaimV1 } from '@local-creative-os/contracts'
import { classifyHuabuTransportErrorV1, type HuabuAgentletSessionInfoV1, type HuabuAgentletTransportV1 } from './huabu-agentlet-continuation-adapter.js'

interface HostTransportResponse<T> {
  readonly value?: T
  readonly error?: { readonly code?: string; readonly message?: string }
}

interface HostTransportSession {
  readonly agentletId: string
  readonly sessionId: string
  readonly appId?: string
  readonly pid?: number
  readonly cwd?: string
  readonly status: string
}

interface HostTransportList {
  readonly agentletId: string
  readonly agents: readonly HuabuAgentletSessionInfoV1[]
}

interface HostTransportSpawn {
  readonly agentletId: string
  readonly sessionId: string
  readonly pid: number
  readonly cwd?: string
}

export interface HuabuAgentletHostTransportOptionsV1 {
  /** Huabu HTTP origin, e.g. http://127.0.0.1:3001. */
  readonly hostBaseUrl: string
  /** Target daemon identity as resolved by the T7 adapter. */
  readonly agentletId?: string
  /** Huabu bearer token used by the server-side control facade. */
  readonly authToken?: string
  /** Session command supplied to Huabu Gateway spawn. */
  readonly spawnCommand?: string
  readonly spawnCwd?: string
  readonly timeoutMs?: number
}

export class HuabuAgentletHostTransportV1 implements HuabuAgentletTransportV1 {
  readonly kind = 'huabu-agentlet-host'
  private readonly timeoutMs: number
  private readonly agentletId: string

  constructor(private readonly options: HuabuAgentletHostTransportOptionsV1) {
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.agentletId = options.agentletId ?? process.env.HUABU_AGENTLET_ID ?? 'lcos-default-agentlet'
  }

  async probe(): Promise<{ readonly session: Readonly<Partial<Record<'createSession' | 'continueExisting' | 'send' | 'status' | 'cancel' | 'recoverExisting', CapabilityClaimV1>>>; readonly limitations?: readonly string[] }> {
    try {
      await this.list(this.agentletId)
      const now = new Date().toISOString()
      const claim = (): CapabilityClaimV1 => ({ value: true, source: 'gateway_probe' as const, observedAt: now })
      return {
        session: { status: claim(), recoverExisting: claim() },
        limitations: [
          'create/continue/cancel are delegated to Huabu Host but are not probed because they have external side effects',
          'prompt send is unsupported until Huabu ACP session owner is exposed',
        ],
      }
    } catch (error: unknown) {
      return {
        session: {},
        limitations: [`Huabu Host probe failed: ${error instanceof Error ? error.message : String(error)}`],
      }
    }
  }

  async spawn(params: { readonly agentletId: string; readonly appId: string; readonly sessionId?: string }): Promise<{ readonly sessionId: string; readonly pid: number; readonly cwd?: string }> {
    if (this.options.spawnCommand === undefined) {
      throw new Error('No spawn command configured (HUABU_AGENTLET_SPAWN_COMMAND); cannot spawn a real agent.')
    }
    const result = await this.request<HostTransportSpawn>(
      `/api/acp/continuation/agentlets/${encodeURIComponent(params.agentletId)}/sessions`,
      'POST',
      {
        appId: params.appId,
        ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
        sessionSpec: {
          command: this.options.spawnCommand,
          ...(this.options.spawnCwd === undefined ? {} : { cwd: this.options.spawnCwd }),
        },
      },
    )
    return { sessionId: result.sessionId, pid: result.pid, ...(result.cwd === undefined ? {} : { cwd: result.cwd }) }
  }

  async stop(params: { readonly agentletId: string; readonly sessionId: string }): Promise<{ readonly stopped: boolean }> {
    const result = await this.request<{ readonly stopped: boolean }>(
      `/api/acp/continuation/agentlets/${encodeURIComponent(params.agentletId)}/sessions/${encodeURIComponent(params.sessionId)}/stop`,
      'POST',
      {},
    )
    return { stopped: result.stopped }
  }

  async list(agentletId: string): Promise<{ readonly agents: readonly HuabuAgentletSessionInfoV1[] }> {
    const result = await this.request<HostTransportList>(
      `/api/acp/continuation/agentlets/${encodeURIComponent(agentletId)}/sessions`,
      'GET',
    )
    return { agents: result.agents }
  }

  async getSession(agentletId: string, sessionId: string): Promise<HuabuAgentletSessionInfoV1 | undefined> {
    try {
      const result = await this.request<HostTransportSession>(
        `/api/acp/continuation/agentlets/${encodeURIComponent(agentletId)}/sessions/${encodeURIComponent(sessionId)}`,
        'GET',
      )
      return {
        sessionId: result.sessionId,
        ...(result.appId === undefined ? {} : { appId: result.appId }),
        ...(result.pid === undefined ? {} : { pid: result.pid }),
        ...(result.cwd === undefined ? {} : { cwd: result.cwd }),
        status: result.status,
      }
    } catch (error: unknown) {
      if (error instanceof HuabuHostHttpError && error.status === 404) return undefined
      throw error
    }
  }

  /**
   * Resource delivery is not a prompt transport. Keep the legacy seam
   * explicit for old fake implementations, but never call it from the
   * continuation adapter's `send` action.
   */
  async sendResource(_params: { readonly agentletId: string; readonly sessionId: string; readonly text?: string; readonly resourceRef?: string }): Promise<void> {
    throw new Error('prompt transport is not wired through the Huabu ACP session owner')
  }

  private async request<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = { accept: 'application/json' }
      if (body !== undefined) headers['content-type'] = 'application/json'
      if (this.options.authToken !== undefined) headers.authorization = `Bearer ${this.options.authToken}`
      const response = await fetch(new URL(path, this.options.hostBaseUrl).toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({})) as HostTransportResponse<T> & T
      if (!response.ok) {
        const code = payload.error?.code ?? `http_${response.status}`
        const message = payload.error?.message ?? `Huabu Host request failed (${response.status}).`
        throw new HuabuHostHttpError(response.status, code, message)
      }
      if (payload.value !== undefined) return payload.value
      return payload as T
    } catch (error: unknown) {
      if (controller.signal.aborted) throw new Error('Huabu Host request timed out')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

export class HuabuHostHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'HuabuHostHttpError'
  }
}

/** Keep the provider error classification shared with the legacy fake/adapter path. */
export function classifyHuabuHostTransportErrorV1(error: unknown): ReturnType<typeof classifyHuabuTransportErrorV1> {
  return classifyHuabuTransportErrorV1(error)
}
