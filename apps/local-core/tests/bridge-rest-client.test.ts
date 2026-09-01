import { describe, expect, it, vi } from 'vitest'
import { RestBridgeRuntimeClient } from '../src/bridge-rest-client.js'
import type { BridgeTaskEnvelopeV0 } from '../src/runtime-adapter.js'

const envelope: BridgeTaskEnvelopeV0 = {
  contractVersion: 'bridge-task-v1',
  lcosRunId: 'run-one',
  idempotencyKey: 'run-one',
  requestFingerprint: 'fingerprint-one',
  manifestId: 'manifest-one',
  manifestHash: 'hash-one',
  outputIntent: 'analyze',
  instructions: 'Analyze safely.',
  provider: 'codex',
  taskType: 'creative_run',
  runtimeInputPackPath: 'C:\\runtime\\runtime-input-pack.json',
  outputRoot: 'C:\\runtime\\output',
  expectedOutputs: [],
  outputPolicy: { allowZeroFiles: true, allowAdditionalFiles: false, maxFiles: 0 },
}
function response(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }) }

describe('RestBridgeRuntimeClient', () => {
  it('creates canonical V1 tasks over REST', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ task: { taskId: 'task-one', lcosRunId: 'run-one', status: 'created', requestFingerprint: 'fingerprint-one', contractVersion: 'bridge-task-v1' } }, 201))
    const client = new RestBridgeRuntimeClient('http://127.0.0.1:43122', request)
    await expect(client.createTask(envelope, 'project-one')).resolves.toMatchObject({ taskId: 'task-one', lcosRunId: 'run-one' })
    expect(String(request.mock.calls[0]?.[0])).toContain('/v1/tasks')
  })

  it('returns undefined for a structured task-not-found response', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ error: { code: 'TASK_NOT_FOUND', message: 'missing', retryable: false } }, 404))
    const client = new RestBridgeRuntimeClient('http://127.0.0.1:43122', request)
    await expect(client.findTaskByRunId('run-missing')).resolves.toBeUndefined()
  })

  it('rejects results belonging to another Run', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(response({ task: { taskId: 'task-one', lcosRunId: 'run-other', status: 'review', result: { contractVersion: 'bridge-result-v1', providerStatus: 'review', changedFiles: [] } } }))
    const client = new RestBridgeRuntimeClient('http://127.0.0.1:43122', request)
    await expect(client.getResult('task-one', 'run-one')).rejects.toMatchObject({ detail: { code: 'CONTRACT_UNSUPPORTED' } })
  })

  it('never accepts a non-loopback bridge endpoint', () => {
    expect(() => new RestBridgeRuntimeClient('http://0.0.0.0:43122')).toThrow()
  })
})
