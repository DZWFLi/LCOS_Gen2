import { isLcosNodeDeleteAllowed } from '@local-creative-os/web-gen2';

import type { Node } from '@xyflow/react';

export interface CoreNodeBinding {
  readonly entityType: string;
  readonly entityId: string;
}

/** Keep Core projections in place while preserving native node deletion. */
export function deletableCanvasNodeIds(
  nodes: readonly Pick<Node, 'id' | 'parentId'>[],
  bindings: ReadonlyMap<string, CoreNodeBinding>,
  selectedNodeIds: readonly string[] = nodes.map((node) => node.id),
): string[] {
  const boundIds = new Set(
    [...bindings.entries()]
      .filter(([, binding]) => !isLcosNodeDeleteAllowed(binding))
      .map(([nodeId]) => nodeId),
  );
  const descendantsByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const children = descendantsByParent.get(node.parentId) ?? [];
    children.push(node.id);
    descendantsByParent.set(node.parentId, children);
  }
  const hasBoundDescendant = (nodeId: string): boolean => {
    const pending = [...(descendantsByParent.get(nodeId) ?? [])];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const descendantId = pending.pop();
      if (!descendantId) continue;
      if (visited.has(descendantId)) continue;
      visited.add(descendantId);
      if (boundIds.has(descendantId)) return true;
      pending.push(...(descendantsByParent.get(descendantId) ?? []));
    }
    return false;
  };
  return nodes
    .filter(
      (node) =>
        selectedNodeIds.includes(node.id) &&
        isLcosNodeDeleteAllowed(bindings.get(node.id)) &&
        !hasBoundDescendant(node.id),
    )
    .map((node) => node.id);
}
