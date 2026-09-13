// Sprint P0-04（T5/T6）：Capture Inbox view state mapper —— Figma capture 态子集 → 单一 view state。
// 只按 T6 投影 + 本地 apply 态推导；partial/unknown/retry_failed 等无投影事实时不产出（诚实）。
// permission_required / preview / target_uncertain 等本 Sprint 不产出。

import type { CaptureOperationProjectionV1 } from '@local-creative-os/contracts';

export type CaptureInboxViewStateV1 =
  | 'empty'
  | 'staged'
  | 'resolved'
  | 'receiving'
  | 'applied'
  | 'error'
  | 'loading';

export interface CaptureInboxViewInputV1 {
  readonly operations: readonly CaptureOperationProjectionV1[] | null;
  readonly applying: boolean;
  readonly appliedThisSession: boolean;
  readonly readError: boolean;
}

export function captureInboxViewStateV1(input: CaptureInboxViewInputV1): CaptureInboxViewStateV1 {
  if (input.readError) return 'error';
  if (input.operations === null) return 'loading';
  if (input.applying) return 'receiving';
  if (input.appliedThisSession) return 'applied';
  if (input.operations.length === 0) return 'empty';
  if (input.operations.some((op) => op.outcome === 'unconfirmed')) return 'staged';
  return 'resolved';
}

export function captureOperationActionLabelV1(action: 'apply' | 'reconcile' | 'locate'): string {
  switch (action) {
    case 'apply': return '应用到本项目';
    case 'locate': return '定位';
    case 'reconcile': return '核对';
  }
}
