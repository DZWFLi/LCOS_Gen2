// Host connect-intent composable: a UI semantic connect (from entity -> to entity,
// kind) becomes a Core Relation FIRST (Core owns id/validation/changeSet via the
// minimal G0.6 POST /projects/:id/relations), THEN a Huabu Edge projection.
// This is the "1 Connect Intent" of the Huabu Host vertical spike.

import type { CoreRelationClient } from '../backend/relations.js';
import type { CoreEntityRef, RelationKind } from '../spatial/relationProjection.js';
import type { ProjectionBinding } from '../spatial/projectionBinding.js';

export interface ConnectIntentDeps {
  core: CoreRelationClient;
  /** Resolve a Core entity to its projected Huabu node id (from the binding). */
  nodeIdFor(entityType: CoreEntityRef['entityType'], entityId: string): Promise<string | undefined>;
  /** Project the relation into an Edge; return the real (server-assigned) edge binding. */
  projectEdge(relation: { id: string; kind: RelationKind; from: CoreEntityRef; to: CoreEntityRef }, fromNodeId: string, toNodeId: string): Promise<ProjectionBinding | undefined>;
}

export interface SemanticConnectResult {
  relationId: string;
  changeSetId: string;
  edgeBinding: ProjectionBinding | undefined;
}

export class ConnectIntentError extends Error {
  readonly code: 'ENDPOINT_UNPROJECTED';
  constructor(message: string) {
    super(message);
    this.name = 'ConnectIntentError';
    this.code = 'ENDPOINT_UNPROJECTED';
  }
}

/**
 * UI intent -> Core Domain mutation -> Huabu Edge projection.
 * - Resolve endpoint node ids; if either endpoint isn't projected yet, fail before
 *   creating a Core relation (don't leave an orphan relation with no spatial path).
 * - Create the Core relation (Core owns id/createdAt/updatedAt/validation/ChangeSet).
 * - Project the Edge; capture the real (server-assigned) edge binding.
 */
export async function connectSemantic(
  projectId: string,
  input: { from: CoreEntityRef; to: CoreEntityRef; kind: RelationKind },
  deps: ConnectIntentDeps,
): Promise<SemanticConnectResult> {
  const fromNodeId = await deps.nodeIdFor(input.from.entityType, input.from.entityId);
  const toNodeId = await deps.nodeIdFor(input.to.entityType, input.to.entityId);
  if (!fromNodeId || !toNodeId) {
    throw new ConnectIntentError(`Endpoint(s) not projected: ${input.from.entityType}:${input.from.entityId} -> ${input.to.entityType}:${input.to.entityId}`);
  }

  const created = await deps.core.createRelation(projectId, {
    sourceEntityType: input.from.entityType,
    sourceEntityId: input.from.entityId,
    targetEntityType: input.to.entityType,
    targetEntityId: input.to.entityId,
    kind: input.kind,
  });

  const edgeBinding = await deps.projectEdge({ id: created.relation.id, kind: input.kind, from: input.from, to: input.to }, fromNodeId, toNodeId);

  return { relationId: created.relation.id, changeSetId: created.changeSetId, edgeBinding };
}
