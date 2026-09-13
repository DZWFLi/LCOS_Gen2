// Sprint 4（T5）：Figma 状态名 → typed production state 映射（React-free）。
//
// 来源：docs/handoffs/T7_Figma_20260911/组件状态与完整文案.md（2026-09-11 快照）。
// 规则（T5 V4 / T7 §12.3）：状态名只供施工映射，不直接作为 UI 文案或生产枚举；
// Figma 状态不是 153 个业务状态，也不替代 capability probe / receipt / allowedActions。

/** Figma 16 组入口的分组键（来自 T7_Figma 交付）。 */
export type FigmaEntryGroupV1 =
  | 'current_receiver'
  | 'available_actions'
  | 'shared_input'
  | 'assembly_inbox'
  | 'connector_source'
  | 'browser_capture'
  | 'permission_request'
  | 'waiting_input'
  | 'recovery_section'
  | 'runtime_doctor'
  | 'tray'
  | 'companion'
  | 'quick_capture'
  | 'current_app_capture'
  | 'desktop_notification'
  | 'connector_detail';

/** 每个 Figma group 的可见状态名（来自文案快照；只作映射输入）。 */
export const FIGMA_ENTRY_GROUP_STATES: Readonly<Record<FigmaEntryGroupV1, readonly string[]>> = {
  current_receiver: ['ready', 'loading', 'empty', 'offline', 'reconnecting', 'unsupported', 'handoff_pending', 'error', 'list', 'chooser', 'handoff'],
  available_actions: ['available', 'loading', 'disabled', 'offline', 'permission_required', 'unsupported', 'degraded', 'error'],
  shared_input: ['empty', 'editing', 'resolving', 'sending', 'ready', 'blocked', 'offline', 'permission_required', 'degraded', 'unknown', 'error', 'reconciling', 'keyboard_focus'],
  assembly_inbox: ['empty', 'receiving', 'previewing', 'staged'],
  connector_source: ['empty', 'scanning', 'selecting', 'importing', 'applied', 'partial', 'error'],
  browser_capture: ['idle', 'paired', 'token_rejected', 'capturing', 'staged', 'reused', 'core_offline', 'parser_fallback', 'outcome_unknown'],
  permission_request: ['pending', 'allowed', 'denied', 'expired', 'error'],
  waiting_input: ['waiting', 'answering', 'answered', 'stale', 'failed'],
  recovery_section: ['idle', 'recovering', 'recover_bind', 'retry_attach', 'retry_projection', 'reconcile', 'outcome_unknown', 'cancelled', 'resolved'],
  runtime_doctor: ['healthy', 'degraded', 'error', 'offline'],
  tray: ['idle', 'working', 'needs_attention'],
  companion: ['idle', 'work_view_open', 'pending'],
  quick_capture: ['idle', 'capturing', 'receiving', 'applied', 'unknown'],
  current_app_capture: ['idle', 'capturing', 'previewing', 'applied', 'excluded', 'error'],
  desktop_notification: ['pending', 'resolved', 'target_missing', 'stale'],
  connector_detail: ['connected', 'reauthorize', 'offline', 'disabled'],
};

/** T5 生产状态词（跨组收敛，不逐 variant 建状态）。 */
export type T5PresentationStatusV1 =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'working'
  | 'waiting_input'
  | 'pending'
  | 'staged'
  | 'applied'
  | 'reused'
  | 'partial'
  | 'recovering'
  | 'outcome_unknown'
  | 'unavailable'
  | 'failed'
  | 'cancelled'
  | 'completed';

/** Figma 状态 → T5 生产状态（诚实映射；未知状态不猜，落到 unavailable）。 */
const FIGMA_TO_T5_STATUS: Readonly<Record<string, T5PresentationStatusV1>> = {
  idle: 'idle',
  working: 'working',
  failed: 'failed',
  ready: 'ready',
  loading: 'loading',
  empty: 'idle',
  offline: 'unavailable',
  reconnecting: 'recovering',
  unsupported: 'unavailable',
  handoff_pending: 'pending',
  handoff: 'completed',
  error: 'failed',
  list: 'ready',
  chooser: 'ready',
  available: 'ready',
  disabled: 'unavailable',
  permission_required: 'waiting_input',
  degraded: 'partial',
  unknown: 'outcome_unknown',
  sending: 'working',
  resolving: 'loading',
  editing: 'working',
  keyboard_focus: 'ready',
  blocked: 'waiting_input',
  reconciling: 'recovering',
  receiving: 'working',
  previewing: 'pending',
  staged: 'staged',
  scanning: 'loading',
  selecting: 'ready',
  importing: 'working',
  applied: 'applied',
  partial: 'partial',
  paired: 'ready',
  token_rejected: 'failed',
  capturing: 'working',
  reused: 'reused',
  core_offline: 'unavailable',
  parser_fallback: 'partial',
  outcome_unknown: 'outcome_unknown',
  pending: 'pending',
  allowed: 'completed',
  denied: 'cancelled',
  expired: 'failed',
  waiting: 'waiting_input',
  answering: 'working',
  answered: 'completed',
  stale: 'failed',
  recovering: 'recovering',
  recover_bind: 'recovering',
  retry_attach: 'recovering',
  retry_projection: 'recovering',
  reconcile: 'outcome_unknown',
  cancelled: 'cancelled',
  resolved: 'completed',
  healthy: 'ready',
  needs_attention: 'partial',
  work_view_open: 'ready',
  excluded: 'cancelled',
  target_missing: 'failed',
  connected: 'ready',
  reauthorize: 'waiting_input',
};

export function mapFigmaStateToT5StatusV1(figmaState: string): T5PresentationStatusV1 {
  return FIGMA_TO_T5_STATUS[figmaState] ?? 'unavailable';
}

/** 校验：文案快照里每个状态都能映射（未知状态提前暴露，不静默 unavailable）。 */
export function assertAllFigmaStatesMappedV1(): readonly { group: FigmaEntryGroupV1; state: string }[] {
  const unmapped: { group: FigmaEntryGroupV1; state: string }[] = [];
  for (const [group, states] of Object.entries(FIGMA_ENTRY_GROUP_STATES) as [FigmaEntryGroupV1, readonly string[]][]) {
    for (const state of states) {
      if (FIGMA_TO_T5_STATUS[state] === undefined) unmapped.push({ group, state });
    }
  }
  return unmapped;
}
