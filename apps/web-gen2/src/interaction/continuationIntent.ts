// Sprint 3（T3）：续工相关的 typed local intents（React-free）。
//
// T3 只产出「用户操作 → 具名 local intent」；不直接调 provider，不写 T6 truth。
// 每个在途交互至少绑定 targetConversationRef + operationId + snapshotId
// （T3 §4），用于 stale receipt / target 切换的丢弃判定。

/** 每个在途交互的身份绑定（不是 canonical target truth）。 */
export interface ContinuationIntentBindingV1 {
  readonly targetConversationRef?: string;
  readonly operationId?: string;
  readonly snapshotId?: string;
}

/** T3 local intent 集合（T3 §2 差量表逐条落地）。 */
export type ContinuationLocalIntentV1 =
  | { readonly kind: 'continue_submission_requested'; readonly binding: ContinuationIntentBindingV1 }
  | { readonly kind: 'permission_allow_requested'; readonly binding: ContinuationIntentBindingV1; readonly requestId: string; readonly revision: number }
  | { readonly kind: 'permission_deny_requested'; readonly binding: ContinuationIntentBindingV1; readonly requestId: string; readonly revision: number }
  | { readonly kind: 'permission_refresh_requested'; readonly binding: ContinuationIntentBindingV1 }
  | { readonly kind: 'input_answer_submitted'; readonly binding: ContinuationIntentBindingV1; readonly runId: string; readonly requestId: string; readonly answer: string }
  | { readonly kind: 'binding_recovery_requested'; readonly binding: ContinuationIntentBindingV1 }
  | { readonly kind: 'attach_retry_requested'; readonly binding: ContinuationIntentBindingV1 }
  | { readonly kind: 'projection_retry_requested'; readonly binding: ContinuationIntentBindingV1 }
  | { readonly kind: 'unknown_reconcile_requested'; readonly binding: ContinuationIntentBindingV1 }
  | { readonly kind: 'work_view_open_requested'; readonly connectedConversationId: string }
  | { readonly kind: 'target_locate_requested'; readonly targetConversationRef: string }
  | { readonly kind: 'cancel_continuation_requested'; readonly binding: ContinuationIntentBindingV1 };

export type ContinuationLocalIntentKindV1 = ContinuationLocalIntentV1['kind'];

/** 具名 intent 工厂（把 owner 返回的 action + 在途绑定转成唯一 local intent）。 */
export function createContinuationLocalIntentV1(
  kind: ContinuationLocalIntentKindV1,
  binding: ContinuationIntentBindingV1,
): ContinuationLocalIntentV1 {
  return { kind, binding } as ContinuationLocalIntentV1;
}
