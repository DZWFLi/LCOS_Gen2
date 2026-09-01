/**
 * Session 生命周期运行时（Phase 5 Live Session Binding，20260827 落地）。
 *
 * taxonomy 见 contracts/session-lifecycle.ts（七态 + 合法转移表）；本服务负责三件事：
 * 1. 持久化：session_lifecycle_states 表（project × provider 一行；无行 = dormant 语义）
 * 2. run 状态驱动 phase：observeRunStatus 用 RUN_STATUS_TO_SESSION_PHASE 投影，
 *    多 run 并发感知（终态回 online 前先查是否还有活跃 run；已建立连接的会话
 *    收到 created/queued 不回 connecting 而是停在 busy——工作在途）
 * 3. 旁路与恢复：markDisconnected（桥掉线）/ recover（disconnected→connecting）/
 *    markStale / markFresh（freshness 旁路，保留主轨）
 *
 * 每次实际变化 publish continuity.changed {kind:'session.phase'}（GUI 经既有
 * continuity 通道即可刷新，不新增订阅面）。
 * 非法转移不抛错：事件流可能乱序/丢，契约纪律由转移表测试侧保证；运行时只记 reason。
 */

import {
  markSessionFresh,
  markSessionStale,
  RUN_STATUS_TO_SESSION_PHASE,
  type SessionLifecycleStateV1,
  type SessionTrackPhase,
} from '@local-creative-os/contracts'

import type { SqliteMetadataRepository } from './metadata-repository.js'
import type { ProjectEventHub } from './project-events/project-event-hub.js'

export interface SessionLifecycleRowV1 {
  readonly projectId: string
  readonly provider: string
  readonly phase: string
  readonly staleFrom?: string
  readonly lastTransitionReason?: string
  readonly updatedAt: string
}

const TRACK_PHASES: readonly SessionTrackPhase[] = ['dormant', 'connecting', 'online', 'busy', 'waiting_input', 'disconnected']

function isTrackPhase(value: string): value is SessionTrackPhase {
  return (TRACK_PHASES as readonly string[]).includes(value)
}

/** 主轨图上求 current→target 的最短合法路径（BFS，图极小）。返回 null = 不可达。 */
function resolveTrackPath(current: SessionTrackPhase, target: SessionTrackPhase): readonly SessionTrackPhase[] | null {
  if (current === target) return []
  const queue: Array<{ readonly phase: SessionTrackPhase; readonly path: readonly SessionTrackPhase[] }> = [{ phase: current, path: [] }]
  const visited = new Set<SessionTrackPhase>([current])
  while (queue.length > 0) {
    const node = queue.shift()!
    for (const next of transitionsFrom(node.phase)) {
      if (visited.has(next)) continue
      const path = [...node.path, next]
      if (next === target) return path
      visited.add(next)
      queue.push({ phase: next, path })
    }
  }
  return null
}

const ADJACENCY: Readonly<Record<SessionTrackPhase, readonly SessionTrackPhase[]>> = {
  dormant: ['connecting'],
  connecting: ['online', 'disconnected'],
  online: ['busy', 'disconnected', 'dormant'],
  busy: ['online', 'waiting_input', 'disconnected'],
  waiting_input: ['busy', 'online', 'disconnected'],
  disconnected: ['connecting', 'dormant'],
}

function transitionsFrom(phase: SessionTrackPhase): readonly SessionTrackPhase[] {
  return ADJACENCY[phase]
}

export class SessionLifecycleService {
  constructor(
    private readonly metadata: SqliteMetadataRepository,
    private readonly events: ProjectEventHub,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** 无持久化行 = 尚无会话记录（dormant 语义）；调用方自行合成默认展示。 */
  getState(projectId: string, provider: string): SessionLifecycleStateV1 | undefined {
    const row = this.metadata.getSessionLifecycleState(projectId, provider)
    if (row === undefined) return undefined
    // stale 是合法持久化值（第七态）；主轨值按白名单校验，坏值兜底 online。
    const phase: SessionLifecycleStateV1['phase'] = row.phase === 'stale' ? 'stale' : (isTrackPhase(row.phase) ? row.phase : 'online')
    return {
      phase,
      ...(row.staleFrom === undefined || !isTrackPhase(row.staleFrom) ? {} : { staleFrom: row.staleFrom }),
      ...(row.lastTransitionReason === undefined ? {} : { lastTransitionReason: row.lastTransitionReason }),
      updatedAt: row.updatedAt,
    }
  }

  listProjectStates(projectId: string): readonly SessionLifecycleRowV1[] {
    return this.metadata.listSessionLifecycleStates(projectId)
  }

  /**
   * run 状态驱动 phase（providerAction 成功路径 + create 后调用）。
   * 多 run 感知：target=online 但项目仍有活跃 run → 停在 busy；
   * 会话已建立（online/busy/waiting_input）时收到 created/queued → busy（工作在途，连接已证明）。
   */
  observeRunStatus(projectId: string, provider: string, runStatus: string, reason: string): SessionLifecycleStateV1 {
    const projected = RUN_STATUS_TO_SESSION_PHASE[runStatus]
    if (projected === undefined) return this.currentOrDormant(projectId, provider)
    const current = this.getState(projectId, provider) ?? { phase: 'dormant', updatedAt: this.now() }
    const track: SessionTrackPhase = current.phase === 'stale' ? (current.staleFrom ?? 'online') : current.phase
    let target = projected
    if (target === 'online' && this.metadata.countActiveRuns(projectId) > 0) target = 'busy'
    if ((target === 'connecting') && (track === 'online' || track === 'busy' || track === 'waiting_input')) target = 'busy'
    // 同态（path=[]）也走 persist：reason/updatedAt 更新落库，phase 未变不发事件。
    const path = resolveTrackPath(track, target)
    if (path === null) {
      // 不可达（理论不可能）：保现状记 reason，不硬造非法转移。
      return this.persist(projectId, provider, { ...current, lastTransitionReason: `unreachable:${track}->${target}:${reason}`, updatedAt: this.now() }, current.phase)
    }
    let state: SessionLifecycleStateV1 = { ...current, phase: track, updatedAt: this.now() }
    for (const step of path) state = { phase: step, ...(state.staleFrom === undefined ? {} : { staleFrom: state.staleFrom }), lastTransitionReason: reason, updatedAt: this.now() }
    // stale 旁路保持：主轨推进后仍 stale（run 事件不清 freshness 债）。
    if (current.phase === 'stale') state = { ...state, phase: 'stale', staleFrom: target }
    return this.persist(projectId, provider, state, current.phase)
  }

  /** 桥掉线：任何活跃主轨态 → disconnected（stale 时直接落 disconnected，freshness 债记进 reason）。 */
  markDisconnected(projectId: string, provider: string, reason: string): SessionLifecycleStateV1 {
    const current = this.getState(projectId, provider) ?? { phase: 'dormant', updatedAt: this.now() }
    if (current.phase === 'dormant') return current
    if (current.phase === 'disconnected') return current
    const note = current.phase === 'stale' ? `${reason}（stale 于 ${current.staleFrom ?? 'online'}）` : reason
    return this.persist(projectId, provider, { phase: 'disconnected', lastTransitionReason: note, updatedAt: this.now() }, current.phase)
  }

  /** 恢复：disconnected → connecting（单步诚实转移；online 由后续 run 事件证明后再进）。 */
  recover(projectId: string, provider: string, reason: string): SessionLifecycleStateV1 {
    const current = this.getState(projectId, provider) ?? { phase: 'dormant', updatedAt: this.now() }
    if (current.phase !== 'disconnected') return current
    return this.persist(projectId, provider, { phase: 'connecting', lastTransitionReason: reason, updatedAt: this.now() }, current.phase)
  }

  markStale(projectId: string, provider: string, reason: string): SessionLifecycleStateV1 {
    const current = this.getState(projectId, provider) ?? { phase: 'dormant', updatedAt: this.now() }
    return this.persist(projectId, provider, markSessionStale(current, reason, this.now()), current.phase)
  }

  markFresh(projectId: string, provider: string, reason: string): SessionLifecycleStateV1 {
    const current = this.getState(projectId, provider) ?? { phase: 'dormant', updatedAt: this.now() }
    if (current.phase !== 'stale') return current
    return this.persist(projectId, provider, markSessionFresh(current, reason, this.now()), current.phase)
  }

  private currentOrDormant(projectId: string, provider: string): SessionLifecycleStateV1 {
    return this.getState(projectId, provider) ?? { phase: 'dormant', updatedAt: this.now() }
  }

  private persist(projectId: string, provider: string, next: SessionLifecycleStateV1, previousPhase: string): SessionLifecycleStateV1 {
    this.metadata.saveSessionLifecycleState({
      projectId,
      provider,
      phase: next.phase,
      ...(next.staleFrom === undefined ? {} : { staleFrom: next.staleFrom }),
      ...(next.lastTransitionReason === undefined ? {} : { lastTransitionReason: next.lastTransitionReason }),
      updatedAt: next.updatedAt,
    })
    if (next.phase !== previousPhase) {
      this.events.publish(projectId, {
        channel: 'continuity',
        type: 'continuity.changed',
        entityRefs: [`session:${provider}`],
        payload: { kind: 'session.phase', provider, phase: next.phase, previousPhase, ...(next.staleFrom === undefined ? {} : { staleFrom: next.staleFrom }), ...(next.lastTransitionReason === undefined ? {} : { reason: next.lastTransitionReason }) },
      })
    }
    return next
  }
}
