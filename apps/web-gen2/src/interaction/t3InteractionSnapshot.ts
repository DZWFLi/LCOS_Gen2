// Sprint 3（T3）：本地交互快照 —— 把 capability + allowedActions + receipt projection
// 投到本地交互层（T3 §3 t3InteractionSnapshot）。不保存 T6 truth；只做展示/派发输入。

import type { ContinuationActionV1 } from '@local-creative-os/contracts';

export interface T3InteractionSnapshotV1 {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly projectId: string;
  readonly targetConversationRef: string | undefined;
  readonly operationId: string | undefined;
  readonly status: string;
  readonly revision: number;
  readonly allowedActions: readonly ContinuationActionV1[];
  readonly capabilities: { readonly externalCreate: boolean };
}

export interface T3InteractionSnapshotInputV1 {
  readonly snapshotId: string;
  readonly projectId: string;
  readonly targetConversationRef?: string;
  readonly operationId?: string;
  readonly status: string;
  readonly revision: number;
  readonly allowedActions: readonly ContinuationActionV1[];
  readonly capabilities: { readonly externalCreate: boolean };
}

export function createT3InteractionSnapshotV1(input: T3InteractionSnapshotInputV1): T3InteractionSnapshotV1 {
  return {
    schemaVersion: 1,
    snapshotId: input.snapshotId,
    projectId: input.projectId,
    targetConversationRef: input.targetConversationRef,
    operationId: input.operationId,
    status: input.status,
    revision: input.revision,
    allowedActions: [...input.allowedActions],
    capabilities: { externalCreate: input.capabilities.externalCreate },
  };
}

/**
 * stale guard：receipt/投影回来时，target/operation/revision 任一不匹配即丢弃
 * 本地视觉更新（T3 §4）；不能把 A 的迟到回执覆盖 B。
 */
export function isT3SnapshotStaleV1(
  snapshot: T3InteractionSnapshotV1,
  fresh: { readonly targetConversationRef?: string; readonly operationId?: string; readonly revision: number },
): boolean {
  if (snapshot.targetConversationRef !== undefined && snapshot.targetConversationRef !== fresh.targetConversationRef) return true;
  if (snapshot.operationId !== undefined && snapshot.operationId !== fresh.operationId) return true;
  return snapshot.revision !== fresh.revision;
}
