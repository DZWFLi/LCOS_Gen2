import type { WarehouseItemV1 } from '@local-creative-os/contracts';

export function isWorkflowCardItem(item: WarehouseItemV1): boolean {
  return item.kind === 'workflow';
}
