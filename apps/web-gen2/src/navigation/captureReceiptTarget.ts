// Sprint 3（T2）：Capture receipt → canonical navigation target（React-free）。
//
// 顺序（T2 §5）：memberViewId > viewId > artifactId；只有 resourceId/stagingId/
// destinationLabel 时不造 Canvas target（打开 T4 容器或返回 unavailable）。
// 点击时必须按 operationId 重读最新 receipt，不信 body 首次渲染快照。

import type { CanonicalNavigationTargetV1 } from './canonicalTargetResolver.js';

export type CaptureReceiptTargetResultV1 =
  | { readonly status: 'resolved'; readonly target: CanonicalNavigationTargetV1 }
  | { readonly status: 'unavailable' };

export interface CaptureReceiptTargetInputV1 {
  readonly receipt: {
    readonly memberViewId?: string;
    readonly viewId?: string;
    readonly artifactId?: string;
    readonly resourceId?: string;
    readonly stagingId?: string;
    readonly destinationLabel?: string;
  };
  /** 同一批 apply 的逐项结果（优先 memberViewId）。 */
  readonly applyItem?: { readonly memberViewId?: string };
}

export function targetFromCaptureReceiptV1(input: CaptureReceiptTargetInputV1): CaptureReceiptTargetResultV1 {
  const memberViewId = input.applyItem?.memberViewId ?? input.receipt.memberViewId;
  if (memberViewId) return { status: 'resolved', target: { kind: 'artifactView', viewId: memberViewId } };
  if (input.receipt.viewId) return { status: 'resolved', target: { kind: 'artifactView', viewId: input.receipt.viewId } };
  if (input.receipt.artifactId) return { status: 'resolved', target: { kind: 'artifact', artifactId: input.receipt.artifactId } };
  // resource/staging/label 不可定位 Canvas occurrence → 不造 target
  return { status: 'unavailable' };
}
