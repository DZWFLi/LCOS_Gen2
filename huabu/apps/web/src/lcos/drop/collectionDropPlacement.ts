import { collectionExpansionGeometry } from '../nodes/collectionExpandLayout';

import type { Node } from '@xyflow/react';

/** A gesture-local witness, not saved geometry or a second membership owner. */
export interface CollectionDropPlacementSource {
  readonly frameId: string;
  readonly collectionNodeId: string;
  readonly memberNodeId: string;
  readonly position: { readonly x: number; readonly y: number };
}

/** Capture only the visible host and unparented projection which the user actually dropped. */
export function captureCollectionDropPlacement(
  nodes: readonly Node[],
  collapsedFrameIds: ReadonlySet<string>,
  collectionId: string,
  memberNodeId: string | undefined,
  rightCarry: boolean,
): CollectionDropPlacementSource | undefined {
  // Phase B D03: right carry updates membership but NEVER moves the source.
  if (rightCarry || memberNodeId === undefined) return undefined;
  const frame = nodes.find((node) => node.type === 'frame' && node.data?.lcosCollectionId === collectionId);
  const member = nodes.find((node) => node.id === memberNodeId);
  const collectionNodeId = frame?.data?.lcosCollectionNodeId;
  if (!frame || collapsedFrameIds.has(frame.id) || typeof collectionNodeId !== 'string'
    || !member || member.parentId || member.dragging) return undefined;
  return { frameId: frame.id, collectionNodeId, memberNodeId, position: { ...member.position } };
}

/** Call ONLY after the router has checked the positive receipt's exact collection/member identity. */
export function planCollectionDropPlacement(
  source: CollectionDropPlacementSource | undefined,
  nodes: readonly Node[],
  collapsedFrameIds: ReadonlySet<string>,
  collectionId: string,
) {
  if (!source) return undefined;
  const frame = nodes.find((node) => node.id === source.frameId && node.type === 'frame'
    && node.data?.lcosCollectionId === collectionId && node.data?.lcosCollectionNodeId === source.collectionNodeId);
  const member = nodes.find((node) => node.id === source.memberNodeId);
  // A slow network receipt must not take over a subsequent user move or a new host.
  if (!frame || collapsedFrameIds.has(frame.id) || !member || member.parentId || member.dragging
    || member.position.x !== source.position.x || member.position.y !== source.position.y) return undefined;
  const children = nodes.filter((node) => node.parentId === frame.id).map((node) => node.id);
  return {
    frameId: frame.id,
    memberNodeId: member.id,
    geometry: collectionExpansionGeometry(nodes, source.collectionNodeId, [member.id], children),
  };
}
