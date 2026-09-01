// Relation projection — the MOST important special boundary.
// Core Relation is canonical (semantics/business truth); Huabu Edge is ONLY a
// spatial projection of that relation. Creating a semantic relation must go
// through Core; Huabu connect gesture is the trigger, never the truth.

import { HuabuRfsClient } from './huabuRfsClient.js';
import { ProjectionBinding } from './projectionBinding.js';

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

export interface CoreRelationWriter {
  createRelation(input: { kind: RelationKind; from: CoreEntityRef; to: CoreEntityRef }): Promise<{ id: string }>;
  deleteRelation(relationId: string): Promise<void>;
}

export interface ConnectGesture {
  sourceNodeId: string;
  targetNodeId: string;
  label?: string;
}

export interface NodeBindingResolver {
  (nodeId: string): ProjectionBinding | undefined;
}

export interface RelationProjectionOptions {
  edgeIdPrefix?: string;
}

export class RelationProjection {
  constructor(
    private readonly rfs: HuabuRfsClient,
    private readonly core: CoreRelationWriter,
    private readonly opts: RelationProjectionOptions = {},
  ) {}

  private edgeIdFor(relationId: string): string {
    return `${this.opts.edgeIdPrefix ?? 'edge'}-${relationId}`;
  }

  /** Project an existing Core Relation into a Huabu Edge (Core -> Huabu). */
  async projectRelation(relation: SemanticRelation, fromBinding: ProjectionBinding, toBinding: ProjectionBinding): Promise<void> {
    await this.rfs.execute([
      {
        type: 'CONNECT_NODES',
        connections: [
          {
            source: fromBinding.nodeId,
            target: toBinding.nodeId,
            style: { label: relation.kind, lineType: 'bezier', direction: 'forward' },
          },
        ],
      },
    ]);
  }

  /**
   * Huabu connect gesture -> Core semantic Relation mutation -> then the Edge is
   * already present in Huabu (the gesture created it); we only ensure Core is the
   * canonical truth. NEVER let a pure Huabu CONNECT define a business relation.
   */
  async onConnectGesture(gesture: ConnectGesture, resolver: NodeBindingResolver): Promise<{ relationId: string; edgeId: string }> {
    const source = resolver(gesture.sourceNodeId);
    const target = resolver(gesture.targetNodeId);
    if (!source || !target) {
      throw new Error('Cannot resolve a binding for one endpoint of the connect gesture');
    }
    const kind = (gesture.label as RelationKind | undefined) ?? 'references';
    const relation = await this.core.createRelation({
      kind,
      from: { entityType: source.entityType, entityId: source.entityId },
      to: { entityType: target.entityType, entityId: target.entityId },
    });
    return { relationId: relation.id, edgeId: this.edgeIdFor(relation.id) };
  }

  /** Remove relation from Core and its Edge projection from Huabu. */
  async deleteRelation(relation: SemanticRelation, edgeId?: string): Promise<void> {
    await this.core.deleteRelation(relation.id);
    if (edgeId) {
      await this.rfs.execute([{ type: 'DISCONNECT_EDGES', edgeIds: [edgeId] }]);
    }
  }
}
