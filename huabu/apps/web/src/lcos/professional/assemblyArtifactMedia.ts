import type { CoreArtifactClient } from '@local-creative-os/web-gen2';

export interface AssemblyArtifactMediaRead {
  readonly revisionId: string;
  readonly fileRecordId: string;
  readonly kind: 'image' | 'text' | 'audio' | 'video' | 'unsupported';
  readonly blob?: Blob;
  readonly text?: string;
}

/** The Source Bay, preview and Reader read the same selected revision.
 * Metadata calls are parallel; bytes are read only for an explicit/visible preview. */
export async function readAssemblyArtifactMedia(
  client: CoreArtifactClient, projectId: string, artifactId: string,
  revisionId: string | undefined, signal: AbortSignal,
): Promise<AssemblyArtifactMediaRead> {
  const [detail, revisions] = await Promise.all([
    client.getArtifactDetail(artifactId, signal), client.listArtifactRevisions(artifactId, signal),
  ]);
  signal.throwIfAborted();
  if (String(detail.artifact.projectId) !== projectId || String(detail.artifact.id) !== artifactId) {
    throw new Error('这份材料不属于当前项目。');
  }
  const selected = revisionId ?? detail.currentRevisionId ?? detail.artifact.currentRevisionId;
  const revision = revisions.find((entry) => String(entry.id) === String(selected)
    && String(entry.artifactId) === artifactId);
  if (!revision) throw new Error('这个版本暂时无法读取，请刷新材料后重试。');
  const result = { revisionId: String(revision.id), fileRecordId: String(revision.fileRecordId) };
  const bytes = await client.getFileRecordContent(projectId, result.fileRecordId, signal);
  signal.throwIfAborted();
  const mime = bytes.type.toLowerCase().split(';')[0]?.trim() ?? '';
  if (mime.startsWith('image/')) return { ...result, kind: 'image', blob: bytes };
  if (mime.startsWith('audio/')) return { ...result, kind: 'audio', blob: bytes };
  if (mime.startsWith('video/')) return { ...result, kind: 'video', blob: bytes };
  if (mime.startsWith('text/') || ['application/json', 'application/yaml', 'application/xml'].includes(mime)) {
    const text = await bytes.text();
    signal.throwIfAborted();
    return { ...result, kind: 'text', text };
  }
  return { ...result, kind: 'unsupported' };
}
