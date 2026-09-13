// Sprint 3（T3）：Action Arc 的 continuation action 描述（React-free）。
//
// 规则（T3 §1）：禁止按按钮文案或统一 `action:recover` 分支；每个 canonical
// allowedAction 只映射一个具名 local intent。label 仅展示，绝不用于推断业务动作。

import type { ContinuationActionV1 } from '@local-creative-os/contracts';

import type { ContinuationLocalIntentKindV1 } from './continuationIntent.js';

export interface ContinuationActionDescriptorV1 {
  readonly action: ContinuationActionV1;
  /** 唯一具名 local intent（recover_external/recover_bind 同属 binding recovery 类）。 */
  readonly intentKind: ContinuationLocalIntentKindV1;
  /** 仅展示文案；dispatch 一律按 action/intentKind。 */
  readonly label: string;
}

export const CONTINUATION_ACTION_DESCRIPTORS: Readonly<Record<ContinuationActionV1, ContinuationActionDescriptorV1>> = {
  recover_external: { action: 'recover_external', intentKind: 'binding_recovery_requested', label: '恢复续工' },
  recover_bind: { action: 'recover_bind', intentKind: 'binding_recovery_requested', label: '恢复绑定' },
  retry_attach: { action: 'retry_attach', intentKind: 'attach_retry_requested', label: '重试 Attach' },
  retry_projection: { action: 'retry_projection', intentKind: 'projection_retry_requested', label: '重试投影' },
  reconcile: { action: 'reconcile', intentKind: 'unknown_reconcile_requested', label: '核对未知结果' },
  cancel_request: { action: 'cancel_request', intentKind: 'cancel_continuation_requested', label: '取消续工' },
};

export function describeContinuationActionV1(action: ContinuationActionV1): ContinuationActionDescriptorV1 {
  return CONTINUATION_ACTION_DESCRIPTORS[action];
}

export function intentKindForContinuationActionV1(action: ContinuationActionV1): ContinuationLocalIntentKindV1 {
  return CONTINUATION_ACTION_DESCRIPTORS[action].intentKind;
}

/** 每个 allowedAction 必须能落到唯一 intent；未知 action 直接抛错，禁止通吃。 */
export function assertKnownContinuationActionsV1(actions: readonly ContinuationActionV1[]): void {
  for (const action of actions) {
    describeContinuationActionV1(action);
  }
}
