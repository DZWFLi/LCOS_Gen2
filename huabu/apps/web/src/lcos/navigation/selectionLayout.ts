import { layoutVisualGrid, nodeVisualBounds, type VisualLayoutNode } from './donor/gen1VisualLayout';
import { getAbsolutePosition } from '@huabu/shared/canvas-engine';
import type { Node } from '@xyflow/react';
import type { CanvasNodeGeometryUpdate, CanvasNodeId } from '@huabu/shared';

export type SelectionLayoutAction = 'tidy' | 'distribute-x' | 'distribute-y';
const dimension = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
export function selectionVisibleBounds(nodes: readonly Node[], ids: readonly string[]) {
  const included = new Set(ids);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  // Parent + child selected is one spatial item, not two independent moves.
  return nodes.filter((node) => included.has(node.id) && !node.hidden).filter((node) => {
    let parent = node.parentId; const seen = new Set<string>();
    while (parent && !seen.has(parent)) { if (included.has(parent)) return false; seen.add(parent); parent = byId.get(parent)?.parentId; }
    return true;
  }).flatMap((node) => {
    const position = getAbsolutePosition(nodes as Node[], node.id);
    return position ? [{ node, x: position.x, y: position.y,
      width: dimension(node.measured?.width, dimension(node.width, dimension(node.style?.width, 240))),
      height: dimension(node.measured?.height, dimension(node.height, dimension(node.style?.height, 160))) }] : [];
  });
}
export function layoutNodeLocked(nodes: readonly Node[], nodeId: string): boolean {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let id: string | undefined = nodeId;
  while (id) {
    if (seen.has(id)) return true;
    seen.add(id);
    const node = byId.get(id);
    if (!node || node.data?.locked === true) return true;
    id = node.parentId;
  }
  return false;
}

/** Explicit-only deterministic layout. No membership change, auto mode, camera
 * movement or hidden store; native commands own application and Undo. */
export function planSelectionLayout(nodes: readonly Node[], ids: readonly string[], action: SelectionLayoutAction, entityKinds: ReadonlyMap<string, string> = new Map()): CanvasNodeGeometryUpdate[] {
  const all = selectionVisibleBounds(nodes, ids);
  if (all.length < 2 || (action !== 'tidy' && all.length < 3)) return [];
  const planned = new Map<string, { x: number; y: number }>();
  if (action === 'tidy') {
    // The actual G1 packing/collision functions operate on their original
    // structural shape. Huabu remains the only coordinate/undo owner.
    const donorNodes: VisualLayoutNode[] = all.map((item) => ({
      id: item.node.id, x: item.x, y: item.y, width: item.width, height: item.height,
      positionLocked: layoutNodeLocked(nodes, item.node.id),
      entityKind: entityKinds.get(item.node.id) ?? (typeof item.node.data?.lcosEntityType === 'string' ? item.node.data.lcosEntityType
        : typeof item.node.data?.entityKind === 'string' ? item.node.data.entityKind : undefined),
      kind: item.node.type,
    }));
    const bodies = donorNodes.map((node) => nodeVisualBounds(node));
    const result = layoutVisualGrid(donorNodes, {
      x: Math.min(...bodies.map((body) => body.x)),
      y: Math.min(...bodies.map((body) => body.y)),
    });
    // The donor's bounded repair may exhaust its attempts in pathological
    // crowded inputs. Refuse that proposal rather than persist a bad layout.
    const rects = donorNodes.map((node) => nodeVisualBounds(node, result.find((p) => p.id === node.id) ?? node));
    if (rects.some((a, i) => rects.some((b, j) => j > i
      && !(donorNodes[i]!.positionLocked && donorNodes[j]!.positionLocked)
      && a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y))) return [];
    for (const position of result) planned.set(position.id, position);
  } else {
    const axis = action === 'distribute-x' ? 'x' : 'y'; const size = axis === 'x' ? 'width' : 'height';
    const ordered = [...all].sort((a,b) => a[axis]-b[axis] || a.node.id.localeCompare(b.node.id));
    // Locked members split the row into independent runs. Their positions stay exact.
    const boundaries = [...new Set([0, ...ordered.flatMap((item,i) => layoutNodeLocked(nodes, item.node.id) ? [i] : []), ordered.length-1])];
    for (let b=0;b<boundaries.length-1;b++) {
      const lo=boundaries[b]!, hi=boundaries[b+1]!; if (hi-lo < 2) continue;
      const section=ordered.slice(lo,hi+1); const first=section[0]!, last=section.at(-1)!;
      const occupied=section.reduce((sum,item) => sum+item[size],0);
      const gap=Math.max(18,(last[axis]+last[size]-first[axis]-occupied)/(section.length-1));
      // A fixed last anchor cannot be pushed. Preserve rather than overlap it.
      if (layoutNodeLocked(nodes, last.node.id) && first[axis]+occupied+gap*(section.length-1)>last[axis]+last[size]+.01) continue;
      let cursor=first[axis];
      for (const item of section) {
        if (!layoutNodeLocked(nodes, item.node.id)) planned.set(item.node.id, {...(planned.get(item.node.id) ?? {x:item.x,y:item.y}),[axis]:cursor});
        cursor+=item[size]+gap;
      }
    }
  }
  return all.flatMap((item) => {
    const next=planned.get(item.node.id); if (!next || next.x===item.x && next.y===item.y) return [];
    return [{ nodeId: item.node.id as CanvasNodeId, position: {
      x: item.node.position.x + next.x-item.x, y: item.node.position.y + next.y-item.y,
    } }];
  });
}
