import type { SemanticDropState } from '@local-creative-os/web-gen2';
import type { DropIntent, DropResolution } from './dropTypes';

function sameReceiver(before: DropIntent, after: DropIntent): boolean {
  if (before.kind !== after.kind || before.targetId !== after.targetId) return false;
  if (before.kind === 'assembly-apply' && after.kind === 'assembly-apply') {
    if (before.railwayReceive !== after.railwayReceive || before.portalReceive !== after.portalReceive) return false;
    if ((before.railwayReceive || before.portalReceive) && (JSON.stringify(before.railwayDestinationRef) !== JSON.stringify(after.railwayDestinationRef)
      || before.railwayOrderVersion !== after.railwayOrderVersion || before.railwayCanvasId !== after.railwayCanvasId)) return false;
    return before.targetRef.kind === after.targetRef.kind
      && ('id' in before.targetRef ? before.targetRef.id : undefined)
        === ('id' in after.targetRef ? after.targetRef.id : undefined);
  }
  if (before.kind === 'collection-membership' && after.kind === 'collection-membership') return before.collectionId === after.collectionId;
  if (before.kind === 'collaboration-reference' && after.kind === 'collaboration-reference') return before.conversationId === after.conversationId;
  if (before.kind === 'composer-reference' && after.kind === 'composer-reference')
    return before.inputKey === after.inputKey && before.intent === after.intent;
  if (before.kind === 'external-import' && after.kind === 'external-import') return before.owner === after.owner;
  return true;
}

/** Do not silently switch receivers between the last visible preview and release.
 * Re-hit-testing may reject a vanished/retargeted destination, not reinterpret
 * that drop as a successful background apply. A later dragover can preview a new target.
 */
export function canCommitDropRelease(
  before: { readonly state: SemanticDropState; readonly resolution: DropResolution | null },
  after: { readonly state: SemanticDropState; readonly resolution: DropResolution | null },
): boolean {
  if (after.state.status !== 'preview' || after.resolution?.status !== 'ready'
    || after.state.destination.targetId !== after.resolution.intent.targetId) return false;
  if ('payload' in before.state && before.state.payload !== after.state.payload) return false;
  if (before.state.status !== 'preview') return true;
  return before.state.destination.targetId === after.state.destination.targetId
    && before.resolution?.status === 'ready'
    && sameReceiver(before.resolution.intent, after.resolution.intent);
}
