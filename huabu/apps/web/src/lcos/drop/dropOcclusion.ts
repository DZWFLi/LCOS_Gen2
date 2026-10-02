import type { SurfacePoint } from './dropTypes';

/** Browser hit testing, not a new coordinate/overlay owner. */
export function isDropPointExposed(element: Element, point: SurfacePoint): boolean {
  if (!element.isConnected) return false;
  const document = element.ownerDocument;
  // Headless DOM unit runners have no layout engine; the production browser does.
  if (typeof document.elementsFromPoint !== 'function') return true;
  const front = document.elementsFromPoint(point.x, point.y).find((candidate) =>
    candidate.closest('.react-flow__node.dragging,[data-lcos-native-drop-source],[data-lcos-native-drop-pending]') === null);
  return front !== undefined && element.contains(front);
}

/** Collection's native Frame is intentionally borderless/pointer-transparent.
 * Allow its exposed blank area and its own children, not another node/window.
 * The registry has already checked the live Frame rectangle.
 */
export function isCollectionHostPointExposed(
  frame: Element, canvas: Element, point: SurfacePoint, childNodeIds: readonly string[],
): boolean {
  if (!frame.isConnected || !canvas.isConnected) return false;
  const doc = frame.ownerDocument;
  if (typeof doc.elementsFromPoint !== 'function') return true;
  const front = doc.elementsFromPoint(point.x, point.y).find((element) =>
    element.closest('.react-flow__node.dragging,[data-lcos-native-drop-source],[data-lcos-native-drop-pending]') === null);
  if (!front || !canvas.contains(front)) return false;
  const node = front.closest('.react-flow__node');
  if (node) return node === frame || childNodeIds.includes(node.getAttribute('data-id') ?? '');
  // Do not treat an in-canvas popover/toolbar as the blank stage below it.
  return front.matches('.react-flow,.react-flow__pane,.react-flow__viewport');
}
