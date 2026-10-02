// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
import type { Node } from '@xyflow/react';

export type NodeDragOrigin = { readonly x: number; readonly y: number; readonly parentId?: string };

/** Restore trial geometry only. A newer owner/topology must not be overwritten
 * with coordinates expressed in the OLD parent system.
 */
export function restoreNodeDragPositions(
  nodes: readonly Node[], origins: ReadonlyMap<string, NodeDragOrigin>, preserveNodeIds: readonly string[] = [],
): Node[] {
  const preserve = new Set(preserveNodeIds);
  return nodes.map((node) => {
    const origin = origins.get(node.id);
    if (!origin) return node;
    if (preserve.has(node.id) || origin.parentId !== node.parentId) return { ...node, dragging: false };
    return { ...node, position: { x: origin.x, y: origin.y }, dragging: false };
  });
}
