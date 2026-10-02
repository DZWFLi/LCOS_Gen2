import type { CollectionMemberRef } from '@local-creative-os/domain';

/** Read-only member facts returned with the existing Collection membership snapshot.
 * No preview URL, canvas placement, or new membership identity is persisted here.
 * Artifact membership refers to the artifact; revisionId captures its current revision
 * at this read, not an unrelated historical View presented on another canvas.
 */
export interface CollectionMemberPreview extends CollectionMemberRef {
  readonly label: string;
  readonly kind: 'image' | 'text' | 'pdf' | 'presentation' | 'audio' | 'video' | 'file'
    | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run';
  readonly availability: 'available' | 'missing' | 'stale' | 'unreadable';
  readonly revisionId?: string;
  readonly fileRecordId?: string;
  readonly mimeType?: string;
  readonly byteSize?: number;
  readonly excerpt?: string;
  readonly archived?: boolean;
}
