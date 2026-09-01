// Relation projection — the MOST important special boundary.
// Core Relation is canonical (semantics/business truth); Huabu Edge is ONLY a
// spatial projection of that relation. Creating a semantic relation ALWAYS goes
// through Core first; Huabu Edge is projected afterwards. The real Huabu edgeId
// (server-assigned) is captured and persisted in the relation<->edge binding.

import { HuabuRfsClient } from './huabuRfsClient.js';
import { ProjectionBindingRegistry } from './projectionBinding.js';
import type { EdgeStyle } from './types.js';

export type RelationKind = 'references' | 'derived-from' | 'revises' | 'depends-on' | 'uses' | 'produced-by';

export interface CoreEntityRef {
  entityType: 'artifact' | 'conversation' | 'skill' | 'run';
  entityId: string;
}

export interface SemanticRelation {
  id: string;
  kind: RelationKind;
  from: CoreEntityRef;
  to: CoreEntityRef;
}

export interface CoreRelationWriteInput {
  kind: RelationKind;
  from: CoreEntityRef;
  to: CoreEntityRef;
}

export interface CoreRelationWriter {
  createRelation(input: CoreRelationWriteInput): Promise<{ id: string }>;
  deleteRelation(relationId: string): Promise<void>;
}

export interface NodeBindingResolver {
  (nodeId: string): { entityType: CoreEntityRef['entityType']; entityId: string } | undefined;
}

export class RelationProjection {
  constructor(
    private readonly rfs: HuabuRfsClient,
    private readonly core: CoreRelationWriter,
    private readonly bindings: ProjectionBindingRegistry,
    private readonly projectId: string,
  ) {}

  /**
   * Huabu connect intent -> Core createRelation -> RFS CONNECT_NODES -> capture
   * real edgeId -> persist relation<->edge binding.
   * Core write is definitive: if Core rejects, no Edge is created.
   */
  async onConnectGesture(
    gesture: { sourceNodeId: string; targetNodeId: string; label?: string },
    resolver: NodeBindingResolver,
  ): Promise<{ relationId: string; edgeId: string }> {
    const source = resolver(gesture.sourceNodeId);
    const target = resolver(gesture.targetNodeId);
    if (!source || !target) {
      throw new Error('Cannot resolve a binding for one endpoint of the connect gesture');
    }
    const kind = (gesture.label as RelationKind | undefined) ?? 'references';

    // 1) Core is canonical -> must succeed first.
    const relation = await this.core.createRelation({ kind, from: source, to: target });

    // 2) Project to Huabu Edge; capture the server-assigned edgeId.
    const response = await this.rfs.execute([
      { type: 'CONNECT_NODES', edges: [{ source: gesture.sourceNodeId, target: gesture.targetNodeId, style: this.edgeStyleFor(kind) }] },
    ]);
    const edgeId = HuabuRfsClient.firstCreatedEdgeId(response);
    if (!edgeId) {
      // RFS write failed: Core relation is still canonical -> mark projection
      // missing; a reconciliation pass repairs it.
      throw new Error(`CONNECT_NODES did not return an edge id for relation ${relation.id}`);
    }

    // 3) Persist relation<->edge binding.
    await this.bindings.bind({
      projectId: this.projectId,
      canvasId: this.rfs.config.canvasId,
      spatialKind: 'edge',
      spatialId: edgeId,
      entityType: 'relation',
      entityId: relation.id,
    });

    return { relationId: relation.id, edgeId };
  }

  /** Project an already-existing Core Relation into a Huabu Edge (Core -> Huabu). */
  async projectRelation(relation: SemanticRelation, fromNodeId: string, toNodeId: string): Promise<void> {
    const response = await this.rfs.execute([
      { type: 'CONNECT_NODES', edges: [{ source: fromNodeId, target: toNodeId, style: this.edgeStyleFor(relation.kind) }] },
    ]);
    const edgeId = HuabuRfsClient.firstCreatedEdgeId(response);
    if (!edgeId) return;
    await this.bindings.bind({
      projectId: this.projectId,
      canvasId: this.rfs.config.canvasId,
      spatialKind: 'edge',
      spatialId: edgeId,
      entityType: 'relation',
      entityId: relation.id,
    });
  }

  /** Delete relation from Core AND its Edge projection; repair both sides. */
  async deleteRelation(relationId: string): Promise<void> {
    const edgeBinding = await this.bindings.findEdge(this.projectId, this.rfs.config.canvasId, relationId);
    await this.core.deleteRelation(relationId);
    if (edgeBinding) {
      await this.rfs.execute([{ type: 'DISCONNECT_EDGES', edges: [edgeBinding.spatialId] }]);
      await this.bindings.unbindByEntity(this.projectId, this.rfs.config.canvasId, 'edge', 'relation', relationId);
    }
  }

  private edgeStyleFor(kind: RelationKind): EdgeStyle {
    return { lineType: 'bezier', direction: 'forward', label: kind };
  }
}
