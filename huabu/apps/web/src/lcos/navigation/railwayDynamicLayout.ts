import type { RailwayDestinationV1 } from '@local-creative-os/contracts';

const RAIL_ITEM_PITCH = 42;
const RAIL_ISLAND_CHROME = 10;
const RAIL_MIN_ITEMS = 1;

export interface RailwayDynamicLayoutInput {
  readonly safeHeight: number;
  readonly reservedHeight: number;
}

/**
 * Presentation-only capacity. The Rail grows with the current safe region; it
 * never writes canonical order or camera state. The result is intentionally a
 * count, not a second layout owner.
 */
export function railwayDynamicCapacity(input: RailwayDynamicLayoutInput): number {
  const available = Math.max(52, input.safeHeight - Math.max(0, input.reservedHeight));
  return Math.max(RAIL_MIN_ITEMS, Math.floor((available - RAIL_ISLAND_CHROME) / RAIL_ITEM_PITCH));
}

/** Keep canonical order, but keep the active worksite discoverable when it would overflow. */
export function railwayVisibleDestinations(
  destinations: readonly RailwayDestinationV1[],
  capacity: number,
  activeWorkspaceId?: string,
): readonly RailwayDestinationV1[] {
  if (destinations.length <= capacity) return destinations;
  const count = Math.max(RAIL_MIN_ITEMS, capacity);
  const visible = destinations.slice(0, count);
  if (!activeWorkspaceId) return visible;
  const active = destinations.find((item) => item.workspaceId === activeWorkspaceId);
  if (!active || visible.some((item) => item.key === active.key)) return visible;
  return [...visible.slice(0, Math.max(0, count - 1)), active];
}

export function railwayHiddenDestinations(
  destinations: readonly RailwayDestinationV1[],
  visible: readonly RailwayDestinationV1[],
): readonly RailwayDestinationV1[] {
  const visibleKeys = new Set(visible.map((item) => item.key));
  return destinations.filter((item) => !visibleKeys.has(item.key));
}

export function railwayDropGestureActive(status: string): boolean {
  return status !== 'idle' && status !== 'failed';
}
