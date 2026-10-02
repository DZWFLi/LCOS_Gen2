import type { WarehouseItemV1 } from '@local-creative-os/contracts';
import type { LcosNodeEntityRef } from '../lcosReferenceState';

/** Reading a material and applying it to a worksite have different eligibility rules. */
export function assemblyDraftReferenceOf(item: WarehouseItemV1): LcosNodeEntityRef | undefined {
  if (item.kind !== 'artifact' || item.entityRef.type !== 'artifact' || !item.entityRef.id.trim()) return undefined;
  if (item.presentedRevisionId?.trim()) return { entityType: 'artifact', entityId: item.entityRef.id,
    revisionId: item.presentedRevisionId, displayLabel: item.title };
  if (item.entityRef.viewId?.trim()) return { entityType: 'artifactView', entityId: item.entityRef.viewId,
    artifactId: item.entityRef.id, displayLabel: item.title };
  return undefined;
}
