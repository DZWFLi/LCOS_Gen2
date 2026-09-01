import type { SpatialMarkerTargetRefV0 } from './navigation-marker.js'

/** User-authored project color identity. A definition may be reused by many targets. */
export interface ColorPinDefinitionV0 {
  readonly id: string
  readonly projectId: string
  /** CSS-compatible canonical color value. V0 accepts #RRGGBB only. */
  readonly color: string
  readonly label?: string
  readonly createdAt: string
  readonly updatedAt: string
}

/** Many-to-many target ↔ Color Pin relationship. No coordinates are persisted here. */
export interface ColorPinMembershipV0 {
  readonly id: string
  readonly projectId: string
  readonly colorPinId: string
  readonly targetRef: SpatialMarkerTargetRefV0
  readonly createdAt: string
  readonly updatedAt: string
}

export interface ColorPinSnapshotV0 {
  readonly definitions: readonly ColorPinDefinitionV0[]
  readonly memberships: readonly ColorPinMembershipV0[]
}
