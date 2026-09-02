// Reference bridge (Phase A03) — the type + behavior seam the web app needs
// from web-gen2's reference controller, WITHOUT importing the whole Gen2
// boundary (the recognizer/store modules stay tree-shakeable and can run in
// unit tests without the RFS/HTTP machinery).
//
// web-gen2 already exports the pure controller; this module re-exports the
// pieces the web app consumes and adds the `CoreEntityRefLike` view (the
// structural subset the controller actually reads). Structural typing keeps
// this in sync with web-gen2's CoreEntityRef.

import type {
  EntityRefLike as Gen2EntityRefLike,
  ReferenceControllerState as Gen2ReferenceControllerState,
} from '@local-creative-os/web-gen2';

export {
  createReferenceControllerState,
  orderedReferences,
  removeReference,
  sameEntityRef,
  toggleReference,
} from '@local-creative-os/web-gen2';

export type {
  EntityRefLike,
  ReferenceControllerState,
} from '@local-creative-os/web-gen2';

/**
 * Structural view of web-gen2's CoreEntityRef — entityType + entityId is all
 * the reference controller compares (see sameEntityRef). Aliased to the
 * generic controller's EntityRefLike so the Huabu store instantiates
 * ReferenceControllerState<CoreEntityRefLike> (string entityType) without
 * fighting the domain's closed RelationEntityType union.
 */
export type CoreEntityRefLike = Gen2EntityRefLike;

/** Convenience: the controller state instantiated with the local ref shape. */
export type LcosDraftState = Gen2ReferenceControllerState<CoreEntityRefLike>;
