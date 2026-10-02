import type { ReactFlowState } from '@xyflow/react';

// Cache a pure selector per React Flow snapshot. All mounted bodies reuse one
// traversal; no second node registry, subscription or camera is introduced.
const counts = new WeakMap<object, number>();

export function visibleFlowNodeCount(state: Pick<ReactFlowState, 'nodeLookup' | 'transform' | 'width' | 'height'>): number {
  const cached = counts.get(state);
  if (cached !== undefined) return cached;
  const [tx, ty, zoom] = state.transform;
  if (!(zoom > 0) || !(state.width > 0) || !(state.height > 0)) return 0;
  const left = -tx / zoom, top = -ty / zoom;
  const right = left + state.width / zoom, bottom = top + state.height / zoom;
  let count = 0;
  for (const node of state.nodeLookup.values()) {
    if (node.hidden) continue;
    let parentId = node.parentId;
    const seen = new Set<string>([node.id]);
    let hidden = false;
    while (parentId) {
      if (seen.has(parentId)) { hidden = true; break; }
      seen.add(parentId);
      const parent = state.nodeLookup.get(parentId);
      if (!parent || parent.hidden) { hidden = true; break; }
      parentId = parent.parentId;
    }
    if (hidden) continue;
    const { x, y } = node.internals.positionAbsolute;
    const width = node.measured.width ?? node.width ?? node.initialWidth ?? 0;
    const height = node.measured.height ?? node.height ?? node.initialHeight ?? 0;
    if (width > 0 && height > 0 && x < right && y < bottom && x + width > left && y + height > top) count++;
  }
  counts.set(state, count);
  return count;
}
