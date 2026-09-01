import type { SqliteMetadataRepository } from './metadata-repository.js'

export interface CapturePlacementInput {
  readonly projectId: string
  readonly scopeId: string
  readonly width?: number
  readonly height?: number
  /** 放置意图：new_capture（GUI-3 默认）。 */
  readonly intent?: 'new_capture'
}

const DEFAULT_SIZE = { width: 280, height: 190 }
const DEFAULT_ANCHOR = { x: 180, y: 160 }
const GAP = 24
const MAX_TRIES = 480

function rectsOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): boolean {
  return !(left.x + left.width + GAP <= right.x
    || right.x + right.width + GAP <= left.x
    || left.y + left.height + GAP <= right.y
    || right.y + right.height + GAP <= left.y)
}

/**
 * GUI-3：Capture 不决定像素位置——由 Presentation Placement 决定。
 * preferred zone = 最近 capture 的右下方（cluster anchor）；
 * 碰撞检测 + expanding ring/grid → 第一个空闲矩形；连续放置不重叠。
 */
export class CapturePlacementService {
  constructor(private readonly repository: SqliteMetadataRepository) {}

  place(input: CapturePlacementInput): { x: number; y: number } {
    const width = Math.max(80, Math.min(720, input.width ?? DEFAULT_SIZE.width))
    const height = Math.max(48, Math.min(520, input.height ?? DEFAULT_SIZE.height))
    const graph = this.repository.get(input.projectId)
    const views = graph === undefined
      ? []
      : graph.artifactViews
        .filter((view) => String(view.scopeId) === input.scopeId)
    const occupied = views.map((view) => ({
      x: view.position.x,
      y: view.position.y,
      width: view.size.width,
      height: view.size.height,
    }))
    // cluster anchor：最近一个 capture/视图的右下角；无则默认画布左上。
    const last = views.at(-1)
    const anchor = last === undefined
      ? { x: DEFAULT_ANCHOR.x, y: DEFAULT_ANCHOR.y }
      : { x: last.position.x + last.size.width, y: last.position.y + last.size.height }
    const rowWidth = Math.max(640, anchor.x + 720)
    for (let tryIndex = 0; tryIndex < MAX_TRIES; tryIndex += 1) {
      const ring = Math.floor(tryIndex / 4)
      const slot = tryIndex % 4
      const x = anchor.x + (slot % 2) * (width + GAP) + ring * (width + GAP) * 2
      const y = anchor.y + Math.floor(slot / 2) * (height + GAP) + ring * (height + GAP)
      const candidate = { x, y, width, height }
      if (x + width > rowWidth) continue
      if (!occupied.some((rect) => rectsOverlap(candidate, rect))) {
        return { x, y }
      }
    }
    // 理论不可达（occupied 有限、grid 无限扩展）；防御性 fallback 也做碰撞检测。
    let fallbackX = DEFAULT_ANCHOR.x
    let fallbackY = DEFAULT_ANCHOR.y
    while (occupied.some((rect) => rectsOverlap({ x: fallbackX, y: fallbackY, width, height }, rect))) {
      fallbackX += width + GAP
      if (fallbackX > rowWidth) { fallbackX = DEFAULT_ANCHOR.x; fallbackY += height + GAP }
    }
    return { x: fallbackX, y: fallbackY }
  }
}
