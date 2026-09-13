// T2 C2-3A · Locator transient state reducer (React-free, no persistence).
//
// 只做状态转移；不持 canonical target；不存几何真相。几何由
// locatorGeometry 每次重算喂入，本模块把 presentation state 在
// hidden/local/near-edge/edge/travelling/arriving/unavailable 之间转移。
//
// 语义（C2-3A §25）：
//   hidden      —— 无目标 / 未初始化
//   local       —— 目标在舒适内区（T5 可渲染目标本地 cue 或不渲染）
//   near-edge   —— 目标接近安全区边界（progress 连续驱动形态）
//   edge        —— 目标在安全区外（edgeAnchor 定向 cue）
//   travelling  —— 已发出显式 Locate/Focus camera 请求，camera 动画中
//   arriving    —— camera 已 settle，目标本地 Arrival 进行中
//   unavailable —— 目标 canonical 存在但当前无投影（不指向无处）

export type LocatorPhase =
  | 'hidden'
  | 'local'
  | 'near-edge'
  | 'edge'
  | 'travelling'
  | 'arriving'
  | 'unavailable';

export type LocatorAction =
  | { type: 'target-gone' }
  | { type: 'target-unavailable' }
  | { type: 'geometry'; phase: 'local' | 'near-edge' | 'edge' }
  | { type: 'locate-requested' }
  | { type: 'camera-settled' }
  | { type: 'arrival-done' }
  | { type: 'cancel' };

export interface LocatorState {
  phase: LocatorPhase;
}

export const initialLocatorState: LocatorState = { phase: 'hidden' };

/** 边 cue 阶段 → 几何重算只允许在非 travelling/arriving 时进入。 */
export function reduceLocatorState(state: LocatorState, action: LocatorAction): LocatorState {
  switch (action.type) {
    case 'target-gone':
      return { phase: 'hidden' };
    case 'target-unavailable':
      return { phase: 'unavailable' };
    case 'geometry':
      // travelling/arriving 期间几何仍在动（camera 动画中），但展示相位保持
      // travelling/arriving，直到 camera-settled / arrival-done。
      if (state.phase === 'travelling' || state.phase === 'arriving') return state;
      return { phase: action.phase };
    case 'locate-requested':
      // 同一代重复请求：travelling/arriving 中不重置（C2-3A §48 no duplicate queue）。
      if (state.phase === 'travelling' || state.phase === 'arriving') return state;
      return { phase: 'travelling' };
    case 'camera-settled':
      return state.phase === 'travelling' ? { phase: 'arriving' } : state;
    case 'arrival-done':
      return state.phase === 'arriving' ? { phase: 'hidden' } : state;
    case 'cancel':
      return { phase: 'hidden' };
  }
}
