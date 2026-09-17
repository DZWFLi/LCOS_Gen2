import type {
  DropCollaborationReferenceIntent,
  DropCommitReceipt,
  DropComposerReferenceIntent,
  DropExternalImportIntent,
  DropIntent,
  DropAssemblyApplyIntent,
} from './dropTypes';

export interface DropCommitOwners {
  /** Existing Core Assembly apply owner. Must return the canonical receipt. */
  readonly applyAssembly: (
    intent: DropAssemblyApplyIntent,
    signal?: AbortSignal,
  ) => Promise<unknown>;
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
  private readonly receipts = new Map<string, Promise<DropCommitReceipt>>();

  commit(
    intent: DropIntent,
    transactionId: string,
    owners: DropCommitOwners,
    signal?: AbortSignal,
  ): Promise<DropCommitReceipt> {
    const existing = this.receipts.get(transactionId);
    if (existing !== undefined) return existing;

    const pending = this.execute(intent, transactionId, owners, signal);
    this.receipts.set(transactionId, pending);
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
      if (intent.kind === 'assembly-apply') {
        const canonicalReceipt = await owners.applyAssembly(intent, signal);
        return {
          status: 'success',
          transactionId,
          targetId: intent.targetId,
          canonicalReceipt,
        };
      }

      if (intent.kind === 'composer-reference') {
        await owners.addComposerReference(intent);
        return { status: 'success', transactionId, targetId: intent.targetId };
      }

      if (intent.kind === 'collaboration-reference') {
        if (owners.addConversationReference === undefined) {
          return failed(transactionId, intent, '当前会话不支持接收引用（owner 未配置）');
        }
        await owners.addConversationReference(intent);
        return { status: 'success', transactionId, targetId: intent.targetId };
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
      return failed(
        transactionId,
        intent,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
