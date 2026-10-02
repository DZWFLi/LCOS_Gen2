import { collectionRemovalConfirmed } from '@local-creative-os/web-gen2';
import type { CoreCollectionClient, CoreCollectionMemberRef } from '@local-creative-os/web-gen2';
import useCanvasStore from '@/store/canvasStore';
import { useLcosReferenceStore } from '../lcosReferenceState';

export interface CollectionMemberRemovalResult {
  readonly proof: 'receipt' | 'readback' | 'unconfirmed';
  readonly spatialPending: boolean;
}

/** Membership removal is shared by the node, overview and Assembly. Only an
 * unchanged, matching native host may be detached after the authoritative reply.
 * Other collections, other projects, later moves and source entities are untouched.
 */
export async function removeCollectionMember(
  client: Pick<CoreCollectionClient, 'removeMember' | 'members'>, projectId: string, collectionId: string, member: CoreCollectionMemberRef,
): Promise<CollectionMemberRemovalResult> {
  const before = useCanvasStore.getState();
  const refs = useLcosReferenceStore.getState();
  const frame = before.nodes.find((node) => node.type === 'frame' && node.data?.lcosCollectionId === collectionId);
  const source = refs.projectId === projectId && frame ? before.nodes.find((node) => {
    const ref = refs.nodeEntityRefs.get(node.id);
    return node.parentId === frame.id && ref?.entityType === member.type && ref.entityId === member.id;
  }) : undefined;
  const origin = source && frame ? { x:source.position.x, y:source.position.y, frameX:frame.position.x, frameY:frame.position.y } : undefined;
  let proof: CollectionMemberRemovalResult['proof'] = 'unconfirmed';
  let spatialPending = false;
  try {
    try {
      const receipt = await client.removeMember(projectId, collectionId, member);
      if (collectionRemovalConfirmed(receipt, collectionId, member)) proof = 'receipt';
    } catch { /* A lost reply is not proof that nothing changed. */ }
    if (proof === 'unconfirmed') {
      // Read back the desired membership state, never replay the mutation.
      const snapshot = await client.members(projectId, collectionId);
      if (snapshot.members.some((row) => row.memberRef.type === member.type && row.memberRef.id === member.id)) return {proof,spatialPending};
      proof = 'readback';
    }
    const live = useCanvasStore.getState();
    const liveRefs = useLcosReferenceStore.getState();
    if (source && frame && origin && liveRefs.projectId === projectId && live.canvasId === before.canvasId) {
      const current = live.nodes.find((node) => node.id === source.id);
      const parent = live.nodes.find((node) => node.id === frame.id && node.type === 'frame');
      const ref = liveRefs.nodeEntityRefs.get(source.id);
      spatialPending = current?.parentId === frame.id && parent?.data?.lcosCollectionId === collectionId;
      // Detaching a changed position or parent would overwrite a later user action.
      if (current?.parentId === frame.id && parent?.data?.lcosCollectionId === collectionId
        && ref?.entityType === member.type && ref.entityId === member.id
        && current.position.x === origin.x && current.position.y === origin.y
        && parent.position.x === origin.frameX && parent.position.y === origin.frameY
        && current.data?.locked !== true && parent.data?.locked !== true) {
        try {
          live.moveNodeOutOfFrame(source.id);
          spatialPending = useCanvasStore.getState().nodes.some((node) => node.id === source.id && node.parentId === frame.id);
        } catch { spatialPending = true; }
      }
    }
    return {proof,spatialPending};
  } catch { return {proof:'unconfirmed',spatialPending:false}; }
  finally {
    // Even a lost reply may have committed. Refresh, never repeat the mutation.
    if (useLcosReferenceStore.getState().projectId === projectId) useLcosReferenceStore.getState().requestNodeBindingRefresh();
  }
}
