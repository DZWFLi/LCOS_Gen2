// LCOS Gen2 boundary entry.
// Huabu = Spatial Truth (owned by Huabu Space persistence / RFS).
// LCOS Core = Domain Truth (owned by Local Core).
// Gen2 only provides a thin glue: Http client + RFS client + ProjectionBinding +
// projection adapters. No surface/owner/projection runtime. No geometry in Core.

export { HttpClient, HttpError } from './backend/client.js';
export type { HttpClientConfig, RequestOptions } from './backend/client.js';

export { HuabuRfsClient } from './spatial/huabuRfsClient.js';
export type {
  RfsConfig,
  RfsQuery,
  RfsCommand,
  RfsExecuteResponse,
  RfsCapabilitiesResponse,
  RfsQueryResponse,
} from './spatial/huabuRfsClient.js';

export {
  ProjectionBindingRegistry,
  MemoryBindingStore,
  bindingToNodeMeta,
  nodeMetaToBinding,
  entityKey,
} from './spatial/projectionBinding.js';
export type { ProjectionBinding, EntityType, BindingStore } from './spatial/projectionBinding.js';

export { ProjectToSpaceProjection, huabuNodeTypeFor } from './spatial/projectToSpaceProjection.js';
export type { ArtifactProjectionSource, ArtifactKind } from './spatial/projectToSpaceProjection.js';

export { RelationProjection } from './spatial/relationProjection.js';
export type { RelationKind, SemanticRelation, ConnectGesture, CoreRelationWriter, CoreEntityRef } from './spatial/relationProjection.js';

export type { NodeType, HuabuNode, HuabuEdge } from './spatial/types.js';
