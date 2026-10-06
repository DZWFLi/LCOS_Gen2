import type { AssemblyApplyResultV1, AssemblySourceRefV1, AssemblyTargetRefV1 } from './assembly.js'

/** Railway addresses are canonical references, never canvas IDs or labels. */
export type RailwaySurfaceKindV1 = 'main' | 'context' | 'workflow'
export type RailwayCanonicalRefV1 =
  | { readonly kind: 'surface_root'; readonly projectId: string; readonly surface: RailwaySurfaceKindV1 }
  | { readonly kind: 'worksite'; readonly projectId: string; readonly worksiteId: string }
  | { readonly kind: 'spatial'; readonly projectId: string; readonly entityType: 'collection' | 'scope'; readonly entityId: string }
  | { readonly kind: 'receiver_conversation'; readonly projectId: string; readonly connectedConversationId: string }
export interface RailwayLegacyRefV1 {
  readonly kind: 'legacy'
  readonly projectId: string
  readonly legacyKind: string
  readonly legacyViewId: string
  /** Retained verbatim for explicit migration/removal, not executable identity. */
  readonly raw: unknown
}
export type RailwayStoredRefV1 = RailwayCanonicalRefV1 | RailwayLegacyRefV1
export type RailwayReceiveTargetV1 =
  | { readonly owner: 'collection-membership'; readonly collectionId: string }
  | { readonly owner: 'assembly'; readonly targetRef: AssemblyTargetRefV1 }
export interface RailwayOrderV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly orderedRefs: readonly RailwayStoredRefV1[]
  readonly version: number
  readonly updatedAt: string
}
export interface RailwayDestinationV1 {
  readonly key: string
  readonly ref: RailwayStoredRefV1
  readonly label: string
  readonly role: 'surface' | 'worksite' | 'spatial' | 'receiver' | 'legacy'
  readonly available: boolean
  readonly reason?: string
  readonly surface?: RailwaySurfaceKindV1
  readonly workspaceId?: string
  readonly canvasId?: string
  /** Canonical aggregate identity when the destination itself can be dragged as a source. */
  readonly sourceRef?: AssemblySourceRefV1
  /** Explicit mutation owner; consumers must not infer a route from labels or entity names. */
  readonly receiveTarget?: RailwayReceiveTargetV1
  /** Receiver entries open their existing Work View; they do not change active receiver. */
  readonly accepts: readonly ('artifactView' | 'note')[]
}
export interface RailwaySnapshotV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly order: RailwayOrderV1
  readonly destinations: readonly RailwayDestinationV1[]
  readonly candidates: readonly RailwayDestinationV1[]
  readonly migrationRequired: boolean
}
export interface RailwayReceiveRequestV1 {
  readonly schemaVersion: 1
  readonly projectId: string
  readonly operationId: string
  readonly destination: RailwayCanonicalRefV1
  readonly expectedOrderVersion: number
  readonly expectedCanvasId: string
  readonly sourceCanvasId?: string
  readonly sourceRefs: readonly AssemblySourceRefV1[]
}
/** A Portal targets an existing workspace, independently of its Railway membership.
 * The existing mutation journal still owns receipt/replay; no second transaction store. */
export type PortalReceiveRequestV1 = Omit<RailwayReceiveRequestV1, 'expectedOrderVersion' | 'sourceCanvasId'> & {
  readonly viaPortal: true
  readonly sourceCanvasId: string
}

export interface RailwayReceiveOutcomeV1 {
  readonly status: 'committed'
  readonly operationId: string
  readonly destination: RailwayDestinationV1
  readonly result: AssemblyApplyResultV1
  readonly spatial: { readonly status: 'not_required' }
}
/** Exact structural serialization, not a new persisted identity/hash. */
export function railwayStableKeyV1(ref: RailwayStoredRefV1): string {
  switch (ref.kind) {
    case 'surface_root': return JSON.stringify([ref.kind, ref.projectId, ref.surface])
    case 'worksite': return JSON.stringify([ref.kind, ref.projectId, ref.worksiteId])
    case 'spatial': return JSON.stringify([ref.kind, ref.projectId, ref.entityType, ref.entityId])
    case 'receiver_conversation': return JSON.stringify([ref.kind, ref.projectId, ref.connectedConversationId])
    case 'legacy': return JSON.stringify([ref.kind, ref.projectId, ref.legacyKind, ref.legacyViewId, ref.raw])
  }
}
export function parseRailwayStoredRefV1(value: unknown, projectId: string): RailwayStoredRefV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const r = value as Record<string, unknown>
  if (r.projectId !== projectId) return undefined
  const exact = (keys: string[]) => Object.keys(r).every((key) => keys.includes(key))
  if (r.kind === 'surface_root' && ['main', 'context', 'workflow'].includes(String(r.surface)) && exact(['kind', 'projectId', 'surface']))
    return { kind: r.kind, projectId, surface: r.surface as RailwaySurfaceKindV1 }
  if (r.kind === 'worksite' && typeof r.worksiteId === 'string' && r.worksiteId.trim() && exact(['kind', 'projectId', 'worksiteId']))
    return { kind: r.kind, projectId, worksiteId: r.worksiteId }
  if (r.kind === 'spatial' && (r.entityType === 'collection' || r.entityType === 'scope')
    && typeof r.entityId === 'string' && r.entityId.trim() && exact(['kind', 'projectId', 'entityType', 'entityId']))
    return { kind: r.kind, projectId, entityType: r.entityType, entityId: r.entityId }
  if (r.kind === 'receiver_conversation' && typeof r.connectedConversationId === 'string' && r.connectedConversationId.trim() && exact(['kind', 'projectId', 'connectedConversationId']))
    return { kind: r.kind, projectId, connectedConversationId: r.connectedConversationId }
  if (r.kind === 'legacy' && typeof r.legacyKind === 'string' && typeof r.legacyViewId === 'string' && Object.hasOwn(r, 'raw')
    && exact(['kind', 'projectId', 'legacyKind', 'legacyViewId', 'raw']))
    return { kind: r.kind, projectId, legacyKind: r.legacyKind, legacyViewId: r.legacyViewId, raw: r.raw }
  return undefined
}
