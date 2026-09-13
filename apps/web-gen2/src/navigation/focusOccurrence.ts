// Sprint 3（T2）：Locate 的空间 focus 判定（React-free）。
//
// Locate 只消费 ProjectionBinding + live node（T2 §1/§5）；binding stale / node
// 已删 / projection failed → not_projected/partial，绝不回落 (0,0)。本函数是纯判定，
// 不写 camera/selection。

export type FocusOccurrenceStatusV1 = 'focused' | 'not_projected' | 'partial' | 'cancelled';

export type FocusOccurrenceOutcomeV1 =
  | { readonly status: 'focused'; readonly spatialId: string }
  | { readonly status: 'not_projected' }
  | { readonly status: 'partial' }
  | { readonly status: 'cancelled' };

export interface FocusOccurrenceInputV1 {
  readonly binding?: { readonly spatialId: string };
  /** live node 是否存在（inspect 结果；查不到不等于 terminated）。 */
  readonly liveNode: boolean;
  readonly projectionState: 'ready' | 'pending' | 'failed';
  readonly aborted?: boolean;
}

export function focusOccurrenceV1(input: FocusOccurrenceInputV1): FocusOccurrenceOutcomeV1 {
  if (input.aborted === true) return { status: 'cancelled' };
  if (!input.binding || input.projectionState === 'failed') return { status: 'not_projected' };
  if (!input.liveNode) return { status: 'partial' }; // binding 在但节点缺失：不猜位置
  return { status: 'focused', spatialId: input.binding.spatialId };
}
