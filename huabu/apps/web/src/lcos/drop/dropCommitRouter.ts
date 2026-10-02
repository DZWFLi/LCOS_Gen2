import type { AssemblyApplyResultV1, RailwayReceiveOutcomeV1 } from '@local-creative-os/contracts';
import type { CoreCollectionMembershipReceipt } from '@local-creative-os/web-gen2';
import { assemblyDropReceipt } from './dropAssemblyReceipt';
import type {
  DropCollaborationReferenceIntent,
  DropCommitReceipt,
  DropComposerReferenceIntent,
  DropExternalImportIntent,
  DropIntent,
  DropCollectionMembershipIntent,
  DropAssemblyApplyIntent,
} from './dropTypes';

export interface DropCommitOwners {
  /** Project captured by the real host, independently of any response envelope. */
  readonly projectId?: string;
  readonly receivePortal?: (intent: DropAssemblyApplyIntent, operationId: string, signal?: AbortSignal) => Promise<RailwayReceiveOutcomeV1>;
  readonly receiveRailway?: (intent: DropAssemblyApplyIntent, operationId: string, signal?: AbortSignal) => Promise<RailwayReceiveOutcomeV1>;
  /** Existing Core Assembly apply owner. Must return the canonical receipt. */
  readonly applyAssembly: (
    intent: DropAssemblyApplyIntent,
    signal?: AbortSignal,
  ) => Promise<AssemblyApplyResultV1>;
  /** Existing ephemeral Composer reference owner. */
  readonly addComposerReference: (
    intent: DropComposerReferenceIntent,
  ) => void | Promise<void>;
  /**
   * CollaborationTarget owner：把对象作为 Reference 交给该 Conversation。
   * 缺席 = 该会话引用通道不可用 → fail-close（禁止 fake drop success）。
   */
  readonly addConversationReference?: (
    intent: DropCollaborationReferenceIntent,
  ) => void | Promise<void>;
  readonly addCollectionMember?: (intent: DropCollectionMembershipIntent) => Promise<CoreCollectionMembershipReceipt>;
  /** After the matching positive Core receipt only. Spatial failure must not re-send membership. */
  readonly onCollectionApplied?: (
    intent: DropCollectionMembershipIntent,
    receipt: CoreCollectionMembershipReceipt,
  ) => void | Promise<void>;
  /** Optional real capture/import owner; absent means fail-close. */
  readonly importExternal?: (
    intent: DropExternalImportIntent,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

function failed(
  transactionId: string,
  intent: DropIntent,
  message: string,
): DropCommitReceipt {
  return {
    status: 'failed',
    transactionId,
    targetId: intent.targetId,
    message,
  };
}

/**
 * Thin owner router. It never creates Core Conversation/Run/Railway truth and
 * de-duplicates a transaction id within the current gesture host.
 */
export class DropCommitRouter {
  private readonly receipts = new Map<string, { readonly signature: string; readonly pending: Promise<DropCommitReceipt> }>();

  commit(
    intent: DropIntent,
    transactionId: string,
    owners: DropCommitOwners,
    signal?: AbortSignal,
  ): Promise<DropCommitReceipt> {
    const signature = JSON.stringify([owners.projectId ?? null, intent]);
    const existing = this.receipts.get(transactionId);
    if (existing !== undefined) return existing.signature === signature ? existing.pending
      : Promise.resolve(failed(transactionId, intent, '原投递编号不能用于另一批材料或目标，未重复提交'));

    const pending = this.execute(intent, transactionId, owners, signal);
    this.receipts.set(transactionId, { signature, pending });
    return pending;
  }

  clear(transactionId?: string): void {
    if (transactionId === undefined) this.receipts.clear();
    else this.receipts.delete(transactionId);
  }

  private async execute(
    intent: DropIntent,
    transactionId: string,
    owners: DropCommitOwners,
    signal?: AbortSignal,
  ): Promise<DropCommitReceipt> {
    try {
      if (signal?.aborted) return failed(transactionId,intent,'投递已取消，未发送');
      if (intent.kind === 'assembly-apply' && (intent.railwayReceive || intent.portalReceive)) {
        const operationId = `${intent.portalReceive ? 'portal-receive' : 'railway-receive'}:${transactionId}`;
        const receive = intent.portalReceive ? owners.receivePortal : owners.receiveRailway;
        if (!receive) return failed(transactionId,intent,'目的地接收能力尚未连接，未投递');
        try {
          const outcome = await receive(intent,operationId,signal);
          if (outcome.status !== 'committed' || outcome.operationId !== operationId
            || JSON.stringify(outcome.destination.ref) !== JSON.stringify(intent.railwayDestinationRef)
            || outcome.destination.canvasId !== intent.railwayCanvasId || outcome.result.projectId !== outcome.destination.ref.projectId)
            throw new Error('目的地回执身份不匹配，请先核对原操作');
          return {...assemblyDropReceipt(intent,transactionId,outcome.result,intent.railwayDestinationRef!.kind === 'worksite' ? intent.railwayDestinationRef!.projectId : ''),canonicalReceipt:outcome,railwayReceipt:outcome,railwayOperationId:operationId};
        } catch (error) {
          return {...failed(transactionId,intent,`${error instanceof Error ? error.message : '投递结果未确认'}；源对象仍在原处，请核对原操作`),railwayOperationId:operationId};
        }
      }
      if (intent.kind === 'assembly-apply') {
        if (!owners.projectId?.trim()) return failed(transactionId, intent, '项目身份尚未确认，未发送投递');
        const canonicalReceipt = await owners.applyAssembly(intent, signal);
        return assemblyDropReceipt(intent, transactionId, canonicalReceipt, owners.projectId);
      }

      if (intent.kind === 'composer-reference') {
        await owners.addComposerReference(intent);
        return { status: 'success', transactionId, targetId: intent.targetId, message: '已加入引用' };
      }

      if (intent.kind === 'collaboration-reference') {
        // Retired draft-only body drop must never silently claim durable success.
        return failed(transactionId, intent, '旧会话投放请求已停用，请重新拖放以加入会话上下文');
      }

      if (intent.kind === 'collection-membership' && intent.memberRefs !== undefined) {
        const members = [...new Map(intent.memberRefs.map((ref) => [`${ref.type}:${ref.id}`, ref])).values()];
        if (members.length === 0) return failed(transactionId, intent, '没有可加入集合的对象');
        const { memberRefs: _batch, ...single } = intent;
        const items = [];
        for (const memberRef of members) {
          if (signal?.aborted) {
            items.push({ memberRef, status: 'failed' as const, message: '投递已取消，未发送此项' });
            continue;
          }
          const receipt = await this.execute({ ...single, memberRef }, transactionId, owners, signal);
          items.push({ memberRef, status: receipt.status, message: receipt.message, canonicalReceipt: receipt.canonicalReceipt });
        }
        const successful = items.filter((item) => item.status === 'success').length;
        const confirmed = items.filter((item) => item.status !== 'failed').length;
        return { transactionId, targetId: intent.targetId, collectionItems: items,
          status: successful === items.length ? 'success' : confirmed > 0 ? 'partial' : 'failed',
          message: successful === items.length ? `已加入集合 · ${items.length} 项`
            : `集合投递：${successful} 项完成，${items.length - successful} 项未完成；源对象仍保留`,
        };
      }

      if (intent.kind === 'collection-membership') {
        if (owners.addCollectionMember === undefined) return failed(transactionId, intent, '集合成员写入 owner 尚未就绪');
        const canonicalReceipt = await owners.addCollectionMember(intent);
        const matchesIntent = canonicalReceipt?.collectionId === intent.collectionId
          && canonicalReceipt.memberRef?.type === intent.memberRef.type
          && canonicalReceipt.memberRef?.id === intent.memberRef.id;
        if (!matchesIntent) return failed(transactionId, intent, '集合成员回执与本次投放对象不一致');
        if (canonicalReceipt.status !== 'applied' && canonicalReceipt.status !== 'already-member') {
          return failed(transactionId, intent, canonicalReceipt.status === 'not-member'
            ? '集合未确认该对象为成员' : '集合成员移除未完成投放');
        }
        try {
          await owners.onCollectionApplied?.(intent, canonicalReceipt);
        } catch {
          // The canonical write is already confirmed. Do not report it as failed
          // or offer to duplicate it because a local Frame/geometry command failed.
          return { status: 'partial', transactionId, targetId: intent.targetId,
            message: '集合关系已保存，空间显示尚未同步；请重新展开集合', canonicalReceipt };
        }
        return { status: 'success', transactionId, targetId: intent.targetId,
          message: canonicalReceipt.status === 'already-member' ? '已是集合成员' : '已加入集合', canonicalReceipt };
      }

      if (owners.importExternal === undefined) {
        return failed(transactionId, intent, '当前没有可用的导入/捕获 owner');
      }

      const canonicalReceipt = await owners.importExternal(intent, signal);
      return {
        status: 'success',
        transactionId,
        targetId: intent.targetId,
        canonicalReceipt,
      };
    } catch (error: unknown) {
      return { ...failed(transactionId, intent, error instanceof Error ? error.message : String(error)),
        ...(owners.projectId ? { projectId: owners.projectId } : {}) };
    }
  }
}
