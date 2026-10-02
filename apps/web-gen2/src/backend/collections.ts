import type { CollectionMemberPreview } from '@local-creative-os/contracts';
export type { CollectionMemberPreview } from '@local-creative-os/contracts';

import { HttpClient } from './client.js';
import { coreEnvelope, coreRequest } from './coreTypes.js';

/** Mirrors the Local Core canonical Collection contract (not legacy Scope identity). */
export interface CoreCollectionIdentity {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CoreCollectionMemberType = 'artifact' | 'note' | 'collection' | 'scope' | 'workspace' | 'conversation' | 'run';
export interface CoreCollectionMemberRef { readonly type: CoreCollectionMemberType; readonly id: string }
export interface CoreCollectionMembership {
  readonly collectionId: string;
  readonly memberRef: CoreCollectionMemberRef;
  readonly relationId: string;
  readonly addedAt: string;
}
export interface CoreCollectionMembersSnapshot { readonly collection: CoreCollectionIdentity; readonly members: readonly CoreCollectionMembership[]; readonly previews?: readonly CollectionMemberPreview[] }
export interface CoreCollectionMembershipReceipt {
  readonly status: 'applied' | 'already-member' | 'removed' | 'not-member';
  readonly collectionId: string;
  readonly memberRef: CoreCollectionMemberRef;
  readonly relationId?: string;
  readonly changeSetId?: string;
}

/** Durable membership owner. Huabu parentId and Scope compatibility are intentionally absent. */
export class CoreCollectionClient {
  constructor(private readonly http: HttpClient) {}

  list(projectId: string, signal?: AbortSignal): Promise<readonly CoreCollectionIdentity[]> {
    return coreRequest(this.http, 'GET', `/projects/${encodeURIComponent(projectId)}/collections`, { signal });
  }

  create(projectId: string, title: string, signal?: AbortSignal): Promise<{ collection: CoreCollectionIdentity; changeSetId: string }> {
    return coreEnvelope<CoreCollectionIdentity>(this.http, 'POST', `/projects/${encodeURIComponent(projectId)}/collections`, { signal, body: { title } })
      .then((env) => ({ collection: env.value, changeSetId: String((env.meta as { changeSetId?: unknown } | undefined)?.changeSetId ?? '') }));
  }

  /** Initial membership is acknowledged by the same atomic creation response.
   * An older server ignoring `members` cannot make the canvas hide the sources. */
  async createFromMembers(projectId: string, title: string, members: readonly CoreCollectionMemberRef[], signal?: AbortSignal): Promise<{ collection: CoreCollectionIdentity; changeSetId: string }> {
    const expected = new Set(members.map((ref) => JSON.stringify([ref.type, ref.id])));
    if (!expected.size) throw new Error('请先选择要收纳的材料。');
    const env = await coreEnvelope<CoreCollectionIdentity>(this.http, 'POST', `/projects/${encodeURIComponent(projectId)}/collections`, { signal, body: { title, members } });
    const meta = env.meta as { changeSetId?: unknown; members?: readonly CoreCollectionMemberRef[] } | undefined;
    const accepted = meta?.members;
    if (env.value?.projectId !== projectId || !env.value.id || !Array.isArray(accepted)
      || accepted.length !== expected.size || new Set(accepted.map((ref) => JSON.stringify([ref?.type, ref?.id]))).size !== expected.size
      || accepted.some((ref) => !expected.has(JSON.stringify([ref?.type, ref?.id])))) {
      throw new Error('集合创建结果尚未完整确认，源材料保留原位；请核对已有集合，不要重复创建。');
    }
    return { collection: env.value, changeSetId: String(meta?.changeSetId ?? '') };
  }

  members(projectId: string, collectionId: string, signal?: AbortSignal): Promise<CoreCollectionMembersSnapshot> {
    return coreRequest<CoreCollectionMembersSnapshot>(this.http, 'GET', `/projects/${encodeURIComponent(projectId)}/collections/${encodeURIComponent(collectionId)}/members`, { signal })
      .then((snapshot) => validateCollectionMembersSnapshot(snapshot, projectId, collectionId));
  }

  addMember(projectId: string, collectionId: string, memberRef: CoreCollectionMemberRef, signal?: AbortSignal): Promise<CoreCollectionMembershipReceipt> {
    return coreRequest(this.http, 'POST', `/projects/${encodeURIComponent(projectId)}/collections/${encodeURIComponent(collectionId)}/members`, { signal, body: { memberType: memberRef.type, memberId: memberRef.id } });
  }

  removeMember(projectId: string, collectionId: string, memberRef: CoreCollectionMemberRef, signal?: AbortSignal): Promise<CoreCollectionMembershipReceipt> {
    return coreRequest(this.http, 'DELETE', `/projects/${encodeURIComponent(projectId)}/collections/${encodeURIComponent(collectionId)}/members`, { signal, body: { memberType: memberRef.type, memberId: memberRef.id } });
  }
}

/** One read contract shared by canvas, collection overview and Assembly. Old Core
 * responses without previews retain membership but show a truthful type placeholder.
 */
export function validateCollectionMembersSnapshot(snapshot: CoreCollectionMembersSnapshot, projectId: string, collectionId: string): CoreCollectionMembersSnapshot {
  if (!snapshot || snapshot.collection?.projectId !== projectId || snapshot.collection.id !== collectionId || !Array.isArray(snapshot.members)) {
    throw new Error('集合身份未能确认，请重新读取。');
  }
  const keys = new Set<string>();
  for (const member of snapshot.members) {
    if (!member || member.collectionId !== collectionId || !member.memberRef || typeof member.memberRef.id !== 'string'
      || !['artifact','note','collection','scope','workspace','conversation','run'].includes(member.memberRef.type)) throw new Error('集合成员读取不完整。');
    const key = JSON.stringify([member.memberRef.type, member.memberRef.id]);
    if (keys.has(key)) throw new Error('集合成员重复，请重新读取。');
    keys.add(key);
  }
  if (snapshot.previews !== undefined) {
    const seen = new Set<string>();
    if (!Array.isArray(snapshot.previews) || snapshot.previews.length !== snapshot.members.length) throw new Error('集合预览与成员不一致。');
    for (const preview of snapshot.previews) {
      const key = JSON.stringify([preview?.type, preview?.id]);
      if (!keys.has(key) || seen.has(key) || typeof preview.label !== 'string'
        || !['available','missing','stale','unreadable'].includes(preview.availability)
        || !['image','text','pdf','presentation','audio','video','file','note','collection','scope','workspace','conversation','run'].includes(preview.kind)) throw new Error('集合预览与成员不一致。');
      seen.add(key);
    }
  }
  return snapshot;
}

export function collectionPreviewMembers(snapshot: CoreCollectionMembersSnapshot): readonly CollectionMemberPreview[] {
  const byKey = new Map(snapshot.previews?.map((preview) => [JSON.stringify([preview.type, preview.id]), preview]));
  const labels = { artifact:'材料', note:'笔记', collection:'集合', scope:'范围', workspace:'工作现场', conversation:'会话', run:'任务' };
  return snapshot.members.map(({ memberRef }): CollectionMemberPreview => byKey.get(JSON.stringify([memberRef.type, memberRef.id]))
    ?? { ...memberRef, label: labels[memberRef.type], kind: memberRef.type === 'artifact' ? 'file' : memberRef.type, availability: 'unreadable' });
}

/** A removal acknowledgement must refer to this exact member and collection.
 * not-member also satisfies removal; uncertain replies never justify a geometry write.
 */
export function collectionRemovalConfirmed(receipt: CoreCollectionMembershipReceipt, collectionId: string, member: CoreCollectionMemberRef): boolean {
  return !!receipt && receipt.collectionId === collectionId && receipt.memberRef?.type === member.type
    && receipt.memberRef.id === member.id && (receipt.status === 'removed' || receipt.status === 'not-member');
}
