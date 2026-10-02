import type { CollectionMemberPreview, CoreArtifactClient } from '@local-creative-os/web-gen2';

export const COLLECTION_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024;
export const COLLECTION_TEXT_PREVIEW_BYTES = 256 * 1024;
export const COLLECTION_PREVIEW_LABELS: Record<CollectionMemberPreview['kind'], string> = {
  image:'图片', text:'文本', pdf:'PDF', presentation:'演示文稿', audio:'音频', video:'视频', file:'文件',
  note:'笔记', collection:'集合', scope:'范围', workspace:'工作现场', conversation:'会话', run:'任务',
};

export function collectionPreviewLoadable(member: CollectionMemberPreview): boolean {
  const limit = member.kind === 'image' ? COLLECTION_IMAGE_PREVIEW_BYTES
    : member.kind === 'text' ? COLLECTION_TEXT_PREVIEW_BYTES : 0;
  return member.type === 'artifact' && member.availability === 'available' && !!member.revisionId && !!member.fileRecordId
    && limit > 0 && typeof member.byteSize === 'number' && Number.isFinite(member.byteSize) && member.byteSize >= 0 && member.byteSize <= limit;
}

/** Read only the metadata-resolved FileRecord. Do not refetch Current or use a
 * historical projection from an unrelated canvas. Binary documents/media stay
 * recognizable type+title cues, never a made-up cover or an eager full download.
 */
export async function readCollectionPreviewMedia(client: Pick<CoreArtifactClient, 'getFileRecordContent'>,
  projectId: string, member: CollectionMemberPreview, signal: AbortSignal): Promise<Blob | string | undefined> {
  if (member.kind === 'note' && member.availability === 'available') return member.excerpt;
  if (!collectionPreviewLoadable(member)) return undefined;
  const bytes = await client.getFileRecordContent(projectId, member.fileRecordId!, signal);
  signal.throwIfAborted();
  const mime = bytes.type.toLowerCase().split(';')[0]?.trim() ?? '';
  const expected = member.mimeType?.toLowerCase().split(';')[0]?.trim();
  if (mime !== expected || bytes.size > (member.kind === 'image' ? COLLECTION_IMAGE_PREVIEW_BYTES : COLLECTION_TEXT_PREVIEW_BYTES)) {
    throw new Error('材料预览与当前成员版本不一致。');
  }
  if (member.kind === 'image' && mime.startsWith('image/')) return bytes;
  const text = await bytes.text(); signal.throwIfAborted(); return text.slice(0, 1200);
}
