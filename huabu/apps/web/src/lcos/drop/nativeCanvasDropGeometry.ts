import { draftReferenceForGesture, type PresentedReference } from '../composer/referenceSnapshot';
import { getAbsolutePosition } from '@huabu/shared/canvas-engine';
import type { Node } from '@xyflow/react';
import type { CanvasDropNode, NativeCanvasDropSource, CanvasDropScope } from './nativeCanvasDrop';
import type { DropCollectionMembershipIntent, DropCommitReceipt } from './dropTypes';

export interface NativeDropRef extends PresentedReference {}

/** Snapshot from native geometry + the EXISTING authoritative-binding cache. */
export function snapshotCanvasDropNodes(
  ids: readonly string[], nodes: readonly Node[], refs: ReadonlyMap<string, NativeDropRef>,
): CanvasDropNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return ids.flatMap((nodeId) => {
    const node = byId.get(nodeId);
    const absolutePosition = getAbsolutePosition(nodes as Node[], nodeId);
    if (!node || !absolutePosition) return [];
    const ref = refs.get(nodeId);
    return [{ nodeId, position: { ...node.position }, absolutePosition: { ...absolutePosition },
      ...(node.parentId === undefined ? {} : { parentId: node.parentId }),
      ...(ref === undefined ? {} : { reference: draftReferenceForGesture(ref) }),
    }];
  });
}

export function sameCanvasDropNode(a: CanvasDropNode, b: CanvasDropNode | undefined): boolean {
  return b !== undefined && a.nodeId === b.nodeId && a.parentId === b.parentId
    && a.reference?.entityType === b.reference?.entityType && a.reference?.entityId === b.reference?.entityId
    && a.reference?.artifactViewId === b.reference?.artifactViewId
    && a.reference?.revisionId === b.reference?.revisionId
    && a.reference?.mode === b.reference?.mode
    && a.position.x === b.position.x && a.position.y === b.position.y
    && a.absolutePosition.x === b.absolutePosition.x && a.absolutePosition.y === b.absolutePosition.y;
}

/** After a MATCHING positive canonical receipt, place only the successful,
 * still-unmodified sources. No Core undo/retry, no stale geometry overwrite.
 */
export function planNativeCanvasLanding(
  source: NativeCanvasDropSource,
  intent: DropCollectionMembershipIntent,
  receipt: DropCommitReceipt,
  scope: CanvasDropScope,
  nodes: readonly Node[],
  refs: ReadonlyMap<string, NativeDropRef>,
  collapsed: ReadonlySet<string>,
) {
  const landing = source.landing;
  const empty = { items: [] as { nodeId: string; position: { x: number; y: number } }[], skipped: true };
  if (!landing || source.scope.projectId !== scope.projectId || source.scope.canvasId !== scope.canvasId
    || intent.targetId !== receipt.targetId || intent.collectionId !== landing.collectionId) return empty;
  const frame = nodes.find((node) => node.id === landing.frameId && node.type === 'frame'
    && node.data?.lcosCollectionId === landing.collectionId);
  const frameAbs = frame && getAbsolutePosition(nodes as Node[], frame.id);
  if (!frame || frame.hidden || frame.data.locked || collapsed.has(frame.id) || !frameAbs
    || frameAbs.x !== landing.framePosition.x || frameAbs.y !== landing.framePosition.y) return empty;
  const live = new Map(snapshotCanvasDropNodes(source.nodes.map((node) => node.nodeId), nodes, refs).map((node) => [node.nodeId, node]));
  const results = receipt.collectionItems ?? [{ memberRef: intent.memberRef, status: receipt.status, canonicalReceipt: receipt.canonicalReceipt }];
  const successKeys = new Set(results.flatMap((item) => {
    const canonical = item.canonicalReceipt as { collectionId?: string; memberRef?: { type?: string; id?: string }; status?: string } | undefined;
    return item.status === 'success' && canonical?.collectionId === landing.collectionId
      && canonical.memberRef?.type === item.memberRef.type && canonical.memberRef?.id === item.memberRef.id
      && (canonical.status === 'applied' || canonical.status === 'already-member')
      ? [`${item.memberRef.type}:${item.memberRef.id}`] : [];
  }));
  let skipped = false;
  const items = source.nodes.flatMap((original) => {
    if (!original.reference || !successKeys.has(`${original.reference.entityType}:${original.reference.entityId}`)) return [];
    const current = live.get(original.nodeId);
    const released = landing.nodes.find((node) => node.nodeId === original.nodeId);
    const currentNode = nodes.find((node) => node.id === original.nodeId);
    if (!released || !sameCanvasDropNode(original, current) || currentNode?.dragging || currentNode?.data.locked) {
      skipped = true; return [];
    }
    // The native SET_NODE_PARENT command preserves world-space position. Its
    // preceding geometry write is in the CURRENT parent's coordinates.
    return [{ nodeId: original.nodeId, position: {
      x: original.position.x + released.absolutePosition.x - original.absolutePosition.x,
      y: original.position.y + released.absolutePosition.y - original.absolutePosition.y,
    } }];
  });
  return { items, skipped };
}
