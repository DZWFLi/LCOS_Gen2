import type {
  BridgeResultEnvelopeV0,
  BridgeRuntimePort,
  BridgeTaskEnvelopeV0,
  BridgeTaskIdentity,
  RuntimeProviderError,
} from './runtime-adapter.js'
import { RuntimeAdapterError } from './runtime-adapter.js'

type JsonObject = Record<string, unknown>

function providerError(code: string, message: string, retryable: boolean): RuntimeAdapterError {
  const detail: RuntimeProviderError = { code, message, retryable, provider: 'workbuddy' }
  return new RuntimeAdapterError(detail)
}

function assertLoopback(endpoint: URL): void {
  if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(endpoint.hostname)) {
    throw providerError('BRIDGE_UNAVAILABLE', 'Light Bridge REST endpoint must use loopback HTTP.', false)
  }
}

function asObject(value: unknown): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw providerError('CONTRACT_UNSUPPORTED', 'Light Bridge returned a non-object response.', false)
  }
  return value as JsonObject
}

function normalizeIdentity(taskValue: unknown, expected?: {
  readonly runId: string
  readonly requestFingerprint: string
  readonly contractVersion: string
}): BridgeTaskIdentity {
  const task = asObject(taskValue)
  const taskId = task.taskId ?? task.task_id
  const runId = task.lcosRunId ?? task.lcos_run_id ?? expected?.runId
  const fingerprint = task.requestFingerprint ?? task.request_fingerprint ?? expected?.requestFingerprint
  const contractVersion = task.contractVersion ?? task.contract_version ?? expected?.contractVersion
  if (typeof taskId !== 'string' || typeof runId !== 'string' || typeof task.status !== 'string'
    || typeof fingerprint !== 'string' || typeof contractVersion !== 'string') {
    throw providerError('CONTRACT_UNSUPPORTED', 'Light Bridge Task identity is incomplete.', false)
  }
  const sessionId = task.externalSessionId ?? task.external_session_id
  const leaseExpiresAt = task.leaseExpiresAt ?? task.lease_expires_at
  return {
    taskId,
    lcosRunId: runId,
    status: task.status,
    requestFingerprint: fingerprint,
    contractVersion,
    ...(typeof sessionId === 'string' && sessionId ? { sessionId } : {}),
    ...(typeof leaseExpiresAt === 'string' && leaseExpiresAt ? { leaseExpiresAt } : {}),
  }
}

function normalizeInputRequest(value: unknown): NonNullable<BridgeResultEnvelopeV0['inputRequest']> {
  const item = asObject(value)
  const requestId = item.requestId ?? item.request_id
  const question = item.question
  const options = item.options
  const allowFreeText = item.allowFreeText ?? item.allow_free_text
  const contextVersion = item.contextVersion ?? item.context_version
  const createdAt = item.createdAt ?? item.created_at
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)
    || typeof question !== 'string' || !Array.isArray(options) || typeof allowFreeText !== 'boolean') {
    throw providerError('CONTRACT_UNSUPPORTED', 'Light Bridge input request is invalid.', false)
  }
  return {
    requestId,
    question,
    options: options.filter((item): item is string => typeof item === 'string'),
    allowFreeText,
    ...(typeof contextVersion === 'number' ? { contextVersion } : {}),
    ...(typeof createdAt === 'string' ? { createdAt } : {}),
  }
}

export class RestBridgeRuntimeClient implements BridgeRuntimePort {
  readonly #endpoint: URL

  constructor(endpoint: string, private readonly request: typeof fetch = fetch) {
    this.#endpoint = new URL(endpoint)
    assertLoopback(this.#endpoint)
  }

  async createTask(envelope: BridgeTaskEnvelopeV0, _projectId: string): Promise<BridgeTaskIdentity> {
    if (envelope.contractVersion !== 'bridge-task-v1') {
      throw providerError('CONTRACT_UNSUPPORTED', 'Light Bridge REST accepts only bridge-task-v1.', false)
    }
    const response = await this.#json('/v1/tasks', { method: 'POST', body: envelope })
    return normalizeIdentity(response.task, {
      runId: envelope.lcosRunId,
      requestFingerprint: envelope.requestFingerprint,
      contractVersion: envelope.contractVersion,
    })
  }

  async findTaskByRunId(runId: string): Promise<BridgeTaskIdentity | undefined> {
    try {
      const response = await this.#json(`/v1/tasks/by-run/${encodeURIComponent(runId)}`)
      return normalizeIdentity(response.task)
    } catch (error: unknown) {
      if (error instanceof RuntimeAdapterError && error.detail.code === 'TASK_NOT_FOUND') return undefined
      throw error
    }
  }

  async getTask(taskId: string, runId: string): Promise<BridgeTaskIdentity | undefined> {
    try {
      const response = await this.#json(`/v1/tasks/${encodeURIComponent(taskId)}`)
      return normalizeIdentity(response.task, {
        runId,
        requestFingerprint: 'binding-recovery',
        contractVersion: 'bridge-task-v1',
      })
    } catch (error: unknown) {
      if (error instanceof RuntimeAdapterError && error.detail.code === 'TASK_NOT_FOUND') return undefined
      throw error
    }
  }

  async getResult(taskId: string, runId: string): Promise<BridgeResultEnvelopeV0 | undefined> {
    const response = await this.#json(`/v1/tasks/${encodeURIComponent(taskId)}`)
    const task = asObject(response.task)
    const status = String(task.status ?? '')
    if (!['review', 'waiting_input', 'failed', 'cancelled', 'timeout'].includes(status)) return undefined
    const taskRunId = task.lcosRunId ?? task.lcos_run_id
    if (typeof taskRunId === 'string' && taskRunId !== runId) {
      throw providerError('CONTRACT_UNSUPPORTED', 'Light Bridge result belongs to another Run.', false)
    }
    const rawResult = task.result
    const result = rawResult === null || rawResult === undefined ? {} : asObject(rawResult)
    const changedFiles = result.changedFiles ?? result.changed_files ?? []
    if (!Array.isArray(changedFiles)) throw providerError('CONTRACT_UNSUPPORTED', 'Light Bridge result changedFiles is invalid.', false)
    const providerStatus = String(result.providerStatus ?? result.provider_status ?? task.providerStatus ?? task.provider_status ?? status)
    if (!['review', 'waiting_input', 'failed', 'cancelled', 'timeout'].includes(providerStatus)) return undefined
    const inputRequest = result.inputRequest ?? result.input_request ?? task.inputRequest ?? task.input_request
    return {
      contractVersion: String(result.contractVersion ?? result.contract_version) === 'bridge-result-v0' ? 'bridge-result-v0' : 'bridge-result-v1',
      taskId,
      lcosRunId: runId,
      providerStatus: providerStatus as BridgeResultEnvelopeV0['providerStatus'],
      ...(typeof result.shortSummary === 'string' ? { shortSummary: result.shortSummary } : {}),
      ...(typeof result.short_summary === 'string' ? { shortSummary: result.short_summary } : {}),
      ...(typeof result.resultSummary === 'string' ? { resultSummary: result.resultSummary } : {}),
      ...(typeof result.result_summary === 'string' ? { resultSummary: result.result_summary } : {}),
      ...(typeof result.summary === 'string' ? { summary: result.summary } : {}),
      ...(Array.isArray(result.warnings) ? { warnings: result.warnings.filter((item): item is string => typeof item === 'string') } : {}),
      ...(Array.isArray(result.suggestedNextActions) ? { suggestedNextActions: result.suggestedNextActions.filter((item): item is string => typeof item === 'string') } : {}),
      ...(Array.isArray(result.suggested_next_actions) ? { suggestedNextActions: result.suggested_next_actions.filter((item): item is string => typeof item === 'string') } : {}),
      ...(inputRequest === undefined || inputRequest === null ? {} : { inputRequest: normalizeInputRequest(inputRequest) }),
      changedFiles: changedFiles.map((raw) => {
        const item = asObject(raw)
        if (typeof item.path !== 'string' || !['created', 'modified'].includes(String(item.action))) {
          throw providerError('CONTRACT_UNSUPPORTED', 'Light Bridge changedFiles violates ResultEnvelope.', false)
        }
        return {
          path: item.path,
          action: item.action === 'modified' ? 'modified' as const : 'created' as const,
          ...(typeof item.role === 'string' ? { role: item.role } : {}),
          ...(typeof item.mediaType === 'string' ? { mediaType: item.mediaType } : {}),
          ...(typeof item.media_type === 'string' ? { mediaType: item.media_type } : {}),
          ...(typeof item.contentHash === 'string' ? { contentHash: item.contentHash } : {}),
          ...(typeof item.content_hash === 'string' ? { contentHash: item.content_hash } : {}),
        }
      }),
    }
  }

  async answerInput(taskId: string, response: { readonly requestId: string; readonly text?: string; readonly selectedOptions?: readonly string[] }): Promise<void> {
    await this.#json(`/v1/tasks/${encodeURIComponent(taskId)}/input-response`, {
      method: 'POST',
      body: {
        requestId: response.requestId,
        ...(response.text === undefined ? {} : { text: response.text }),
        selectedOptions: response.selectedOptions ?? [],
        respondedBy: 'user',
      },
    })
  }

  async finalizeReview(taskId: string, decision: 'completed' | 'retrying', comment = ''): Promise<void> {
    await this.#json(`/v1/tasks/${encodeURIComponent(taskId)}/finalize`, { method: 'POST', body: { decision, comment } })
  }

  async cancelTask(taskId: string, runId: string): Promise<void> {
    const response = await this.#json(`/v1/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: {} })
    const task = asObject(response.task)
    if (String(task.status).toLowerCase() !== 'cancelled') {
      throw providerError('CANCEL_REJECTED', `Light Bridge did not cancel task ${taskId} for run ${runId}.`, false)
    }
  }

  async getCapabilities(): Promise<{
    readonly bridgeVersion?: string
    readonly primaryContractVersion?: string
    readonly providers?: readonly {
      readonly provider: string
      readonly executionMode?: string
      readonly taskTypes?: readonly string[]
      readonly outputIntents?: readonly string[]
      readonly contractVersions?: readonly string[]
      readonly sessionBinding?: boolean
      readonly completionHook?: boolean
    }[]
  }> {
    const response = await this.#json('/v1/capabilities')
    return {
      ...(typeof response.bridgeVersion === 'string' ? { bridgeVersion: response.bridgeVersion } : {}),
      ...(typeof response.primaryContractVersion === 'string' ? { primaryContractVersion: response.primaryContractVersion } : {}),
      ...(Array.isArray(response.providers) ? {
        providers: response.providers.map((raw) => {
          const item = asObject(raw)
          return {
            provider: String(item.provider ?? ''),
            ...(typeof item.executionMode === 'string' ? { executionMode: item.executionMode } : {}),
            ...(Array.isArray(item.taskTypes) ? { taskTypes: item.taskTypes.map(String) } : {}),
            ...(Array.isArray(item.outputIntents) ? { outputIntents: item.outputIntents.map(String) } : {}),
            ...(Array.isArray(item.contractVersions) ? { contractVersions: item.contractVersions.map(String) } : {}),
            ...(typeof item.sessionBinding === 'boolean' ? { sessionBinding: item.sessionBinding } : {}),
            ...(typeof item.completionHook === 'boolean' ? { completionHook: item.completionHook } : {}),
          }
        }),
      } : {}),
    }
  }

  async #json(path: string, input: { readonly method?: string; readonly body?: unknown } = {}): Promise<JsonObject> {
    let response: Response
    try {
      response = await this.request(new URL(path, `${this.#endpoint.origin}/`), {
        method: input.method ?? 'GET',
        headers: { accept: 'application/json', ...(input.body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      })
    } catch (error: unknown) {
      throw providerError('BRIDGE_UNAVAILABLE', error instanceof Error ? error.message : 'Light Bridge request failed.', true)
    }
    const decoded = await response.json().catch(() => undefined)
    if (!response.ok) {
      const payload = typeof decoded === 'object' && decoded !== null ? decoded as JsonObject : {}
      const error = typeof payload.error === 'object' && payload.error !== null ? payload.error as JsonObject : {}
      throw providerError(
        typeof error.code === 'string' ? error.code : 'BRIDGE_UNAVAILABLE',
        typeof error.message === 'string' ? error.message : `Light Bridge returned HTTP ${response.status}.`,
        error.retryable === true,
      )
    }
    return asObject(decoded)
  }
}
