import type { CollaborationSessionProjectionV1 } from '@local-creative-os/contracts';
import type { LcosDropFeedback } from '../lcosDropState';
import type { DropResolution } from '../drop/dropTypes';

export function glythSessionLabel(projection?: CollaborationSessionProjectionV1, readStatus?: string): string {
  if (!projection) return readStatus === 'error' ? '状态读取失败' : '正在读取状态';
  if (projection.activity.pendingInputId) return '等你回答';
  if (projection.recentReturns.some((item) => item.status === 'pending_review')) return '需要复核';
  if (projection.recovery?.state === 'recovering') return '正在恢复';
  if (projection.recovery?.state === 'recoverable' || projection.recovery?.state === 'blocked') return '需要恢复';
  return ({ ready: '可以继续', thinking: '正在理解', working: '正在执行', needs_user: '需要你处理',
    done: '本轮已完成', unavailable: '暂时不可用' } as const)[projection.userState];
}

export function isGlythDropTarget(conversationId: string | null, resolution: DropResolution | null): boolean {
  return conversationId !== null && resolution?.status === 'ready'
    && resolution.intent.kind === 'assembly-apply' && resolution.intent.targetRef.kind === 'conversation'
    && resolution.intent.targetRef.id === conversationId;
}

/** A reaction comes only from this gesture's authoritative receipt, never a hover or an API 200 alone. */
export function glythDropFeedback(conversationId: string | null, feedback: LcosDropFeedback | null): {
  readonly label: string;
  readonly reaction?: { readonly id: string; readonly kind: 'bounce' };
} | undefined {
  if (!feedback || !isGlythDropTarget(conversationId, feedback.originalIntent)) return undefined;
  const { receipt } = feedback;
  return { label: receipt.message ?? (receipt.status === 'success' ? '已保存到会话上下文' : '投递尚未完成'),
    ...(receipt.status === 'success' ? { reaction: { id: receipt.transactionId, kind: 'bounce' as const } } : {}),
  };
}

export function mayOpenGlythFromKeyboard(event: { readonly key: string; readonly repeat: boolean; readonly isComposing?: boolean }): boolean {
  // Space remains the canvas pan gesture. Holding Enter must not repeatedly reopen the window.
  return event.key === 'Enter' && !event.repeat && event.isComposing !== true;
}
