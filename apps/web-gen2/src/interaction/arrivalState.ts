// T2 C2-3A · Arrival transient state reducer (React-free, no persistence).
//
// 与 locatorState 分开：navigation settled（目标画布激活，C2-1D）≠ camera
// arrived（spatial locate/focus 请求 settle，C2-3 §39）。本模块只管
// camera travel 之后的 target-local Arrival：
//   idle → travelling → arriving → settled → (lifetime end) idle
// 任何新一代请求 / project|canvas 切换 → cancel（C2-3 §38/§45/§46）。
//
// lifetime：600–900ms 类（C2-3 §37），精确值 T5_BACKFILL；reduced-motion 只
// 改视觉（outline/color settle），不改变语义状态转移。

export type ArrivalPhase = 'idle' | 'travelling' | 'arriving' | 'settled' | 'cancelled';

export type ArrivalAction =
  | { type: 'travel-start' }
  | { type: 'camera-settled' }
  | { type: 'arrival-complete' }
  | { type: 'cancel' };

export interface ArrivalState {
  phase: ArrivalPhase;
}

export const initialArrivalState: ArrivalState = { phase: 'idle' };

export function reduceArrivalState(state: ArrivalState, action: ArrivalAction): ArrivalState {
  switch (action.type) {
    case 'travel-start':
      return { phase: state.phase === 'travelling' ? state.phase : 'travelling' };
    case 'camera-settled':
      return state.phase === 'travelling' ? { phase: 'arriving' } : state;
    case 'arrival-complete':
      return state.phase === 'arriving' || state.phase === 'settled' ? { phase: 'idle' } : state;
    case 'cancel':
      return { phase: 'cancelled' };
  }
}
