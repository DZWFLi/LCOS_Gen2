/**
 * SessionLifecycle V1 — G3 Session 七态 taxonomy（20260827 草案，UX_RUNTIME_TRUTH_MAP 缺口收口）。
 *
 * 历史缺口（Truth Map G3）：早期前端只派生 freshness/stale 标志，缺少生命周期模型；runtime_bindings 表虽有 provider_status 字段，但当时会话生命周期态尚未形成 canonical contract。该历史前端派生标志已退役，禁止重新作为 Controller/Lifecycle truth。
 *
 * 七态 = 主轨六态 + stale 旁路：
 * - 主轨：dormant → connecting → online ⇄ busy / waiting_input；任意活跃态可掉线
 *   disconnected，可 recover 回 connecting。
 * - stale 是第七态但语义是 freshness 旁路（「读过的 revision 被别人改了 / active context
 *   version 前进」）——它与其他主轨态**不互斥**（一个 online 会话的内容同样会 stale）。
 *   为满足七态单字段呈现（Truth Map 提法），SessionPhase 收 stale 为合法值，进入时
 *   staleFrom 记住主轨前态，恢复时回前态（不丢主轨信息）。
 *
 * 与 runs 表状态机（CHECK 约束：created/queued/running/waiting_input/completed/failed/
 * canceled）的关系：run 终态 ≠ 会话终态——completed/failed/canceled 的 run 把会话送回
 * online（空闲可接单），会话本身继续存在。run.waiting_input 事件 / answerInput 转回
 * busy 的链路在 runtime-application-service 已实测存在（emit 'run.waiting_input' /
 * answerInput 后 emit 'run.queued'）。
 *
 * 纯类型 + 纯函数零依赖；持久化与 provider adapter 属实现层（0.2 Phase 5 落地）。
 */

/** 主轨六态 + stale 旁路 = 七态。 */
export type SessionPhase =
  | 'dormant'
  | 'connecting'
  | 'online'
  | 'busy'
  | 'waiting_input'
  | 'disconnected'
  | 'stale'

/** stale 之外的主轨态（stale 进入/退出的合法前后态集合）。 */
export type SessionTrackPhase = Exclude<SessionPhase, 'stale'>

/** 会话观测快照：phase 单字段呈现七态；stale 时 staleFrom 保留主轨。 */
export interface SessionLifecycleStateV1 {
  readonly phase: SessionPhase
  /** phase === 'stale' 时必填：被 stale 打断的主轨前态，恢复目标。 */
  readonly staleFrom?: SessionTrackPhase
  /** 最近一次 phase 变化的归因事件（run.id / bridge 掉线 / revision 被改…）。 */
  readonly lastTransitionReason?: string
  readonly updatedAt: string
}

/**
 * 合法转移表（会话级）。非法转移 = bug 不是特色（三红线纪律）。
 * - stale 双向对全部主轨态开放（旁路语义），由 markStale/markFresh 表达，不进本表；
 * - disconnected 可从任何活跃态进入（桥掉线是被动事件）；
 * - dormant 是初始态；显式关闭（online/disconnected → dormant）合法，但执行中
 *   （busy/waiting_input/connecting）不得静默回 dormant——活跃执行必须先落地或断开。
 */
export const SESSION_PHASE_TRANSITIONS: Readonly<Record<SessionTrackPhase, readonly SessionTrackPhase[]>> = {
  dormant: ['connecting'],
  connecting: ['online', 'disconnected'],
  online: ['busy', 'disconnected', 'dormant'],
  busy: ['online', 'waiting_input', 'disconnected'],
  waiting_input: ['busy', 'online', 'disconnected'],
  disconnected: ['connecting', 'dormant'],
}

/** 判定主轨转移是否合法（纯函数）。 */
export function isSessionTransitionAllowed(from: SessionTrackPhase, to: SessionTrackPhase): boolean {
  return SESSION_PHASE_TRANSITIONS[from].includes(to)
}

/**
 * runs 表状态 → 会话主轨态投影（run 状态是会话 busy/waiting 的驱动源）。
 * created/queued 映射 connecting（dispatch 链在途）；终态映射 online（会话不死）。
 */
export const RUN_STATUS_TO_SESSION_PHASE: Readonly<Record<string, SessionTrackPhase>> = {
  created: 'connecting',
  queued: 'connecting',
  running: 'busy',
  waiting_input: 'waiting_input',
  completed: 'online',
  failed: 'online',
  canceled: 'online',
}

/** 进入 stale（freshness 旁路）：保留主轨前态。 */
export function markSessionStale(state: SessionLifecycleStateV1, reason: string, now: string): SessionLifecycleStateV1 {
  const track: SessionTrackPhase = state.phase === 'stale' ? (state.staleFrom ?? 'online') : state.phase
  return { phase: 'stale', staleFrom: track, lastTransitionReason: reason, updatedAt: now }
}

/** 退出 stale：回主轨前态（无前态记录则回 online——被动恢复的诚实兜底）。 */
export function markSessionFresh(state: SessionLifecycleStateV1, reason: string, now: string): SessionLifecycleStateV1 {
  if (state.phase !== 'stale') return { ...state, lastTransitionReason: reason, updatedAt: now }
  return { phase: state.staleFrom ?? 'online', lastTransitionReason: reason, updatedAt: now }
}
