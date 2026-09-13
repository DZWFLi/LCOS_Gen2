// Sprint 2B（T4）：Conversation Work View 只读 model（React-free）。
//
// Work View 是专业 region，不是 Conversation Canvas、第四 Worksite 或第二消息 truth。
// section 可 partial 返回：identity-only / content_pending 也可打开（T4 §7）。

import type {
  ConnectedConversationV1,
  ContinuationRecoveryProjectionV1,
  ConversationIdentityChainV1,
  ConversationReachResultV0,
  ConversationWorkViewRunV1,
} from '@local-creative-os/contracts';

export type ConversationWorkViewSectionKindV1 = 'identity' | 'reach' | 'timeline';

export type ConversationWorkViewSectionStatusV1 =
  | 'pending'
  | 'loaded'
  | 'unavailable'
  | 'error';

export interface ConversationWorkViewSectionStateV1 {
  readonly kind: ConversationWorkViewSectionKindV1;
  readonly status: ConversationWorkViewSectionStatusV1;
  readonly identity?: ConversationIdentityChainV1;
  readonly reach?: ConversationReachResultV0;
  readonly conversations?: readonly ConnectedConversationV1[];
  readonly errorCode?: string;
}

export interface ConversationWorkViewStateV1 {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly connectedConversationId: string;
  /** 目标身份（target 变化即丢弃旧 section，禁止混入新 Glyth）。 */
  readonly sections: Readonly<Record<ConversationWorkViewSectionKindV1, ConversationWorkViewSectionStateV1>>;
  /** 该会话关联 Run（attention section 数据源）。 */
  readonly runs: readonly ConversationWorkViewRunV1[];
  /** 该会话续工操作（recovery section 数据源）。 */
  readonly operations: readonly ContinuationRecoveryProjectionV1[];
  readonly revision: number;
}

export function createEmptyConversationWorkViewV1(
  projectId: string,
  connectedConversationId: string,
): ConversationWorkViewStateV1 {
  const section = (kind: ConversationWorkViewSectionKindV1): ConversationWorkViewSectionStateV1 => ({
    kind,
    status: 'pending',
  });
  return {
    schemaVersion: 1,
    projectId,
    connectedConversationId,
    sections: {
      identity: section('identity'),
      reach: section('reach'),
      timeline: section('timeline'),
    },
    runs: [],
    operations: [],
    revision: 0,
  };
}
