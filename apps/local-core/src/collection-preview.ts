import type { CollectionMemberPreview } from '@local-creative-os/contracts';
import type { CollectionMembership, RunId } from '@local-creative-os/domain';
import type { SqliteMetadataRepository } from './metadata-repository.js';

const LABELS = { artifact: '材料', note: '笔记', collection: '集合', scope: '范围',
  workspace: '工作现场', conversation: '会话', run: '任务' } as const;

/** Synchronous metadata projection: no files are read and no domain mutation occurs.
 * Keep membership order and missing members. Never fetch a title from another project.
 */
export function readCollectionMemberPreviews(
  metadata: SqliteMetadataRepository, projectId: string, members: readonly CollectionMembership[],
): readonly CollectionMemberPreview[] {
  let scopes: NonNullable<ReturnType<SqliteMetadataRepository['get']>>['scopes'] | undefined;
  return members.map(({ memberRef }): CollectionMemberPreview => {
    const { type, id } = memberRef;
    const fallback: CollectionMemberPreview = { type, id, kind: type === 'artifact' ? 'file' : type,
      label: `${LABELS[type]}暂不可读`, availability: 'missing' };
    if (type === 'artifact') {
      const artifact = metadata.getArtifact(id);
      if (!artifact || String(artifact.projectId) !== projectId) return fallback;
      const base = { ...fallback, label: artifact.title, ...(artifact.archivedAt ? { archived: true } : {}) };
      const revision = artifact.currentRevisionId ? metadata.getArtifactRevision(String(artifact.currentRevisionId)) : undefined;
      if (!revision || String(revision.artifactId) !== id) return base;
      const file = metadata.getFileRecord(String(revision.fileRecordId));
      if (!file || String(file.projectId) !== projectId) return { ...base, revisionId: String(revision.id) };
      const mime = file.mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
      const kind = mime.startsWith('image/') ? 'image' : mime.startsWith('audio/') ? 'audio'
        : mime.startsWith('video/') ? 'video' : mime === 'application/pdf' ? 'pdf'
          : mime.includes('presentation') || mime.includes('powerpoint') ? 'presentation'
            : mime.startsWith('text/') || ['application/json', 'application/yaml', 'application/xml'].includes(mime) ? 'text' : 'file';
      const availability = artifact.availability === 'missing' ? 'missing'
        : artifact.availability === 'stale' ? 'stale'
          : file.availability === 'current' ? 'available' : file.availability;
      return { ...base, kind, availability, revisionId: String(revision.id), fileRecordId: String(file.id),
        mimeType: file.mimeType, byteSize: file.size };
    }
    if (type === 'note') {
      const note = metadata.getNote(id);
      if (!note || String(note.projectId) !== projectId) return fallback;
      return { ...fallback, label: note.body.split(/\r?\n/).find((line) => line.trim())?.slice(0, 80) || '空笔记',
        availability: 'available', excerpt: note.body.slice(0, 1200) };
    }
    if (type === 'collection') {
      const value = metadata.getCollection(id);
      return value && String(value.projectId) === projectId ? { ...fallback, label: value.title, availability: 'available' } : fallback;
    }
    if (type === 'workspace') {
      const value = metadata.getWorkspace(id);
      return value && String(value.projectId) === projectId ? { ...fallback, label: value.name, availability: 'available' } : fallback;
    }
    if (type === 'scope') {
      scopes ??= metadata.get(projectId)?.scopes ?? [];
      const value = scopes.find((scope) => String(scope.id) === id);
      return value ? { ...fallback, label: value.name, availability: 'available' } : fallback;
    }
    if (type === 'conversation') {
      const value = metadata.getConnectedConversation(projectId, id);
      return value ? { ...fallback, label: value.label, availability: 'available' } : fallback;
    }
    const value = metadata.getRun(id as RunId);
    return value && String(value.projectId) === projectId
      ? { ...fallback, label: value.instruction?.slice(0, 80) || '任务', availability: 'available' } : fallback;
  });
}
