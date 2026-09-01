// Gen2Host — a small typed facade the GUI hosts use. Composes the small Core
// clients (projects/artifacts/relations/search) + Huabu RFS + ProjectionBinding +
// projection adapters + reconciliation. Only exposes what a Work View/Surface
// actually needs (no 199-method monolith). Wires reconciliation into the host
// lifecycle (open / mutation / reconnect) via HostLifecycleReconciler.
//
// Spatial truth stays in Huabu (RFS); domain truth stays in Local Core (HttpClient).
// This file owns no geometry and no second spatial runtime.

import { HttpClient } from '../backend/client.js';
import { CoreProjectClient } from '../backend/projects.js';
import { CoreArtifactClient } from '../backend/artifacts.js';
import { CoreRelationClient } from '../backend/relations.js';
import { CoreSearchClient } from '../backend/search.js';
import { SqliteBindingStore } from '../backend/sqliteBindingStore.js';
import { HuabuRfsClient } from '../spatial/huabuRfsClient.js';
import { ProjectionBindingRegistry } from '../spatial/projectionBinding.js';
import { ProjectToSpaceProjection, type ArtifactProjectionSource } from '../spatial/projectToSpaceProjection.js';
import { RelationProjection, type CoreEntityRef, type CoreRelationWriter, type RelationKind } from '../spatial/relationProjection.js';
import { ReconciliationRunner } from '../spatial/reconciliationRunner.js';
import { HostLifecycleReconciler, type ReconcileTrigger } from './lifecycleReconciler.js';
import { connectSemantic, type SemanticConnectResult } from './hostConnectIntent.js';

export interface Gen2HostDeps {
  /** HttpClient pointed at Local Core (Domain Truth). */
  http: HttpClient;
  /** HuabuRfsClient pointed at a Huabu canvas (Spatial Truth). */
  rfs: HuabuRfsClient;
  projectId: string;
}

export class Gen2Host {
  readonly projects: CoreProjectClient;
  readonly artifacts: CoreArtifactClient;
  readonly relations: CoreRelationClient;
  readonly search: CoreSearchClient;
  readonly bindings: ProjectionBindingRegistry;
  readonly nodeProjector: ProjectToSpaceProjection;
  readonly relationProjector: RelationProjection;
  readonly reconciler: HostLifecycleReconciler;

  private readonly canvasId: string;

  constructor(private readonly deps: Gen2HostDeps) {
    this.canvasId = deps.rfs.config.canvasId;
    this.projects = new CoreProjectClient(deps.http);
    this.artifacts = new CoreArtifactClient(deps.http);
    this.relations = new CoreRelationClient(deps.http);
    this.search = new CoreSearchClient(deps.http);
    this.bindings = new ProjectionBindingRegistry(new SqliteBindingStore(deps.http, deps.projectId));

    this.nodeProjector = new ProjectToSpaceProjection(deps.rfs, this.bindings);

    const writer: CoreRelationWriter = {
      createRelation: async (input) => {
        const created = await this.relations.createRelation(deps.projectId, {
          sourceEntityType: input.from.entityType,
          sourceEntityId: input.from.entityId,
          targetEntityType: input.to.entityType,
          targetEntityId: input.to.entityId,
          kind: input.kind,
        });
        return { id: created.relation.id };
      },
      deleteRelation: async (relationId) => {
        await this.relations.deleteRelation(deps.projectId, relationId);
      },
    };
    this.relationProjector = new RelationProjection(deps.rfs, writer, this.bindings, deps.projectId);

    const runner = new ReconciliationRunner({
      projectId: deps.projectId,
      canvasId: this.canvasId,
      projects: this.projects,
      relations: this.relations,
      nodeProjector: this.nodeProjector,
      relationProjector: this.relationProjector,
      bindings: this.bindings,
    });
    this.reconciler = new HostLifecycleReconciler(runner, deps.projectId);
  }

  /** Resolve a Core entity to its projected Huabu node id (from the binding). */
  async nodeIdFor(entityType: CoreEntityRef['entityType'], entityId: string): Promise<string | undefined> {
    const binding = await this.bindings.findNode(this.deps.projectId, this.canvasId, entityType, entityId);
    return binding?.spatialId;
  }

  /** Project artifacts into Huabu nodes (idempotent, stale-binding repair). */
  async projectArtifacts(sources: ArtifactProjectionSource[]) {
    return this.nodeProjector.projectArtifacts(sources);
  }

  /**
   * UI connect intent -> Core Relation (Core owns id/changeSet) -> Huabu Edge.
   */
  async connect(from: CoreEntityRef, to: CoreEntityRef, kind: RelationKind): Promise<SemanticConnectResult> {
    return connectSemantic(this.deps.projectId, { from, to, kind }, {
      core: this.relations,
      nodeIdFor: this.nodeIdFor.bind(this),
      projectEdge: async (relation, fromNodeId, toNodeId) => {
        await this.relationProjector.reconcileRelationEdge(relation, fromNodeId, toNodeId);
        return this.bindings.findEdge(this.deps.projectId, this.canvasId, relation.id);
      },
    });
  }

  /** Run reconciliation on demand (startup / after a mutation / on reconnect). */
  async reconcile(trigger: ReconcileTrigger): Promise<boolean> {
    return this.reconciler.runNow(trigger);
  }
}
