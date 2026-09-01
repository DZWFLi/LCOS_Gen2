import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { ContextManifestService } from '../src/context-manifest-service.js'
import { SqliteMetadataRepository } from '../src/metadata-repository.js'
import { ProjectEventHub } from '../src/project-events/project-event-hub.js'
import { SessionLifecycleService } from '../src/session-lifecycle-service.js'
import type { ProjectEventEnvelope } from '@local-creative-os/contracts'

const roots: string[] = []
const repositories: SqliteMetadataRepository[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) repository.close()
  for (const root of roots.splice(0)) void Promise.resolve().then(() => { try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ } })
})

interface Fixture {
  readonly repository: SqliteMetadataRepository
  readonly hub: ProjectEventHub
  readonly service: SessionLifecycleService
  readonly events: ProjectEventEnvelope[]
}

async function setup(projectId = 'sess-project'): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), 'lcos-session-lifecycle-'))
  roots.push(root)
  mkdirSync(join(root, 'project'), { recursive: true })
  const repository = new SqliteMetadataRepository(join(root, 'metadata.sqlite'))
  repositories.push(repository)
  repository.createProject({ id: projectId as never, name: 'SESS', rootPath: join(root, 'project') })
  const hub = new ProjectEventHub()
  const events: ProjectEventEnvelope[] = []
  hub.subscribe(projectId, (event) => events.push(event))
  return { repository, hub, service: new SessionLifecycleService(repository, hub), events }
}

/** 种一个 run（合法 manifest FK），返回 runId；status 可指定。 */
async function seedRun(fixture: Fixture, projectId: string, status: string, provider: 'workbuddy' | 'codex' = 'workbuddy'): Promise<string> {
  const manifests = new ContextManifestService(fixture.repository)
  const manifest = await manifests.build(projectId as never)
  const runId = `run-seed-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  fixture.repository.createRunWithDispatch({
    id: runId as never,
    projectId: projectId as never,
    contextManifestId: manifest.id as never,
    provider,
    requestedProvider: provider,
    outputIntent: 'analyze',
    returnGroupId: `rg-${runId}`,
    status: 'created',
    instruction: 'seed',
    createdAt: now,
    updatedAt: now,
  } as never, {
    id: `dispatch-${runId}` as never,
    runId: runId as never,
    provider,
    idempotencyKey: runId,
    status: 'planned',
    attemptCount: 0,
    createdAt: now,
    updatedAt: now,
  } as never)
  if (status !== 'created') fixture.repository.updateRunStatus(runId as never, status as never, now)
  return runId
}

describe('SessionLifecycleService（Phase 5 · 七态驱动）', () => {
  it('首 run created：dormant→connecting 持久化并发布 session.phase 事件', async () => {
    const fixture = await setup()
    const state = fixture.service.observeRunStatus('sess-project', 'workbuddy', 'created', 'run a → created')
    expect(state.phase).toBe('connecting')
    expect(fixture.service.getState('sess-project', 'workbuddy')?.phase).toBe('connecting')
    const phaseEvents = fixture.events.filter((event) => (event.payload as { kind?: string }).kind === 'session.phase')
    expect(phaseEvents).toHaveLength(1)
    expect((phaseEvents[0].payload as { phase?: string }).phase).toBe('connecting')
  })

  it('run 状态投影主轨：created→connecting、running→busy、waiting_input、completed→online', async () => {
    const fixture = await setup()
    expect(fixture.service.observeRunStatus('sess-project', 'workbuddy', 'created', 'r1').phase).toBe('connecting')
    expect(fixture.service.observeRunStatus('sess-project', 'workbuddy', 'running', 'r1').phase).toBe('busy')
    expect(fixture.service.observeRunStatus('sess-project', 'workbuddy', 'waiting_input', 'r1').phase).toBe('waiting_input')
    expect(fixture.service.observeRunStatus('sess-project', 'workbuddy', 'completed', 'r1').phase).toBe('online')
  })

  it('多 run 钳制：还有活跃 run 时终态不回 online（停在 busy）', async () => {
    const fixture = await setup()
    await seedRun(fixture, 'sess-project', 'running')
    fixture.service.observeRunStatus('sess-project', 'workbuddy', 'running', 'r1')
    const state = fixture.service.observeRunStatus('sess-project', 'workbuddy', 'completed', 'r2 done')
    expect(state.phase).toBe('busy')
  })

  it('已建立连接的会话收到新 run created 不回 connecting（停在 busy：工作在途）', async () => {
    const fixture = await setup()
    fixture.service.observeRunStatus('sess-project', 'workbuddy', 'running', 'r1')
    const state = fixture.service.observeRunStatus('sess-project', 'workbuddy', 'created', 'r2 created')
    expect(state.phase).toBe('busy')
  })

  it('桥掉线 disconnected / recover→connecting / 再观察 running→busy（复合路径）', async () => {
    const fixture = await setup()
    fixture.service.observeRunStatus('sess-project', 'workbuddy', 'running', 'r1')
    const down = fixture.service.markDisconnected('sess-project', 'workbuddy', 'bridge error: ECONNREFUSED')
    expect(down.phase).toBe('disconnected')
    const recovered = fixture.service.recover('sess-project', 'workbuddy', 'manual recover')
    expect(recovered.phase).toBe('connecting')
    const again = fixture.service.observeRunStatus('sess-project', 'workbuddy', 'running', 'r1 heartbeat')
    expect(again.phase).toBe('busy')
  })

  it('stale 旁路：进入保留主轨；run 事件推进主轨但 stale 保持；markFresh 回主轨', async () => {
    const fixture = await setup()
    fixture.service.observeRunStatus('sess-project', 'workbuddy', 'running', 'r1')
    const stale = fixture.service.markStale('sess-project', 'workbuddy', 'revision changed by others')
    expect(stale.phase).toBe('stale')
    expect(stale.staleFrom).toBe('busy')
    const stillStale = fixture.service.observeRunStatus('sess-project', 'workbuddy', 'waiting_input', 'r1 waiting')
    expect(stillStale.phase).toBe('stale')
    expect(stillStale.staleFrom).toBe('waiting_input')
    const fresh = fixture.service.markFresh('sess-project', 'workbuddy', 're-read')
    expect(fresh.phase).toBe('waiting_input')
  })

  it('dormant 会话 markDisconnected 是幂等空操作（没连接过就没有掉线）', async () => {
    const fixture = await setup()
    const state = fixture.service.markDisconnected('sess-project', 'workbuddy', 'bridge down')
    expect(state.phase).toBe('dormant')
    expect(fixture.service.getState('sess-project', 'workbuddy')).toBeUndefined()
  })

  it('两个 provider 各自独立成行（互不串扰）', async () => {
    const fixture = await setup()
    fixture.service.observeRunStatus('sess-project', 'workbuddy', 'running', 'w1')
    fixture.service.observeRunStatus('sess-project', 'codex', 'created', 'c1')
    expect(fixture.service.getState('sess-project', 'workbuddy')?.phase).toBe('busy')
    expect(fixture.service.getState('sess-project', 'codex')?.phase).toBe('connecting')
  })
})
