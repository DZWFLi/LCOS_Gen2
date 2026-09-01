import type { PresentationEntityRefV0 } from './presentations.js'

/**
 * B0 Selection Contract.
 *
 * Selection is ephemeral, Surface-local interaction state. It is not Project
 * membership and never expands aggregate membership implicitly. Selecting a
 * Collection/Context/Workflow ref means selecting that aggregate entity only.
 * Consumers that want its members must request/resolve them explicitly.
 */
export interface SurfaceSelectionV0 {
  readonly schemaVersion: 0
  readonly projectId: string
  readonly surfaceId: string
  readonly entityRefs: readonly PresentationEntityRefV0[]
  readonly anchorRef?: PresentationEntityRefV0
  readonly updatedAt: string
}

export function normalizeSurfaceSelectionV0(input: SurfaceSelectionV0): SurfaceSelectionV0 {
  const seen = new Set<string>()
  const entityRefs = input.entityRefs.filter((ref) => {
    const key = `${ref.type}:${ref.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const anchor = input.anchorRef
  const normalizedAnchor = anchor && entityRefs.some((ref) => ref.type === anchor.type && ref.id === anchor.id)
    ? anchor
    : entityRefs[entityRefs.length - 1]
  return {
    ...input,
    entityRefs,
    ...(normalizedAnchor ? { anchorRef: normalizedAnchor } : {}),
  }
}
