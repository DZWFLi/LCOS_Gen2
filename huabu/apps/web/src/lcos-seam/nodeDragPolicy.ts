// A host may replace the END of a native drag, not the native movement engine.
// No project/entity semantics cross this seam. All optional: stock behavior is unchanged.
import type { Node, NodeChange, OnNodeDrag } from '@xyflow/react';

export interface CanvasNodeDragPolicy {
  /** Non-selected geometry that belongs to the same spatial body. Native
   * history/save/cancel owns these nodes too; semantic payloads stay unchanged. */
  companionNodes?(nodes: readonly Node[]): readonly Node[];
  onStart(event: MouseEvent | TouchEvent, node: Node, nodes: Node[]): void;
  /** true means the host has supplied the drop preview; skip stock Frame previews. */
  onMove(event: MouseEvent | TouchEvent, node: Node, nodes: Node[]): boolean;
  /** true means the trial drag was cancelled/handled; NEVER run native reparent/save after it. */
  onStop(event: MouseEvent | TouchEvent, node: Node, nodes: Node[]): boolean;
  /** Ignore trailing RF drag ticks after cancellation, retaining selection/measurement updates. */
  filterChanges(changes: NodeChange[]): NodeChange[];
}

export function canvasDragHandlers(
  native: {
    onNodeDragStart: OnNodeDrag;
    onNodeDrag: OnNodeDrag;
    onNodeDragStop: OnNodeDrag;
    onNodesChange: (changes: NodeChange[]) => void;
  },
  policy?: CanvasNodeDragPolicy,
) {
  const together = (nodes: Node[]): Node[] => [...new Map([...nodes, ...(policy?.companionNodes?.(nodes) ?? [])]
    .map((node) => [node.id, node])).values()];
  return {
    onNodeDragStart: ((event, node, nodes) => {
      native.onNodeDragStart(event, node, together(nodes));
      policy?.onStart(event, node, nodes);
    }) as OnNodeDrag,
    onNodeDrag: ((event, node, nodes) => {
      if (!policy?.onMove(event, node, nodes)) native.onNodeDrag(event, node, together(nodes));
    }) as OnNodeDrag,
    onNodeDragStop: ((event, node, nodes) => {
      if (!policy?.onStop(event, node, nodes)) native.onNodeDragStop(event, node, together(nodes));
    }) as OnNodeDrag,
    onNodesChange: (changes: NodeChange[]) => native.onNodesChange(policy?.filterChanges(changes) ?? changes),
  };
}
