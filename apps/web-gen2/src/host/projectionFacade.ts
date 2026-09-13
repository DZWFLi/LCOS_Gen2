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
import { CoreConversationClient } from '../backend/conversations.js';
import { CoreAssemblyClient } from '../backend/assembly.js';
import { CoreRailwayClient } from '../backend/railway.js';
import { CoreContinuationClient } from '../backend/continuation.js';
import { CoreDraftClient } from '../backend/drafts.js';
import { CoreCaptureClient } from '../backend/captures.js';
import { CoreConnectorClient } from '../backend/connectors.js';
import { CoreHealthClient } from '../backend/health.js';
import { CoreRunClient } from '../backend/runs.js';
import { CoreArtifactClient } from '../backend/artifacts.js';
import { CoreRelationClient } from '../backend/relations.js';
import { CoreSearchClient } from '../backend/search.js';
import { SqliteBindingStore } from '../backend/sqliteBindingStore.js';
import { HuabuRfsClient } from '../spatial/huabuRfsClient.js';
import { ProjectionBindingRegistry, type EntityType, type ProjectionBinding } from '../spatial/projectionBinding.js';
import { ProjectToSpaceProjection, type ArtifactProjectionSource } from '../spatial/projectToSpaceProjection.js';
import { RelationProjection, type CoreEntityRef, type CoreRelationWriter, type RelationKind } from '../spatial/relationProjection.js';
import { ReconciliationRunner } from '../spatial/reconciliationRunner.js';
import { describeProjectedEntity } from '../presentation/projectedNodeDescriptor.js';
import { HostLifecycleReconciler, type ReconcileTrigger } from './lifecycleReconciler.js';
import { connectSemantic, type SemanticConnectResult } from './hostConnectIntent.js';

import type { ProjectedEntityFacts, ProjectedNodeDescriptor } from '../presentation/projectedNodeDescriptor.js';

export interface Gen2HostDeps {
  /** HttpClient pointed at Local Core (Domain Truth). */
  http: HttpClient;
  /** HuabuRfsClient pointed at a Huabu canvas (Spatial Truth). */
  rfs: HuabuRfsClient;
  projectId: string;
}

export class Gen2Host {
  readonly projectId: string;
  readonly projects: CoreProjectClient;
  readonly artifacts: CoreArtifactClient;
  readonly relations: CoreRelationClient;
  readonly search: CoreSearchClient;
  readonly conversations: CoreConversationClient;
  readonly assembly: CoreAssemblyClient;
  readonly continuations: CoreContinuationClient;
  readonly runs: CoreRunClient;
  readonly drafts: CoreDraftClient;
  readonly captures: CoreCaptureClient;
  readonly connectors: CoreConnectorClient;
  readonly health: CoreHealthClient;
  readonly railway: CoreRailwayClient;
  readonly bindings: ProjectionBindingRegistry;
  readonly nodeProjector: ProjectToSpaceProjection;
  readonly relationProjector: RelationProjection;
  readonly reconciler: HostLifecycleReconciler;

  private readonly canvasId: string;

  constructor(private readonly deps: Gen2HostDeps) {
    this.projectId = deps.projectId;
    this.canvasId = deps.rfs.config.canvasId;
    this.projects = new CoreProjectClient(deps.http);
    this.artifacts = new CoreArtifactClient(deps.http);
    this.relations = new CoreRelationClient(deps.http);
    this.search = new CoreSearchClient(deps.http);
    this.conversations = new CoreConversationClient(deps.http);
    this.assembly = new CoreAssemblyClient(deps.http);
    this.continuations = new CoreContinuationClient(deps.http);
    this.runs = new CoreRunClient(deps.http);
    this.drafts = new CoreDraftClient(deps.http);
    this.captures = new CoreCaptureClient(deps.http);
    this.connectors = new CoreConnectorClient(deps.http);
    this.health = new CoreHealthClient(deps.http);
    this.railway = new CoreRailwayClient(deps.http);
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
  async nodeIdFor(entityType: EntityType, entityId: string): Promise<string | undefined> {
    const binding = await this.bindings.findNode(this.deps.projectId, this.canvasId, entityType, entityId);
    return binding?.spatialId;
  }

  /**
   * Reverse map a Huabu node id back to its Core entity ref (A05 connect seam:
   * the gesture yields node ids; the seam translates them to create a relation).
   */
  async resolveNode(nodeId: string): Promise<{ entityType: CoreEntityRef['entityType']; entityId: string } | undefined> {
    const ref = await this.bindings.findNodeRef(this.deps.projectId, this.canvasId, nodeId);
    if (!ref) return undefined;
    // EntityType is wider than RelationEntityType (adds 'run'); the bindings
    // surface is an approximate project key, so narrow it at the host edge.
    return { entityType: ref.entityType as CoreEntityRef['entityType'], entityId: ref.entityId };
  }

  /** Project artifacts into Huabu nodes (idempotent, stale-binding repair). */
  async projectArtifacts(sources: ArtifactProjectionSource[]) {
    return this.nodeProjector.projectArtifacts(sources);
  }

  /**
   * T1-G01: project confirmed ConnectedConversations as Glyth nodes.
   * Only conversations with a real external ref (conversationRef NOT
   * `pending-*`) are ready identities — `createConversation` placeholders are
   * deliberately skipped (a `pending-*` ref is not a confirmed identity and
   * must never fabricate a "created" Glyth). Same ProjectionBinding +
   * stale-repair path as artifacts; no second projector.
   */
  async projectConversations(): Promise<ProjectionBinding[]> {
    const conversations = await this.conversations.listConnectedConversations(
      this.projectId,
    );
    // 只投影已确认身份（`pending-*` 不是身份，绝不伪造 Glyth）。
    // 落位与 artifact 走同一个 projectBatch（GEN1 placeNewNodesIncrementally），
    // 不再有第二套 `index * 40` 级联。
    return this.nodeProjector.projectBatch(
      conversations
        .filter((conversation) => !conversation.conversationRef.startsWith('pending-'))
        .map((conversation) => ({
          projectId: this.projectId,
          entityType: 'conversation' as const,
          entityId: conversation.id,
          kind: 'text' as const,
          title: conversation.label,
        })),
    );
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

  /**
   * All node bindings for this project/canvas — the reference-store cache
   * source (P0-5): identity derives from ProjectionBinding, never from the
   * frontend guessing a Core ref.
   *
   * R2：同一次读取附带**呈现描述**（真实 kind/managed/availability/revision →
   * 次级行 + 物种），供单一 NodePresentation Junction 使用。没有 Core 元数据的
   * 绑定就不带 descriptor（前端按 entityType 降级，不编造内容）。
   */
  async listNodeBindings(): Promise<
    {
      spatialId: string;
      entityType: CoreEntityRef['entityType'];
      entityId: string;
      descriptor?: ProjectedNodeDescriptor;
    }[]
  > {
    const all = await this.bindings.list();
    const facts = await this.readArtifactFacts();
    const out: {
      spatialId: string;
      entityType: CoreEntityRef['entityType'];
      entityId: string;
      descriptor?: ProjectedNodeDescriptor;
    }[] = [];
    for (const b of all) {
      if (
        b.projectId === this.deps.projectId &&
        b.canvasId === this.canvasId &&
        b.spatialKind === 'node'
      ) {
        const entityType = b.entityType as CoreEntityRef['entityType'];
        const known = facts.get(`${entityType}:${b.entityId}`);
        out.push({
          spatialId: b.spatialId,
          entityType,
          entityId: b.entityId,
          ...(known ? { descriptor: describeProjectedEntity(known) } : {}),
        });
      }
    }
    return out;
  }

  /** Core 图快照 → 呈现事实表（只读；失败不阻断打开，但会明确告警而非静默）。 */
  private async readArtifactFacts(): Promise<ReadonlyMap<string, ProjectedEntityFacts>> {
    const map = new Map<string, ProjectedEntityFacts>();
    try {
      const graph = await this.projects.getProjectGraph(this.projectId);
      for (const artifact of graph?.artifacts ?? []) {
        const facts: ProjectedEntityFacts = {
          entityType: 'artifact',
          entityId: String(artifact.id),
          title: String(artifact.title ?? artifact.id),
          artifactKind: String(artifact.kind),
          ...(artifact.managed === undefined ? {} : { managed: artifact.managed }),
          ...(artifact.availability === undefined ? {} : { availability: String(artifact.availability) }),
          ...(artifact.currentRevisionId === undefined
            ? {}
            : { currentRevisionId: String(artifact.currentRevisionId) }),
        };
        map.set(`artifact:${facts.entityId}`, facts);
      }
    } catch (error) {
      console.warn('[lcos] 读取 Core 图快照失败，节点将退回无描述的诚实降级', error);
    }
    return map;
  }

  /** Run reconciliation on demand (startup / after a mutation / on reconnect). */
  async reconcile(trigger: ReconcileTrigger): Promise<boolean> {
    return this.reconciler.runNow(trigger);
  }
}
