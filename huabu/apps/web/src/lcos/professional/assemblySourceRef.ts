import type { LcosNodeEntityRef } from '../lcosReferenceState';
// Canonical Assembly source identity shared by button and drag entry points.
// The read-model row id is not inferred from its title or visual family.

import type {
  AssemblySourceRefV1,
  WarehouseItemV1,
} from '@local-creative-os/contracts';

export function assemblySourceRefOf(
  item: WarehouseItemV1,
): AssemblySourceRefV1 | undefined {
  if (item.entityRef.type !== item.kind || !item.entityRef.id.trim()) return undefined;
  switch (item.kind) {
    case 'artifact':
      return item.entityRef.viewId?.trim() ? { kind: 'artifactView', id: item.entityRef.viewId } : undefined;
    // The existing aggregate Apply service resolves collection as a legacy Scope.
    // A real Collection may be browsed/managed here, but must not advertise that
    // incompatible whole-object Apply. Native Collection membership Drop is separate.
    case 'collection':
      return undefined;
    case 'note':
    case 'resource':
    case 'conversation':
    case 'context':
    case 'workflow':
    case 'scene':
      return { kind: item.kind, id: item.entityRef.id };
  }
}

/** Per-message reference is not AssemblyApply: use an existing address, never materialize on pick. */
export function assemblyDraftReferenceOf(item: WarehouseItemV1): LcosNodeEntityRef | undefined {
  if (item.entityRef.type !== item.kind || !item.entityRef.id.trim()) return undefined;
  if (item.kind === 'artifact') {
    if (item.presentedRevisionId) return { entityType: 'artifact', entityId: item.entityRef.id,
      revisionId: item.presentedRevisionId, ...(item.mimeType ? { mimeType: item.mimeType } : {}), ...(item.entityRef.viewId ? { artifactViewId: item.entityRef.viewId } : {}), displayLabel: item.title };
    if (item.entityRef.viewId) return { entityType: 'artifactView', entityId: item.entityRef.viewId, displayLabel: item.title };
    return undefined;
  }
  if (item.kind === 'scene') return { entityType: 'workspace', entityId: item.entityRef.id, displayLabel: item.title };
  // In particular a ConnectedConversation ID is not a ConversationSession ID.
  // Old notes/resources/skills have different adoption paths; do not guess a scope or session.
  return undefined;
}
