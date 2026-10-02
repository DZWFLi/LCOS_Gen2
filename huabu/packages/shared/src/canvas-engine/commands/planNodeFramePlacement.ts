// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import setNodeGeometry from './setNodeGeometry.js';
import setNodeParent from './setNodeParent.js';
import type { CommandHandlerContext } from './types.js';
import type { CanvasCommand } from '../../index.js';

export type NodeFramePlacement = {
  readonly nodeId: string;
  /** Position in the node's CURRENT parent coordinate system. */
  readonly position: { readonly x: number; readonly y: number };
};

/** Prepare a single native geometry/parent batch without modifying state.
 * Validate using the same command handlers that execute it, so an invalid
 * reparent cannot leave the first geometry command partially committed.
 */
export function planNodeFramePlacement(
  state: CommandHandlerContext,
  items: readonly NodeFramePlacement[],
  frameId: string,
): CanvasCommand[] | undefined {
  if (items.length === 0 || new Set(items.map((item) => item.nodeId)).size !== items.length) return undefined;
  const byId = new Map(state.nodes.map((node) => [node.id, node]));
  if (byId.get(frameId)?.type !== 'frame') return undefined;
  const ids = new Set(items.map((item) => item.nodeId));
  for (const item of items) {
    const node = byId.get(item.nodeId);
    if (!node || node.data?.locked || !Number.isFinite(item.position.x) || !Number.isFinite(item.position.y)) return undefined;
    // Preserve a selected parent's descendants rather than flattening the tree.
    const seen = new Set<string>();
    let parent = node.parentId;
    while (parent) {
      if (ids.has(parent) || seen.has(parent) || byId.get(parent)?.data?.locked) return undefined;
      seen.add(parent);
      parent = byId.get(parent)?.parentId;
    }
  }
  const geometry: Extract<CanvasCommand, { type: 'SET_NODE_GEOMETRY' }> = {
    type: 'SET_NODE_GEOMETRY',
    items: items.map((item) => ({ nodeId: item.nodeId as Extract<CanvasCommand, { type: 'SET_NODE_GEOMETRY' }>['items'][number]['nodeId'], position: { ...item.position } })),
  };
  const parent: Extract<CanvasCommand, { type: 'SET_NODE_PARENT' }> = {
    type: 'SET_NODE_PARENT',
    nodeIds: items.map((item) => item.nodeId) as Extract<CanvasCommand, { type: 'SET_NODE_PARENT' }>['nodeIds'],
    parentId: frameId as Extract<CanvasCommand, { type: 'SET_NODE_PARENT' }>['parentId'],
  };
  const projected = setNodeGeometry.handler(geometry, state);
  const parented = setNodeParent.handler(parent, { ...state, nodes: projected.nodes, edges: projected.edges });
  if (parented.reason && parented.reason !== 'no-op') return undefined;
  if (!items.every((item) => parented.nodes.find((node) => node.id === item.nodeId)?.parentId === frameId)) return undefined;
  return [geometry, parent];
}
