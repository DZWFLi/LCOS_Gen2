import { describe, expect, it } from 'vitest'

import type { RunReview } from '@local-creative-os/contracts'

import { planCodexDispatch, type CodexTaskState } from '../src/codex-dispatch-service.js'

function review(overrides: Partial<RunReview['run']> = {}): RunReview {
  return {
    run: {
      id: 'run-codex-1' as never,
      projectId: 'project-1' as never,
      contextManifestId: 'manifest-1' as never,
      provider: 'codex',
      requestedProvider: 'codex',
      outputIntent: 'analyze',
      returnGroupId: 'rg-1',
      status: 'queued',
      instruction: '分析。',
      createdAt: '2026-08-04T12:00:00.000Z',
      updatedAt: '2026-08-04T12:00:00.000Z',
      ...overrides,
    },
    dispatch: { id: 'd-1' as never, runId: 'run-codex-1' as never, provider: 'codex', idempotencyKey: 'run-codex-1', status: 'bound', attemptCount: 1, createdAt: '', updatedAt: '' },
    returns: [],
    draftRevisions: [],
    presentationPhase: 'queued',
    capabilities: { schemaVersion: 1, accept: { enabled: false, reason: 'x' }, reject: { enabled: false, reason: 'x' }, retry: { enabled: false, reason: 'x' } },
  } as unknown as RunReview
}

describe('Codex dispatch plan follows Bridge task state machine', () => {
  const states = (entry: [string, CodexTaskState][]) => new Map(entry)

  it('dispatches when Bridge task is assigned', () => {
    const plan = planCodexDispatch(
      [review()],
      'C:\\project',
      [],
      states([['run-codex-1', { status: 'assigned' }]]),
    )
    expect(plan).toHaveLength(1)
    expect(plan[0]?.decision).toBe('spawn_new')
  })

  it('skips tasks claimed within lease', () => {
    const plan = planCodexDispatch(
      [review()],
      'C:\\project',
      [],
      states([['run-codex-1', { status: 'claimed', leaseExpiresAt: new Date(Date.now() + 60_000).toISOString() }]]),
    )
    expect(plan).toHaveLength(0)
  })

  it('re-dispatches tasks whose lease expired', () => {
    const plan = planCodexDispatch(
      [review()],
      'C:\\project',
      [],
      states([['run-codex-1', { status: 'claimed', leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() }]]),
    )
    expect(plan[0]?.decision).toBe('spawn_new')
  })

  it('skips tasks in review and terminal states', () => {
    for (const status of ['review', 'completed', 'failed', 'cancelled', 'timeout']) {
      const plan = planCodexDispatch(
        [review()],
        'C:\\project',
        [],
        states([['run-codex-1', { status }]]),
      )
      expect(plan).toHaveLength(0)
    }
  })

  it('skips runs without a Bridge task state (never blind-dispatch)', () => {
    const plan = planCodexDispatch([review()], 'C:\\project', [], new Map())
    expect(plan).toHaveLength(0)
  })
  it('waits when the preferred project session is busy', () => {
    const plan = planCodexDispatch(
      [review()],
      'C:\\project',
      [{ sessionId: 'session-one', busy: true }],
      states([['run-codex-1', { status: 'assigned' }]]),
    )
    expect(plan[0]?.decision).toBe('wait')
  })

  it('serializes multiple pending Runs for one Project + Provider', () => {
    const plan = planCodexDispatch(
      [review(), review({ id: 'run-codex-2' as never })],
      'C:\\project',
      [{ sessionId: 'session-one', busy: false }],
      states([
        ['run-codex-1', { status: 'assigned' }],
        ['run-codex-2', { status: 'assigned' }],
      ]),
    )
    expect(plan).toHaveLength(1)
    expect(plan[0]?.runId).toBe('run-codex-1')
    expect(plan[0]?.sessionId).toBe('session-one')
  })

})
