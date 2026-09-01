// LCOS Gen2 boundary entry.
// Huabu = Spatial Truth (owned by Huabu Space persistence / RFS).
// LCOS Core = Domain Truth (owned by Local Core).
// Gen2 only provides a thin glue: Http client + RFS client + ProjectionBinding +
// projection adapters. No surface/owner/projection runtime. No geometry in Core.

export { HttpClient, HttpError } from './backend/client.js';
export type { HttpClientConfig, RequestOptions, ResponseMode } from './backend/client.js';

export { CoreApiError, coreRequest, coreEnvelope, unwrapCoreValue, toCoreApiError } from './backend/coreTypes.js';
export type { CoreEnvelope, CoreEnvelopeOk, CoreEnvelopeError } from './backend/coreTypes.js';

export { CoreProjectClient } from './backend/projects.js';
export type { ProjectListItem } from './backend/projects.js';

export { CoreArtifactClient } from './backend/artifacts.js';
export type { ArtifactDetailProjection, ArtifactDetailRevision, ArtifactRunRef } from './backend/artifacts.js';

export { CoreRelationClient } from './backend/relations.js';
export type { RelationPutResult, RelationDeleteResult, RelationCreateInput, RelationCreateResult } from './backend/relations.js';

export { CoreSearchClient } from './backend/search.js';
export type { CoreSearchParams, CoreSearchUsedHereTarget } from './backend/search.js';

export { SqliteBindingStore, createProjectionBindingRegistry } from './backend/sqliteBindingStore.js';

export { HuabuRfsClient, RfsContractError } from './spatial/huabuRfsClient.js';
export type { RfsConfig, SpaceQuery, AgentCanvasCommand, CanvasNodeCreateInput, NodeCreateInputByType, CanvasEdgeRef } from './spatial/huabuRfsClient.js';

export { ProjectionBindingRegistry, MemoryBindingStore, FileBindingStore, bindingKey } from './spatial/projectionBinding.js';
export type { ProjectionBinding, EntityType, SpatialKind, BindingStore, FileSystemLike } from './spatial/projectionBinding.js';

export { ProjectToSpaceProjection, huabuNodeTypeFor } from './spatial/projectToSpaceProjection.js';
export type { ArtifactProjectionSource, ArtifactKind } from './spatial/projectToSpaceProjection.js';

export { RelationProjection } from './spatial/relationProjection.js';
export type { RelationKind, SemanticRelation, CoreRelationWriter, CoreEntityRef, NodeBindingResolver } from './spatial/relationProjection.js';

export { ReconciliationRunner } from './spatial/reconciliationRunner.js';
export type { ReconciliationResult, ReconciliationDeps } from './spatial/reconciliationRunner.js';

export {
  HUABU_PROTOCOL_VERSION,
  CANVAS_NODE_TYPES,
  AGENT_CREATABLE_NODE_TYPES,
  NODE_FONT_FAMILIES,
  NODE_FONT_WEIGHTS,
} from './spatial/types.js';
export type {
  CanvasNodeType,
  AgentCreatableNodeType,
  Point,
  NodeSize,
  NodeGeometrySize,
  Geometry,
  EdgeStyle,
  PersistedEdgeStyle,
  AgentRfsEdgeStyle,
  NodeStyle,
  AgentNodeDataPatch,
  Rect,
  SpaceQueryResponse,
  SpaceNodeResult,
  SpaceOutlineResult,
  InspectNodesResult,
  InspectEdgesResult,
  SearchResult,
  SnapshotNodesResult,
  RfsExecuteResponse,
  RfsCapabilitiesResponse,
} from './spatial/types.js';
