import type { Node } from '@xyflow/react';
import { getAbsolutePosition } from '@huabu/shared/canvas-engine';

/** Presentation only. An existing physical host is never stolen by opening
 * another collection. Shared members remain available in the real preview. */
export function collectionHostMemberIds(nodes: readonly Node[], memberIds: readonly string[], ownerId: string): string[] {
  const ids = new Set(memberIds);
  const hosted = nodes.filter((node) => ids.has(node.id) && node.id !== ownerId && !node.parentId
    && node.data?.locked !== true && !node.dragging);
  const accepted = new Set(hosted.map((node) => node.id));
  // A selected nested collection carries its already-existing spatial host;
  // this is not an additional canonical member or a second projection.
  for (const frame of nodes) if (frame.type === 'frame' && !frame.parentId && frame.data?.locked !== true
    && typeof frame.data.lcosCollectionNodeId === 'string' && accepted.has(frame.data.lcosCollectionNodeId)) accepted.add(frame.id);
  return [...accepted];
}

export interface CollectionFrameOptions {
  readonly nodeIds?: readonly string[];
  readonly label?: string;
  readonly collectionId?: string;
  readonly collectionNodeId?: string;
  readonly emptyBounds?: { x: number; y: number; width: number; height: number };
}
export interface CollectionHostState {
  readonly nodes: readonly Node[];
  readonly collapsedFrameIds: ReadonlySet<string>;
  frameSelectedNodes(options: CollectionFrameOptions): void;
  toggleFrameCollapse(id: string): void;
}
/** Reopening does NOT enrol newly shared members or re-run a layout. */
export function toggleCollectionHost(getState: () => CollectionHostState, collectionId: string, ownerId: string,
  title: string, memberIds: readonly string[]): boolean {
  const state = getState();
  const owner = state.nodes.find((node) => node.id === ownerId);
  if (!owner) return false;
  const frame = state.nodes.find((node) => node.type === 'frame' && node.data?.lcosCollectionId === collectionId);
  if (frame) { state.toggleFrameCollapse(frame.id); return true; }
  const nodeIds = collectionHostMemberIds(state.nodes, memberIds, ownerId);
  const position = getAbsolutePosition(state.nodes as Node[], owner.id) ?? owner.position;
  state.frameSelectedNodes({ nodeIds, label: title, collectionId, collectionNodeId: ownerId,
    emptyBounds: { x: position.x + 292, y: position.y, width: 320, height: 220 } });
  return getState().nodes.some((node) => node.type === 'frame' && node.data?.lcosCollectionId === collectionId);
}
