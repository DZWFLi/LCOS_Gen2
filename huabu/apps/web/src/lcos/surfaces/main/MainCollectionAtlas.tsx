import useCanvasStore from '@/store/canvasStore';

import { useLcosReferenceStore } from '../../lcosReferenceState';
import { isReadableCollectionArtifact } from '../../nodes/CollectionMemberPreview';
import { useLcosShellStore } from '../../shell/lcosShellStore';
import { isCanonicalCollectionItem } from '../context/contextAtlasSemantics';
import { ContextAtlasStage } from '../context/ContextAtlasStage';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';
import type { CollectionMemberPreview as CoreCollectionMemberPreview } from '@local-creative-os/web-gen2';

/** Main is a canonical Collection locator; Context owns worksite/child navigation semantics. */
export function MainCollectionAtlas({ projectId, onClose }: {
  readonly projectId: string;
  readonly onClose: () => void;
}): React.JSX.Element {
  const activate = (item: WarehouseItemV1): boolean => {
    if (!isCanonicalCollectionItem(item)) return false;
    const nodeId = [...useLcosReferenceStore.getState().nodeEntityRefs.entries()].find(
      ([, ref]) => ref.entityType === 'collection' && ref.entityId === item.entityRef.id,
    )?.[0];
    if (nodeId === undefined) return false;
    const canvasId = useCanvasStore.getState().canvasId;
    useLcosShellStore.getState().requestLocate({
      reqId: crypto.randomUUID(), surface: 'main', ...(canvasId ? { canvasId } : {}), nodeId, status: 'projected', preserveSelection: true,
    });
    onClose();
    return true;
  };
  const readMember = (_collectionId: string, member: CoreCollectionMemberPreview): void => {
    const shell = useLcosShellStore.getState();
    const references = useLcosReferenceStore.getState();
    if (shell.projectId !== projectId || references.projectId !== projectId || !isReadableCollectionArtifact(member)) return;
    const sourceNodeId = [...references.nodeEntityRefs.entries()].find(
      ([, ref]) => ref.entityType === 'artifact' && ref.entityId === member.id,
    )?.[0];
    const options = {
      ...(member.revisionId ? { revisionId: member.revisionId } : {}),
      ...(sourceNodeId === undefined ? {} : { source: { surface: 'main' as const, nodeId: sourceNodeId } }),
    };
    shell.openReader(member.label, member.id, Object.keys(options).length > 0 ? options : undefined);
  };
  return <ContextAtlasStage mode="main-collections" projectId={projectId} workspaces={[]}
    onClose={onClose} onEnterSurface={activate} onReadMember={readMember} />;
}
