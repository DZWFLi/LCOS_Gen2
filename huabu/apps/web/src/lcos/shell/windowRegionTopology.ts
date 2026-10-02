import type { ProfessionalRectV1 } from '@local-creative-os/web-gen2';

export interface LcosWindowGroup {
  readonly id: string;
  readonly windowIds: readonly string[];
  readonly activeWindowId: string;
}
export type LcosWindowRegionLayout = 'floating' | 'docked-right';
export type LcosReaderSplitDirection = 'horizontal' | 'vertical';
export interface LcosWindowRegion {
  readonly id: string;
  readonly layout: LcosWindowRegionLayout;
  /** The sole membership owner; no flat region member list is stored alongside it. */
  readonly groups: readonly LcosWindowGroup[];
  readonly activeGroupId: string;
  readonly splitDirection?: LcosReaderSplitDirection;
  readonly splitRatio?: number;
  readonly rect?: ProfessionalRectV1;
  readonly dockWidth?: number;
}
/** Input-only compatibility for an existing same-tab session. It is never saved alongside groups. */
export interface LegacyWindowRegion {
  readonly id: string;
  readonly layout: LcosWindowRegionLayout;
  readonly windowIds: readonly string[];
  readonly activeWindowId: string;
  readonly rect?: ProfessionalRectV1;
  readonly dockWidth?: number;
}
export type WindowRegionInput = LcosWindowRegion | LegacyWindowRegion;
export function normalizeWindowRegion(region: WindowRegionInput): LcosWindowRegion {
  if ('groups' in region) return region;
  const { windowIds, activeWindowId, ...geometry } = region;
  return { ...createWindowRegion(region.id, windowIds, activeWindowId), ...geometry };
}
export function windowIdsForRegion(region: WindowRegionInput | undefined): readonly string[] {
  return region === undefined ? [] : 'groups' in region ? region.groups.flatMap((group) => group.windowIds) : region.windowIds;
}
export function activeWindowIdForRegion(region: WindowRegionInput | undefined): string | undefined {
  if (region === undefined) return undefined;
  if (!('groups' in region)) return region.activeWindowId;
  return (region.groups.find((group) => group.id === region.activeGroupId) ?? region.groups[0])?.activeWindowId;
}
export function createWindowRegion(id: string, windowIds: readonly string[], activeWindowId: string): LcosWindowRegion {
  const groupId = `group-${windowIds[0] ?? activeWindowId}`;
  return { id, layout: 'floating', groups: [{ id: groupId, windowIds, activeWindowId }], activeGroupId: groupId };
}
export function activateRegionWindow(region: LcosWindowRegion, windowId: string): LcosWindowRegion {
  const owner = region.groups.find((group) => group.windowIds.includes(windowId));
  if (!owner || (owner.activeWindowId === windowId && region.activeGroupId === owner.id)) return region;
  return { ...region, activeGroupId: owner.id, groups: region.groups.map((group) => group === owner ? { ...group, activeWindowId: windowId } : group) };
}
export function removeRegionWindow(region: LcosWindowRegion, windowId: string): LcosWindowRegion | undefined {
  if (!windowIdsForRegion(region).includes(windowId)) return region;
  const groups = region.groups.flatMap((group) => {
    if (!group.windowIds.includes(windowId)) return [group];
    const windowIds = group.windowIds.filter((id) => id !== windowId);
    const activeWindowId = group.activeWindowId === windowId ? windowIds.at(-1) : group.activeWindowId;
    return activeWindowId === undefined ? [] : [{ ...group, windowIds, activeWindowId }];
  });
  const activeGroup = groups.find((group) => group.id === region.activeGroupId) ?? groups.at(-1);
  if (activeGroup === undefined) return undefined;
  const collapsed = groups.length < 2
    ? (({ splitDirection: _direction, splitRatio: _ratio, ...rest }) => rest)(region)
    : region;
  return { ...collapsed, groups, activeGroupId: activeGroup.id };
}
export function splitRegionGroup(region: LcosWindowRegion, windowId: string, direction: LcosReaderSplitDirection): LcosWindowRegion {
  if (region.groups.length !== 1) return region;
  const group = region.groups[0];
  if (!group || group.windowIds.length < 2 || !group.windowIds.includes(windowId)) return region;
  const remaining = removeRegionWindow(region, windowId);
  if (!remaining) return region;
  const groupId = `group-${windowId}` === group.id ? `${group.id}-split` : `group-${windowId}`;
  return { ...remaining, groups: [...remaining.groups, { id: groupId, windowIds: [windowId], activeWindowId: windowId }], activeGroupId: groupId, splitDirection: direction, splitRatio: 0.5 };
}
export function mergeRegionGroups(region: LcosWindowRegion): LcosWindowRegion {
  const first = region.groups[0]; const activeWindowId = activeWindowIdForRegion(region);
  if (!first || !activeWindowId || region.groups.length < 2) return region;
  const { splitDirection: _direction, splitRatio: _ratio, ...collapsed } = region;
  return { ...collapsed, groups: [{ ...first, windowIds: windowIdsForRegion(region), activeWindowId }], activeGroupId: first.id };
}
export function reorderRegionWindow(region: LcosWindowRegion, windowId: string, offset: -1 | 1): LcosWindowRegion {
  const group = region.groups.find((candidate) => candidate.windowIds.includes(windowId));
  if (!group) return region;
  const from = group.windowIds.indexOf(windowId); const to = from + offset;
  if (to < 0 || to >= group.windowIds.length) return region;
  const windowIds = [...group.windowIds]; windowIds.splice(from, 1); windowIds.splice(to, 0, windowId);
  return { ...region, groups: region.groups.map((candidate) => candidate === group ? { ...group, windowIds } : candidate) };
}
export function moveRegionWindow(region: LcosWindowRegion, windowId: string, targetGroupId: string): LcosWindowRegion {
  const target = region.groups.find((group) => group.id === targetGroupId);
  if (!target || target.windowIds.includes(windowId) || !windowIdsForRegion(region).includes(windowId)) return region;
  const remaining = removeRegionWindow(region, windowId);
  if (!remaining) return region;
  return { ...remaining, activeGroupId: targetGroupId, groups: remaining.groups.map((group) => group.id === targetGroupId
    ? { ...group, windowIds: [...group.windowIds, windowId], activeWindowId: windowId } : group) };
}

/** A tab position is a real sibling id, not an index from an earlier render.
 * null means the end of this group; undefined is handled by the caller as no reorder.
 */
export function reorderRegionWindowBefore(region: LcosWindowRegion, windowId: string, beforeId: string | null): LcosWindowRegion {
  const owner = region.groups.find((group) => group.windowIds.includes(windowId));
  if (!owner || beforeId === windowId || beforeId !== null && !owner.windowIds.includes(beforeId)) return region;
  const windowIds = owner.windowIds.filter((id) => id !== windowId);
  windowIds.splice(beforeId === null ? windowIds.length : windowIds.indexOf(beforeId), 0, windowId);
  if (windowIds.every((id, index) => id === owner.windowIds[index])) return region;
  return { ...region, groups: region.groups.map((group) => group === owner ? { ...group, windowIds } : group) };
}
