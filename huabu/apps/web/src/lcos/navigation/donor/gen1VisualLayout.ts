/** Selective lift from DZWFLi/LCOS-local-creativeOS@3e99769:
 * apps/web/src/features/canvas/canvasVisualGeometry.ts (visible body/grid)
 * apps/web/src/features/layout/layoutGeometry.ts (collision repair).
 * Only imports and the structural input types are adapted; no G1 store/camera.
 */
export interface VisualLayoutNode {
  readonly id: string; readonly x: number; readonly y: number;
  readonly width: number; readonly height: number;
  readonly entityKind?: string; readonly kind?: string; readonly positionLocked?: boolean;
}
interface LayoutPosition { readonly id: string; readonly x: number; readonly y: number }
interface LayoutNodeInput extends LayoutPosition { readonly width: number; readonly height: number; readonly pinned?: boolean }
interface Rect { x: number; y: number; width: number; height: number; id?: string }
interface VisualInsets { left: number; right: number; top: number; bottom: number }

export function nodeVisualInsets(node: VisualLayoutNode): VisualInsets {
  if (node.entityKind === 'collection') return { left: 10, right: 12, top: 18, bottom: 24 }
  if (node.entityKind === 'context' || node.entityKind === 'workflow' || node.entityKind === 'workspace') return { left: 8, right: 8, top: 10, bottom: 18 }
  if (node.kind === 'note') return { left: 6, right: 6, top: 6, bottom: 18 }
  return { left: 7, right: 7, top: 7, bottom: 18 }
}

export function nodeVisualBounds(node: VisualLayoutNode, position: Pick<VisualLayoutNode, 'x' | 'y'> = node) {
  const inset = nodeVisualInsets(node)
  return {
    x: position.x - inset.left,
    y: position.y - inset.top,
    width: node.width + inset.left + inset.right,
    height: node.height + inset.top + inset.bottom,
  }
}
function visualInputs(nodes: readonly VisualLayoutNode[]): LayoutNodeInput[] {
  return nodes.map((node) => {
    const bounds = nodeVisualBounds(node)
    return { id: node.id, ...bounds, pinned: Boolean(node.positionLocked) }
  })
}
function modelPositionFromVisual(node: VisualLayoutNode, point: { x: number; y: number }): LayoutPosition {
  const inset = nodeVisualInsets(node)
  return { id: node.id, x: point.x + inset.left, y: point.y + inset.top }
}

export function layoutVisualGrid(
  nodes: readonly VisualLayoutNode[],
  origin: { x: number; y: number },
  gapX = 30,
  gapY = 26,
): LayoutPosition[] {
  if (!nodes.length) return []
  const ordered = [...nodes].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const bodies = ordered.map((node) => ({ node, bounds: nodeVisualBounds(node) }))
  const totalArea = bodies.reduce((sum, item) => sum + item.bounds.width * item.bounds.height, 0)
  const widest = Math.max(...bodies.map((item) => item.bounds.width), 180)
  const targetWidth = Math.max(widest * 2 + gapX, Math.min(1500, Math.sqrt(totalArea) * 1.65))
  const visualPositions: LayoutPosition[] = []
  let cursorX = origin.x
  let cursorY = origin.y
  let rowHeight = 0
  for (const { node, bounds } of bodies) {
    if (node.positionLocked) {
      visualPositions.push({ id: node.id, x: bounds.x, y: bounds.y })
      continue
    }
    if (cursorX > origin.x && cursorX + bounds.width > origin.x + targetWidth) {
      cursorX = origin.x
      cursorY += rowHeight + gapY
      rowHeight = 0
    }
    visualPositions.push({ id: node.id, x: cursorX, y: cursorY })
    cursorX += bounds.width + gapX
    rowHeight = Math.max(rowHeight, bounds.height)
  }
  const repaired = removeLayoutOverlaps(visualInputs(nodes), visualPositions, Math.min(gapX, gapY))
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return repaired.flatMap((point) => {
    const node = byId.get(point.id)
    return node ? [modelPositionFromVisual(node, point)] : []
  })
}

function overlaps(a: Rect, b: Rect, gap: number) {
  return !(a.x + a.width + gap <= b.x || b.x + b.width + gap <= a.x || a.y + a.height + gap <= b.y || b.y + b.height + gap <= a.y)
}

/** Deterministic local collision repair. Pinned/manual anchors are immutable obstacles. */
export function removeLayoutOverlaps(nodes: readonly LayoutNodeInput[], positions: readonly LayoutPosition[], gap = 28): LayoutPosition[] {
  const positionById = new Map(positions.map((item) => [item.id, { ...item }]))
  const ordered = [...nodes].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const cellSize = Math.max(120, Math.min(360, Math.max(...nodes.map((node) => Math.max(node.width, node.height)), 120) + gap))
  const grid = new Map<string, Rect[]>()
  const cellRange = (rect: Rect) => ({
    left: Math.floor((rect.x - gap) / cellSize),
    right: Math.floor((rect.x + rect.width + gap) / cellSize),
    top: Math.floor((rect.y - gap) / cellSize),
    bottom: Math.floor((rect.y + rect.height + gap) / cellSize),
  })
  const nearby = (rect: Rect) => {
    const range = cellRange(rect), seen = new Set<Rect>(), result: Rect[] = []
    for (let x = range.left; x <= range.right; x += 1) for (let y = range.top; y <= range.bottom; y += 1) {
      grid.get(`${x}:${y}`)?.forEach((item) => { if (!seen.has(item)) { seen.add(item); result.push(item) } })
    }
    return result
  }
  const occupy = (rect: Rect) => {
    const range = cellRange(rect)
    for (let x = range.left; x <= range.right; x += 1) for (let y = range.top; y <= range.bottom; y += 1) {
      const key = `${x}:${y}`
      grid.set(key, [...(grid.get(key) ?? []), rect])
    }
  }
  ordered.forEach((node) => {
    const source = positionById.get(node.id) ?? { id: node.id, x: node.x, y: node.y }
    if (node.pinned) {
      const rect = { id: node.id, x: node.x, y: node.y, width: node.width, height: node.height }
      occupy(rect)
      positionById.set(node.id, { id: node.id, x: node.x, y: node.y })
      return
    }
    let x = source.x
    let y = source.y
    let guard = 0
    while (nearby({ x, y, width: node.width, height: node.height }).some((item) => overlaps({ x, y, width: node.width, height: node.height }, item, gap)) && guard < 160) {
      const stepX = Math.max(42, Math.min(110, node.width * .42))
      const stepY = Math.max(36, Math.min(90, node.height * .72))
      if (guard % 3 === 2) { x = source.x; y += stepY }
      else x += stepX
      guard += 1
    }
    positionById.set(node.id, { id: node.id, x, y })
    occupy({ id: node.id, x, y, width: node.width, height: node.height })
  })
  return nodes.map((node) => positionById.get(node.id) ?? { id: node.id, x: node.x, y: node.y })
}
