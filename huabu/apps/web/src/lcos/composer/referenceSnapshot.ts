import type { CoreEntityRefLike } from '../referenceBridge';
import { draftReferenceKey } from '../referenceBridge';
import { toRunReference } from '../professional/conversationContinuationActions';

export interface PresentedReference extends CoreEntityRefLike {
  readonly displayLabel?: string;
  readonly descriptor?: {
    readonly entityType?: string;
    readonly entityId?: string;
    readonly presentedRevisionId?: string;
    readonly currentRevisionId?: string;
    readonly artifactViewId?: string;
    readonly mimeType?: string;
  };
}

/** Capture visible version facts once. Later projection refreshes must not change this draft. */
export function snapshotDraftReference<T extends PresentedReference>(ref: T): T {
  const descriptor = ref.descriptor;
  if (!descriptor || ref.entityType !== 'artifact') return ref;
  if (descriptor.entityType !== 'artifact' || descriptor.entityId !== ref.entityId) {
    // Legacy identity-only binding reads may carry a View but no version facts.
    // Preserve that address, without inventing a revision or accepting an explicit mismatch.
    return !descriptor.entityType && !descriptor.entityId && !ref.artifactViewId && descriptor.artifactViewId
      ? { ...ref, artifactViewId: descriptor.artifactViewId } : ref;
  }
  const visibleRevision = descriptor.presentedRevisionId ?? descriptor.currentRevisionId;
  // An explicit historical address wins; never pair it with another revision's file facts.
  if (ref.revisionId && ref.revisionId !== visibleRevision) return ref;
  return { ...ref,
    ...(ref.revisionId || !visibleRevision ? {} : { revisionId: visibleRevision }),
    ...(ref.artifactViewId || !descriptor.artifactViewId ? {} : { artifactViewId: descriptor.artifactViewId }),
    ...(ref.mimeType || !descriptor.mimeType ? {} : { mimeType: descriptor.mimeType }),
  };
}

/** Serializable gesture form, retaining the same address as click/Reader/Assembly. */
export function draftReferenceForGesture(ref: PresentedReference): CoreEntityRefLike & { readonly displayLabel?: string } {
  const snapshot = snapshotDraftReference(ref);
  return { entityType: snapshot.entityType, entityId: snapshot.entityId,
    ...(snapshot.artifactId ? { artifactId: snapshot.artifactId } : {}),
    ...(snapshot.artifactViewId ? { artifactViewId: snapshot.artifactViewId } : {}),
    ...(snapshot.revisionId ? { revisionId: snapshot.revisionId } : {}),
    ...(snapshot.mode ? { mode: snapshot.mode } : {}),
    ...(snapshot.presentationId ? { presentationId: snapshot.presentationId } : {}),
    ...(snapshot.mimeType ? { mimeType: snapshot.mimeType } : {}),
    ...(snapshot.displayLabel ? { displayLabel: snapshot.displayLabel } : {}),
  };
}

/** Early type checks, shared by every entry and submit. Not a provider/multimodal capability claim. */
export function draftReferenceUnavailableReason(ref: CoreEntityRefLike | undefined, intent?: string): string | undefined {
  if (!ref || typeof ref.entityId !== 'string' || !ref.entityId.trim()) return '该类型暂无可用于本次输入的材料引用，请先阅读已有产物。';
  if ((ref.revisionId !== undefined && (typeof ref.revisionId !== 'string' || !ref.revisionId.trim()))
    || (ref.mode !== undefined && !['full', 'summary', 'structure'].includes(ref.mode))) return '引用版本或读取方式尚未确认。';
  const mapped = toRunReference(ref);
  if (!mapped) return '该类型暂不能用于本次输入，请使用已保存的材料版本。';
  if (intent === 'continue' && mapped.type !== 'artifact' && mapped.type !== 'view') {
    return '当前续聊通道只接收材料版本，请打开其中的材料后引用。';
  }
  return undefined;
}

/** Current Run manifest reads full plain/Markdown text. Conversation transport
 * has its own capability owner; this check must not restrict that path. */
export function runReferenceUnavailableReason(ref: PresentedReference): string | undefined {
  const snapshot = snapshotDraftReference(ref);
  const invalid = draftReferenceUnavailableReason(snapshot, 'delegate');
  if (invalid) return invalid;
  const mapped = toRunReference(snapshot);
  if (mapped?.type !== 'artifact' && mapped?.type !== 'view') {
    return '当前任务只读取材料正文，请打开其中的材料后引用；已有输入保留。';
  }
  if (snapshot.mode !== undefined && snapshot.mode !== 'full') {
    return '当前任务暂不支持摘要或结构引用，请改为全文；已有输入保留。';
  }
  if (snapshot.mimeType && !['text/plain', 'text/markdown'].includes(snapshot.mimeType)) {
    return '当前任务暂不能读取图片、PDF 等文件内容，请使用文字材料；已有输入保留。';
  }
  return undefined;
}

/** Validate the whole user selection before touching the shared draft. Keep order and exact modes. */
export function prepareDraftReferences<T extends PresentedReference>(refs: readonly (T | undefined)[], intent?: string):
  | { readonly ok: true; readonly references: readonly T[] }
  | { readonly ok: false; readonly reason: string } {
  if (!refs.length) return { ok: false, reason: '没有可加入的引用。' };
  const references: T[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const snapshot = ref ? snapshotDraftReference(ref) : undefined;
    const reason = draftReferenceUnavailableReason(snapshot, intent);
    if (reason || !snapshot) return { ok: false, reason: reason ?? '引用身份尚未就绪。' };
    const key = draftReferenceKey(snapshot);
    if (!seen.has(key)) { seen.add(key); references.push(snapshot); }
  }
  return { ok: true, references };
}
