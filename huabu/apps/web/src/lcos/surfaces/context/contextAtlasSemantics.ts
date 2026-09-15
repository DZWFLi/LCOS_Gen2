import type { WarehouseItemV1 } from '@local-creative-os/contracts';

export interface AtlasEntityRefLike {
  readonly entityId: string;
  readonly entityType: string;
}

export interface AtlasGroup {
  readonly key: string;
  readonly label: string;
  readonly list: readonly WarehouseItemV1[];
}

export function isAtlasItem(item: WarehouseItemV1): boolean {
  return item.kind === 'context' || item.kind === 'collection' || item.kind === 'scene';
}

/** Warehouse 当前没有明确的事情/时间组织字段，不能用 kind 或 updatedAt 伪造组织。 */
export function buildAtlasGroups(items: readonly WarehouseItemV1[]): readonly AtlasGroup[] {
  return items.length === 0 ? [] : [{ key: 'unclassified', label: '未指定组织', list: items }];
}

export function canAtlasLocate(item: WarehouseItemV1, refs: Iterable<AtlasEntityRefLike>): boolean {
  return [...refs].some((ref) => ref.entityId === item.entityRef.id && ref.entityType === item.entityRef.type);
}
