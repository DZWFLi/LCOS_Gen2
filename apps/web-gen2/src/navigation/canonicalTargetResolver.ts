// Sprint 3（T2）：canonical target resolver（React-free）。
//
// 只接 typed canonical ID（T2 §5）；不解析 Figma action 字符串，不保存第二份
// target truth。Conversation 入口必须给 exact `ConnectedConversation.id`；
// content_pending + projection ready 可 identity-only open/Locate；
// projection failed 禁止 (0,0) 或任何 camera/selection 写入。

import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';

export type CanonicalNavigationTargetV1 =
  | { readonly kind: 'conversation'; readonly connectedConversationId: string }
  | { readonly kind: 'artifactView'; readonly viewId: string }
  | { readonly kind: 'artifact'; readonly artifactId: string }
  | { readonly kind: 'workView'; readonly connectedConversationId: string }
  | { readonly kind: 'assembly'; readonly targetRef: AssemblyTargetRefV1 };

export type CanonicalTargetResolveStatusV1 =
  | 'resolved'
  | 'not_found'
  | 'destination_unavailable'
  | 'not_projected'
  | 'cancelled'
  | 'partial';

export type CanonicalTargetResolveOutcomeV1 =
  | { readonly status: 'resolved'; readonly target: CanonicalNavigationTargetV1 }
  | { readonly status: 'not_found' }
  | { readonly status: 'destination_unavailable' }
  | { readonly status: 'not_projected' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'partial' };

export interface ConversationTargetInputV1 {
  readonly currentProjectId: string;
  readonly connectedConversationId: string;
  readonly projectionState: 'ready' | 'pending' | 'failed';
  /** 目标项目与当前不一致时是否显式跨项目 open（默认拒绝）。 */
  readonly allowCrossProject?: boolean;
}

/** 只接受 exact ConnectedConversation.id；Session/Artifact/View ID 冒充即拒绝。 */
export function resolveCanonicalConversationTargetV1(
  input: ConversationTargetInputV1,
  targetProjectId: string,
): CanonicalTargetResolveOutcomeV1 {
  if (input.connectedConversationId.length === 0) return { status: 'not_found' };
  if (targetProjectId !== input.currentProjectId && input.allowCrossProject !== true) {
    return { status: 'destination_unavailable' }; // 跨项目不自动 open
  }
  if (input.projectionState === 'failed') {
    return { status: 'not_projected' }; // 零 camera/selection 写入，不回落 (0,0)
  }
  return { status: 'resolved', target: { kind: 'conversation', connectedConversationId: input.connectedConversationId } };
}

export function resolveCanonicalWorkViewTargetV1(
  input: ConversationTargetInputV1,
  targetProjectId: string,
): CanonicalTargetResolveOutcomeV1 {
  if (input.connectedConversationId.length === 0) return { status: 'not_found' };
  if (targetProjectId !== input.currentProjectId && input.allowCrossProject !== true) {
    return { status: 'destination_unavailable' };
  }
  // identity-only Work View 可打开（T2 §5 step 5）；failed 只禁 Locate，不禁止打开 Work View。
  return { status: 'resolved', target: { kind: 'workView', connectedConversationId: input.connectedConversationId } };
}

/** 通用 artifactView / artifact target 解析（canonical ref 直通，投影未就绪则 not_projected）。 */
export function resolveCanonicalViewTargetV1(
  input: { readonly currentProjectId: string; readonly viewId: string; readonly projectionState: 'ready' | 'pending' | 'failed' },
  targetProjectId: string,
): CanonicalTargetResolveOutcomeV1 {
  if (input.viewId.length === 0) return { status: 'not_found' };
  if (targetProjectId !== input.currentProjectId) return { status: 'destination_unavailable' };
  if (input.projectionState === 'failed') return { status: 'not_projected' };
  return { status: 'resolved', target: { kind: 'artifactView', viewId: input.viewId } };
}
