import type { CanvasNodeGeometryUpdate, CanvasNodeId } from '@huabu/shared';
import type { Node, NodeChange } from '@xyflow/react';

interface Pair { readonly bodyId: string; readonly frameId: string; readonly parentId?: string;
  readonly body: { x: number; y: number }; readonly frame: { x: number; y: number }; last: { x: number; y: number } }
/** The folder and its existing host are one presentation gesture, not one
 * semantic payload. Children move through native parent geometry only. */
export function createCollectionDragCompanions(readNodes: () => readonly Node[]) {
  let pairs: Pair[] = [];
  const find = (dragged: readonly Node[]) => {
    const nodes = readNodes(), ids = new Set(dragged.map((node) => node.id));
    return nodes.filter((frame) => frame.type === 'frame' && !ids.has(frame.id)
      && typeof frame.data?.lcosCollectionNodeId === 'string' && ids.has(frame.data.lcosCollectionNodeId)
      && frame.parentId === nodes.find((node) => node.id === frame.data.lcosCollectionNodeId)?.parentId);
  };
  const companionNodes = (dragged: readonly Node[]) => find(dragged);
  const onStart = (dragged: readonly Node[]) => {
    const nodes = readNodes();
    pairs = find(dragged).flatMap((frame) => {
      const body = nodes.find((node) => node.id === frame.data.lcosCollectionNodeId);
      return body ? [{ bodyId: body.id, frameId: frame.id, ...(frame.parentId ? {parentId:frame.parentId} : {}),
        body: {...body.position}, frame: {...frame.position}, last:{...frame.position} }] : [];
    });
  };
  const filterChanges = (changes: NodeChange[]): NodeChange[] => {
    if (!pairs.length) return changes;
    const nodes = readNodes(); const extra: NodeChange[] = []; const blocked = new Set<string>();
    for (const pair of pairs) {
      const change = changes.find((item) => item.type === 'position' && item.id === pair.bodyId);
      if (!change || change.type !== 'position' || !change.position || change.dragging === undefined) continue;
      const frame = nodes.find((node) => node.id === pair.frameId);
      const body = nodes.find((node) => node.id === pair.bodyId);
      const current = frame?.position;
      // A separately moved/reparented/locked host wins over an old gesture.
      if (!frame || !body || frame.data?.locked === true || frame.parentId !== pair.parentId || body.parentId !== pair.parentId
        || current?.x !== pair.last.x || current?.y !== pair.last.y) { blocked.add(pair.bodyId); continue; }
      const next = {x:pair.frame.x + change.position.x-pair.body.x, y:pair.frame.y + change.position.y-pair.body.y};
      if (!Number.isFinite(next.x) || !Number.isFinite(next.y)) { blocked.add(pair.bodyId); continue; }
      pair.last = next;
      if (!changes.some((item) => item.type === 'position' && item.id === pair.frameId))
        extra.push({type:'position',id:pair.frameId,position:next,dragging:change.dragging});
    }
    return [...changes.filter((item) => item.type !== 'position' || !blocked.has(item.id)), ...extra];
  };
  const externallyChanged = (): string[] => pairs.filter((pair) => {
    const frame=readNodes().find((node)=>node.id===pair.frameId);
    return !frame || frame.parentId!==pair.parentId || frame.position.x!==pair.last.x || frame.position.y!==pair.last.y;
  }).map((pair)=>pair.frameId);
  return {companionNodes,onStart,filterChanges,externallyChanged,clear:()=>{pairs=[];}};
}

/** Explicit align/tidy commands move the same existing host as a drag. This
 * does not enrol members, duplicate children, or modify canonical relations. */
export function withCollectionGeometryCompanions(nodes: readonly Node[], items: readonly CanvasNodeGeometryUpdate[]): CanvasNodeGeometryUpdate[] {
  const updates = new Map(items.map((item) => [String(item.nodeId), item]));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const blocked = new Set<string>();
  for (const frame of nodes) {
    const bodyId = frame.data?.lcosCollectionNodeId;
    if (frame.type !== 'frame' || typeof bodyId !== 'string') continue;
    const body = byId.get(bodyId), move = updates.get(bodyId);
    if (!body || !move?.position || frame.parentId !== body.parentId || updates.has(frame.id)) continue;
    if (frame.data?.locked === true || frame.dragging || body.dragging) { blocked.add(bodyId); continue; }
    const position = { x: frame.position.x + move.position.x - body.position.x,
      y: frame.position.y + move.position.y - body.position.y };
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) { blocked.add(bodyId); continue; }
    updates.set(frame.id, { nodeId: frame.id as CanvasNodeId, position });
  }
  return [...updates.values()].filter((item) => !blocked.has(String(item.nodeId)));
}
