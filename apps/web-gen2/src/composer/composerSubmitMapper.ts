// Sprint P0-03（T5）：Composer view state mapper —— 13 个 Figma variant → 单一 view state。
// 只按 T6 projection + body 本地提交态推导，不按文案/颜色/时间猜状态。
//
// permission_required / degraded：本 Sprint 不产出（T6 durable permission 为 EXTERNAL_GAP，
// receiver degradation 未接线），保留枚举但绝不静默冒充。

import type { ComposerSubmitProjectionV1 } from '@local-creative-os/contracts';

export type ComposerViewStateV1 =
  | 'empty'
  | 'editing'
  | 'resolving'
  | 'sending'
  | 'ready'
  | 'blocked'
  | 'offline'
  | 'permission_required'
  | 'degraded'
  | 'unknown'
  | 'error'
  | 'reconciling'
  | 'keyboard_focus';

export type ComposerSubmitOutcomeV1 = 'none' | 'acknowledged' | 'rejected' | 'unconfirmed';

export interface ComposerViewInputV1 {
  readonly projection: ComposerSubmitProjectionV1 | null;
  readonly submitting: boolean;
  readonly outcome: ComposerSubmitOutcomeV1;
  readonly coreReachable: boolean;
  readonly resolving: boolean;
  readonly reconciling: boolean;
  readonly keyboardFocused: boolean;
}

export function composerViewStateV1(input: ComposerViewInputV1): ComposerViewStateV1 {
  if (!input.coreReachable) return 'offline';
  if (input.submitting) return 'sending';
  if (input.resolving) return 'resolving';
  if (input.outcome === 'unconfirmed') return input.reconciling ? 'reconciling' : 'unknown';
  if (input.outcome === 'rejected') return 'error';
  if (input.outcome === 'acknowledged') return 'ready';
  if (input.projection === null) return 'empty';
  if (input.projection.receiverId === null) return 'blocked';
  if (input.keyboardFocused) return 'keyboard_focus';
  return 'editing';
}

export const COMPOSER_VIEW_STATES_V1: readonly ComposerViewStateV1[] = [
  'empty', 'editing', 'resolving', 'sending', 'ready', 'blocked', 'offline',
  'permission_required', 'degraded', 'unknown', 'error', 'reconciling', 'keyboard_focus',
];
