import type { AssemblySourceRefV1, RailwayDestinationV1 } from '@local-creative-os/contracts';
import type { DropPayload, SemanticDropState } from '@local-creative-os/web-gen2';

import { useLcosDropStore } from '../lcosDropState';
import { acquireDrop } from '../lcosRecognizers';
import { ASSEMBLY_DRAG_MIME } from './nativeAssemblyDrop';

type AssemblyDropPayload = Extract<DropPayload, { readonly kind: 'assembly' }>;

/** A canonical project aggregate projected into Railway's source row. */
export interface RailwayAggregateSourceSnapshot {
  readonly projectId: string;
  /** Exact Core source reference supplied by the canonical Railway projection. */
  readonly sourceRef: AssemblySourceRefV1;
  /** Exact project entity identity represented by this aggregate. */
  readonly entityRef: { readonly type: 'workspace' | 'scope' | 'collection'; readonly id: string };
  readonly label: string;
  readonly available: boolean;
}

export interface RailwayAssemblyDragStartEvent {
  readonly dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData'>;
  preventDefault(): void;
}

function pending(state: SemanticDropState): boolean {
  return state.status === 'tracking' || state.status === 'dwell' || state.status === 'preview';
}

function canonicalWorksiteId(destination: RailwayDestinationV1, projectId: string): string | undefined {
  const ref = destination.ref;
  return destination.role === 'worksite' && ref.kind === 'worksite' && projectId.trim()
    && ref.projectId === projectId && ref.worksiteId.trim() && destination.workspaceId === ref.worksiteId
    ? ref.worksiteId : undefined;
}

function aggregateIdentityMatches(source: RailwayAggregateSourceSnapshot): boolean {
  if (!source.sourceRef.id.trim() || source.entityRef.id !== source.sourceRef.id) return false;
  if (source.sourceRef.kind === 'scene') return source.entityRef.type === 'workspace';
  if (source.sourceRef.kind === 'context' || source.sourceRef.kind === 'workflow') return source.entityRef.type === 'scope';
  if (source.sourceRef.kind === 'collection') return source.entityRef.type === 'collection';
  return false;
}

/** Freeze one canonical aggregate reference; members are never expanded. */
export function railwayAggregatePayload(
  source: RailwayAggregateSourceSnapshot,
  activeProjectId: string,
): AssemblyDropPayload | undefined {
  if (!source.available || !activeProjectId.trim() || source.projectId !== activeProjectId || !aggregateIdentityMatches(source)) return undefined;
  const sourceRef = Object.freeze({ ...source.sourceRef });
  const entityRef = Object.freeze({ ...source.entityRef });
  const reference = Object.freeze({ entityType: entityRef.type, entityId: entityRef.id, displayLabel: source.label });
  return Object.freeze({ kind: 'assembly' as const, itemId: sourceRef.id, sourceRef, entityRef, reference });
}

/** Map only an exact, current Railway worksite row to its aggregate identity. */
export function railwayAssemblyPayload(
  destination: RailwayDestinationV1,
  projectId: string,
): AssemblyDropPayload | undefined {
  if (!destination.available || !projectId.trim() || destination.ref.projectId !== projectId) return undefined;
  if (destination.role === 'worksite' && destination.ref.kind === 'worksite') {
    const id = canonicalWorksiteId(destination, projectId);
    if (!id) return undefined;
    return railwayAggregatePayload({ projectId, sourceRef: destination.sourceRef ?? { kind: 'scene', id },
      entityRef: { type: 'workspace', id }, label: destination.label, available: true }, projectId);
  }
  if (destination.role === 'spatial' && destination.ref.kind === 'spatial' && destination.sourceRef
    && destination.ref.entityId === destination.sourceRef.id) {
    const entityRef = destination.ref.entityType === 'collection'
      ? { type: 'collection' as const, id: destination.ref.entityId }
      : { type: 'scope' as const, id: destination.ref.entityId };
    return railwayAggregatePayload({ projectId, sourceRef: destination.sourceRef, entityRef,
      label: destination.label, available: true }, projectId);
  }
  return undefined;
}

/** Start through the existing MIME/store owner; no new drag transport or state. */
export function beginRailwayAssemblyDrop(
  event: RailwayAssemblyDragStartEvent,
  destination: RailwayDestinationV1,
  projectId: string,
): boolean {
  const store = useLcosDropStore.getState();
  const payload = railwayAssemblyPayload(destination, projectId);
  if (!payload || store.state.status === 'committing') {
    event.preventDefault();
    return false;
  }

  try {
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(ASSEMBLY_DRAG_MIME, JSON.stringify({
      itemId: payload.itemId,
      sourceRef: payload.sourceRef,
      entityRef: payload.entityRef,
      reference: payload.reference,
    }));
  } catch {
    event.preventDefault();
    return false;
  }

  acquireDrop(payload);
  const current = useLcosDropStore.getState().state;
  return 'payload' in current && current.payload === payload;
}

/** Dragend only clears the same Railway source while its gesture is uncommitted. */
export function cancelRailwayAssemblyDrop(
  destination: RailwayDestinationV1,
  projectId: string,
): boolean {
  const id = canonicalWorksiteId(destination, projectId);
  if (!id) return false;
  const store = useLcosDropStore.getState();
  const state = store.state;
  if (!pending(state) || !('payload' in state) || state.payload.kind !== 'assembly'
    || state.payload.itemId !== id || state.payload.sourceRef.kind !== 'scene'
    || state.payload.sourceRef.id !== id
    || state.payload.entityRef?.type !== 'workspace' || state.payload.entityRef.id !== id) return false;
  store.cancel();
  return true;
}
