// Gen2Host — a small typed facade the GUI hosts use. Composes the small Core
// clients (projects/artifacts/relations/search) + Huabu RFS + ProjectionBinding +
// projection adapters + reconciliation. Only exposes what a Work View/Surface
// actually needs (no 199-method monolith). Wires reconciliation into the host
// lifecycle (open / mutation / reconnect) via HostLifecycleReconciler.
//
// Spatial truth stays in Huabu (RFS); domain truth stays in Local Core (HttpClient).
// This file owns no geometry and no second spatial runtime.

import { worksiteProjectionInput } from '../spatial/worksiteProjectionInput.js';
import { HttpClient } from '../backend/client.js';
import { CoreProjectClient } from '../backend/projects.js';
import { CoreCollectionClient, collectionPreviewMembers } from '../backend/collections.js';
import { CoreConversationClient } from '../backend/conversations.js';
import { CoreAssemblyClient } from '../backend/assembly.js';
import { CoreRailwayClient } from '../backend/railway.js';
import { CoreWorkflowClient, type WorkflowImportReceiptV1 } from '../backend/workflows.js';
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
import { ProjectToSpaceProjection, type ArtifactProjectionSource, type ProjectedNodeContentRevision } from '../spatial/projectToSpaceProjection.js';
import { viewPresentationByArtifact } from '../spatial/reconciliationRunner.js';
import { RelationProjection, type CoreEntityRef, type CoreRelationWriter, type RelationKind } from '../spatial/relationProjection.js';
import { ReconciliationRunner } from '../spatial/reconciliationRunner.js';
import { runPresentation, resultSlotPresentation } from '../presentation/executionPresentation.js';
import { validateExecutionProjection } from '../spatial/reconcileExecutionProjection.js';
import { describeProjectedEntity, buildContentPreview } from '../presentation/projectedNodeDescriptor.js';
import { resolveVisualFamily } from '../presentation/visualFamily.js';
import { HostLifecycleReconciler, type ReconcileTrigger } from './lifecycleReconciler.js';
import { connectSemantic, type SemanticConnectResult } from './hostConnectIntent.js';

import type { ProjectedEntityFacts, ProjectedNodeDescriptor } from '../presentation/projectedNodeDescriptor.js';

/** 会取正文预览的 Core ArtifactKind（二进制/版式族不取，避免把乱码当正文）。 */
const TEXT_PREVIEW_KINDS: ReadonlySet<string> = new Set(['markdown', 'text']);
/** 预览只读有界文件：超过该体积不取正文（避免把大文件拉进前端）。 */
const MAX_PREVIEW_BYTES = 256 * 1024;

export interface Gen2HostDeps {
  /** HttpClient pointed at Local Core (Domain Truth). */
  http: HttpClient;
  /** HuabuRfsClient pointed at a Huabu canvas (Spatial Truth). */
  rfs: HuabuRfsClient;
  projectId: string;
  /**
   * Sink for the authoritative content revisions of projected nodes (RFS
   * receipt `revisions`). The host seam forwards them into the canvas host's
   * content-CAS baseline, so the first content write to a freshly projected node
   * does not trip a false `NODE_CONTENT_CONFLICT`.
   */
  onNodeContentRevisions?: (
    revisions: readonly ProjectedNodeContentRevision[],
  ) => void;
}

export class Gen2Host {
  readonly projectId: string;
  readonly projects: CoreProjectClient;
  readonly collections: CoreCollectionClient;
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
  readonly workflows: CoreWorkflowClient;
  readonly bindings: ProjectionBindingRegistry;
  readonly nodeProjector: ProjectToSpaceProjection;
  readonly relationProjector: RelationProjection;
  readonly reconciler: HostLifecycleReconciler;

  private readonly canvasId: string;
  /** fileRecordId → 已派生的正文预览（同一 revision 内容不变，避免每次同步都重复拉取）。 */
  private readonly previewCache = new Map<string, string>();

  constructor(private readonly deps: Gen2HostDeps) {
    this.projectId = deps.projectId;
    this.canvasId = deps.rfs.config.canvasId;
    this.projects = new CoreProjectClient(deps.http);
    this.collections = new CoreCollectionClient(deps.http);
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
    this.workflows = new CoreWorkflowClient(deps.http);
    this.bindings = new ProjectionBindingRegistry(new SqliteBindingStore(deps.http, deps.projectId));

    this.nodeProjector = new ProjectToSpaceProjection(
      deps.rfs,
      this.bindings,
      deps.onNodeContentRevisions,
    );

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
      conversations: this.conversations,
      collections: this.collections,
      runs: this.runs,
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
      entityType: EntityType;
      entityId: string;
      descriptor?: ProjectedNodeDescriptor;
    }[]
  > {
    const all = await this.bindings.list();
    const facts = await this.readEntityFacts();
    const out: {
      spatialId: string;
      entityType: import('../spatial/projectionBinding.js').EntityType;
      entityId: string;
      descriptor?: ProjectedNodeDescriptor;
    }[] = [];
    for (const b of all) {
      if (
        b.projectId === this.deps.projectId &&
        b.canvasId === this.canvasId &&
        b.spatialKind === 'node'
      ) {
        const entityType = b.entityType;
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
  private async readEntityFacts(): Promise<ReadonlyMap<string, ProjectedEntityFacts>> {
    const map = new Map<string, ProjectedEntityFacts>();
    let graph: Awaited<ReturnType<CoreProjectClient['getProjectGraph']>>;
    try {
      graph = await this.projects.getProjectGraph(this.projectId);
    } catch (error) {
      console.warn('[lcos] 读取 Core 图快照失败，节点将退回无描述的诚实降级', error);
      return map;
    }

    const targetWorkspace = graph?.workspaces?.find((workspace) => String(workspace.canvasId ?? '') === this.canvasId);
    const worksiteInput = worksiteProjectionInput(graph, targetWorkspace);
    const selectedViews = viewPresentationByArtifact(worksiteInput.views, {focusedViewIds: worksiteInput.preferredViews});
    // artifact → selected view revision → current revision fallback → FileRecord.
    // Never use the first revision in an API array: reversed history must not
    // change the rendered species or the bytes staged into Huabu.
    const revisionById = new Map<string, { id?: unknown; fileRecordId?: unknown; runId?: unknown; status?: 'draft' | 'current' | 'superseded' }>();
    for (const revision of graph?.artifactRevisions ?? []) {
      const revisionId = String(revision.id ?? '');
      if (revisionId !== '') revisionById.set(revisionId, revision);
    }
    const fileRecordById = new Map<string, { mimeType: string; size: number }>();
    for (const record of graph?.fileRecords ?? []) {
      fileRecordById.set(String(record.id), {
        mimeType: (String(record.mimeType ?? '').toLowerCase().split(';', 1)[0] ?? '').trim(),
        size: Number(record.size ?? 0),
      });
    }

    for (const artifact of graph?.artifacts ?? []) {
      const entityId = String(artifact.id);
      const selectedRevisionId = selectedViews.get(entityId)?.revisionId ?? String(artifact.currentRevisionId ?? '');
      const selectedRevision = revisionById.get(selectedRevisionId);
      const fileRecordId = selectedRevision === undefined ? undefined : String(selectedRevision.fileRecordId ?? '');
      const preview = await this.readPreview(
        String(artifact.kind),
        fileRecordId,
        fileRecordById,
      );
      const facts: ProjectedEntityFacts = {
        entityType: 'artifact',
        entityId,
        title: String(artifact.title ?? artifact.id),
        ...(selectedRevision?.status === undefined ? {} : { revisionStatus: selectedRevision.status }),
        artifactKind: String(artifact.kind),
        ...(selectedViews.get(entityId)?.viewId === undefined ? {} : { artifactViewId: selectedViews.get(entityId)?.viewId }),
        ...(selectedRevisionId === '' ? {} : { presentedRevisionId: selectedRevisionId }),
        ...(typeof selectedRevision?.runId === 'string' && selectedRevision.runId !== ''
          ? { sourceRunId: selectedRevision.runId }
          : {}),
        ...(artifact.managed === undefined ? {} : { managed: artifact.managed }),
        ...(artifact.availability === undefined ? {} : { availability: String(artifact.availability) }),
        ...(artifact.currentRevisionId === undefined
          ? {}
          : { currentRevisionId: String(artifact.currentRevisionId) }),
        ...(fileRecordId === undefined ? {} : { fileRecordId }),
        ...(fileRecordById.get(fileRecordId ?? '') === undefined
          ? {}
          : { mimeType: fileRecordById.get(fileRecordId ?? '')?.mimeType }),
        ...(preview === undefined ? {} : { preview }),
      };
      map.set(`artifact:${facts.entityId}`, facts);
    }

    for (const note of graph?.notes ?? []) {
      map.set(`note:${note.id}`, {entityType: 'note', entityId: String(note.id), artifactKind: 'text',
        title: String(note.body).split(/\r?\n/, 1)[0]?.slice(0, 80) || '笔记', preview: String(note.body)});
    }

    // Scope presentation facts stay derived from the Core graph. Workflow
    // scopes are the Main collection entries; the projector owns their spatial
    // identity, while this descriptor lets the single node junction choose the
    // workflow-collection body without inventing a second store.
    for (const scope of graph?.scopes ?? []) {
      if (scope.kind !== 'workflow') continue;
      const entityId = String(scope.id);
      map.set(`scope:${entityId}`, {
        entityType: 'scope',
        entityId,
        title: String(scope.name ?? entityId),
        artifactKind: 'workflow',
        sourceKind: 'workflow',
      });
    }

    try {
      const collections = await this.collections.list(this.projectId);
      // Collection metadata comes from the same members read used by the overview
      // and Assembly. An unrelated conversation failure must not erase all folders.
      await Promise.all(collections.map(async (collection) => {
        const identity: ProjectedEntityFacts = { entityType: 'collection', entityId: String(collection.id),
          title: collection.title, artifactKind: 'collection', sourceKind: 'collection' };
        try {
          const snapshot = await this.collections.members(this.projectId, String(collection.id));
          const previews = collectionPreviewMembers(snapshot);
          map.set(`collection:${collection.id}`, { ...identity, title: snapshot.collection.title,
            collectionMemberCount: snapshot.members.length,
            collectionMemberLabels: previews.map((member) => member.label),
            collectionMembers: previews.map(({type,id,label}) => ({type,id,label})),
          });
        } catch (error) {
          map.set(`collection:${collection.id}`, identity);
          console.warn('[lcos] 集合成员尚未读回，保留集合身份，不显示空集合。', error);
        }
      }));
    } catch (error) {
      console.warn('[lcos] 读取 canonical Collection membership 失败；不显示虚构成员。', error);
    }

    // 承接会话 → Glyth 的真实身份/运行态（读不到就退回 entityType 降级，不编造）。
    try {
      for (const conversation of await this.conversations.listConnectedConversations(this.projectId)) {
        const entityId = String(conversation.id);
        map.set(`conversation:${entityId}`, {
          entityType: 'conversation',
          entityId,
          title: String(conversation.label ?? entityId),
          provider: String(conversation.provider ?? ''),
          active: conversation.isRunning === true,
          waiting: conversation.waitingReason !== null && conversation.waitingReason !== undefined,
        });
      }
    } catch (error) {
      console.warn('[lcos] 读取承接会话失败，Glyth 将退回无描述的诚实降级', error);
    }

    try {
      const execution = await this.runs.readExecutionProjection(this.projectId);
      validateExecutionProjection(execution, this.projectId);
      for (const run of execution.runs) map.set(`run:${run.id}`, runPresentation(run));
      for (const slot of execution.resultSlots) map.set(`result-slot:${slot.id}`, resultSlotPresentation(slot, execution));
    } catch (error) {
      console.warn('[lcos] Execution state read failed; no ready/success state will be fabricated.', error);
    }
    return map;
  }

  /**
   * 文本族 artifact 的**真实正文预览**（用户裁决 B 的 preview 位）。
   * 只对文本类 kind 且体积有界的文件取；按 fileRecordId + 呈现模式缓存（同一 revision 内容不变）。
   * 取不到就返回 undefined —— 调用方不写 preview 字段，body 退回形态说明。
   */
  private async readPreview(
    kind: string,
    fileRecordId: string | undefined,
    fileRecordById: ReadonlyMap<string, { mimeType: string; size: number }>,
  ): Promise<string | undefined> {
    if (fileRecordId === undefined) return undefined;
    const record = fileRecordById.get(fileRecordId);
    const textLike = TEXT_PREVIEW_KINDS.has(kind) || record?.mimeType.startsWith('text/') === true;
    if (!textLike) return undefined;
    const preserveLineBreaks = resolveVisualFamily({ entityType: 'artifact', artifactKind: kind, mimeType: record?.mimeType }) === 'text';
    const cacheKey = `${fileRecordId}:${preserveLineBreaks ? 'lines' : 'summary'}`;
    const cached = this.previewCache.get(cacheKey);
    if (cached !== undefined) return cached === '' ? undefined : cached;
    if (record !== undefined && record.size > MAX_PREVIEW_BYTES) return undefined;
    try {
      const preview = buildContentPreview(
        await this.artifacts.getFileRecordText(this.projectId, fileRecordId),
        160,
        { preserveLineBreaks },
      );
      this.previewCache.set(cacheKey, preview);
      return preview === '' ? undefined : preview;
    } catch (error) {
      console.warn(`[lcos] 读取文件正文预览失败（${fileRecordId}），节点退回形态说明`, error);
      return undefined;
    }
  }

  /** Run reconciliation on demand (startup / after a mutation / on reconnect). */
  async reconcile(trigger: ReconcileTrigger): Promise<boolean> {
    return this.reconciler.runNow(trigger);
  }

  /**
   * Archive fast path for the current canvas only. Core remains the lifecycle
   * authority: a node is removed only after a fresh graph read confirms the
   * canonical Artifact is archived. Full reconciliation still follows for
   * relations and every other projection.
   */
  async removeArchivedArtifactFromCurrentCanvas(artifactId: string): Promise<boolean> {
    const graph = await this.projects.getProjectGraph(this.projectId);
    const artifact = graph?.artifacts.find((candidate) => String(candidate.id) === artifactId);
    if (artifact?.archivedAt === undefined) return false;

    const binding = await this.bindings.findNode(
      this.projectId,
      this.canvasId,
      'artifact',
      artifactId,
    );
    if (binding !== undefined) await this.nodeProjector.removeOrphanNode(binding);
    return true;
  }

  /** Coalesced mutation invalidation; retained until a sweep can actually run. */
  notifyMutationSuccess(): void {
    this.reconciler.onMutationSuccess();
  }

  /**
   * Canonical producer for a portable Workflow definition. Core creates the
   * scope/worksite truth; then the existing Main projector is notified through
   * the single host reconciler. Assembly sees the same scope through warehouse.
   */
  async importWorkflowDefinition(
    file: Blob,
    fileName: string,
    name?: string,
    signal?: AbortSignal,
  ): Promise<WorkflowImportReceiptV1> {
    const receipt = await this.workflows.importAsWorkflow(
      this.projectId,
      file,
      fileName,
      name,
      signal,
    );
    this.reconciler.onMutationSuccess();
    return receipt;
  }
}
