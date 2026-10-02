import type { AssemblyApplyItemResultV1 } from '@local-creative-os/contracts';
import { assemblySourceKey, reviewAssemblyApply, unconfirmedAssemblyItem } from '../professional/assemblyApplyReview';
import type { DropAssemblyApplyIntent, DropCommitReceipt } from './dropTypes';

export { assemblySourceKey as dropSourceKey } from '../professional/assemblyApplyReview';

function summarize(intent: DropAssemblyApplyIntent, transactionId: string, projectId: string,
  items: readonly AssemblyApplyItemResultV1[], unknownKeys: readonly string[], canonicalReceipt: unknown): DropCommitReceipt {
  const unknown = new Set(unknownKeys);
  const known = items.filter((item) => !unknown.has(assemblySourceKey(item.sourceRef)));
  const applied = known.filter((item) => item.status === 'applied').length;
  const already = known.filter((item) => item.status === 'skipped' && item.channel === 'already-member').length;
  const unsupported = known.filter((item) => item.channel === 'unsupported').length;
  const failed = known.filter((item) => item.status === 'failed' && item.channel === 'error').length;
  const allSatisfied = items.length > 0 && unknown.size === 0 && applied + already === items.length;
  const allAlready = allSatisfied && already === items.length;
  const status = allSatisfied ? 'success' : applied + already > 0 ? 'partial' : 'failed';
  const message = [
    allAlready ? (intent.targetRef.kind === 'conversation' ? '已在会话上下文中' : '已在目标中')
      : status === 'success' ? (intent.targetRef.kind === 'conversation' ? '已保存到会话上下文' : '投放完成')
        : status === 'partial' ? '部分完成' : '投放未完成',
    applied > 0 ? `${applied} 项已加入` : undefined,
    !allAlready && already > 0 ? `${already} 项已在目标中` : undefined,
    failed > 0 ? `${failed} 项失败` : undefined,
    unsupported > 0 ? `${unsupported} 项不支持` : undefined,
    unknown.size > 0 || items.length === 0 ? `${unknown.size} 项结果未确认，请先查看目标现场` : undefined,
  ].filter(Boolean).join(' · ');
  return { status, transactionId, targetId: intent.targetId, projectId, message, canonicalReceipt,
    assemblyItems: items, unknownSourceKeys: [...unknown],
    retrySourceRefs: intent.railwayReceive || intent.portalReceive ? [] : intent.sourceRefs.filter((ref) => {
      if (unknown.has(assemblySourceKey(ref))) return false;
      const line = known.find((item) => assemblySourceKey(item.sourceRef) === assemblySourceKey(ref));
      return line?.status === 'failed' && line.channel === 'error';
    }),
  };
}

/** Exactly the same canonical-row review as Assembly buttons. expectedProjectId is request-owned. */
export function assemblyDropReceipt(intent: DropAssemblyApplyIntent, transactionId: string,
  canonicalReceipt: unknown, expectedProjectId: string): DropCommitReceipt {
  const review = reviewAssemblyApply({projectId: expectedProjectId, sourceRefs: intent.sourceRefs}, canonicalReceipt);
  return summarize(intent, transactionId, expectedProjectId, review.result.results, review.unknownKeys, canonicalReceipt);
}

/** A retry updates only its attempted subset. A lost/malformed new reply must never reuse an old
 * failure as permission to resend. Earlier confirmed successes and earlier unknowns both survive. */
export function mergeAssemblyDropAttempt(original: DropAssemblyApplyIntent, attempted: DropAssemblyApplyIntent,
  current: DropCommitReceipt, previous?: DropCommitReceipt): DropCommitReceipt {
  const projectId = current.projectId ?? previous?.projectId ?? '';
  const scopeMatches = current.targetId === original.targetId && attempted.targetId === original.targetId
    && JSON.stringify(attempted.targetRef) === JSON.stringify(original.targetRef)
    && (!previous?.projectId || previous.projectId === projectId);
  const attemptedKeys = new Set(attempted.sourceRefs.map(assemblySourceKey));
  const originalKeys = new Set(original.sourceRefs.map(assemblySourceKey));
  const admissible = scopeMatches && [...attemptedKeys].every((key) => originalKeys.has(key));
  const unknownKeys: string[] = [];
  const next = new Map((current.assemblyItems ?? []).map((item) => [assemblySourceKey(item.sourceRef), item]));
  const prior = new Map((previous?.assemblyItems ?? []).map((item) => [assemblySourceKey(item.sourceRef), item]));
  const items = original.sourceRefs.map((ref) => {
    const key = assemblySourceKey(ref);
    const item = admissible ? (attemptedKeys.has(key) ? next.get(key) : prior.get(key)) : undefined;
    const unknown = attemptedKeys.has(key) ? current.unknownSourceKeys : previous?.unknownSourceKeys;
    if (!item || unknown?.includes(key)) { unknownKeys.push(key); return unconfirmedAssemblyItem(ref); }
    return item;
  });
  return { ...current, ...summarize(original, current.transactionId, projectId, items, unknownKeys, current.canonicalReceipt) };
}
