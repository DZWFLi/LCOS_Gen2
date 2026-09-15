// Canonical Assembly source identity shared by button and drag entry points.
// The read-model row id is not inferred from its title or visual family.

import type {
  AssemblySourceRefV1,
  WarehouseItemV1,
} from '@local-creative-os/contracts';

export function assemblySourceRefOf(
  item: WarehouseItemV1,
): AssemblySourceRefV1 {
  switch (item.kind) {
    case 'artifact':
      return {
        kind: 'artifactView',
        id: item.entityRef.viewId ?? item.entityRef.id,
      };
    case 'note':
    case 'resource':
    case 'conversation':
    case 'context':
    case 'workflow':
    case 'scene':
    case 'collection':
      return { kind: item.kind, id: item.entityRef.id };
  }
}
