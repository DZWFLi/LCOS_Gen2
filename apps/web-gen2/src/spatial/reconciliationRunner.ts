// Reconciliation orchestrator — the part that actually runs the repair primitives
// (projectArtifacts stale-binding repair + reconcileRelationEdge +
// removeOrphanRelationEdge). Trigger it at startup, after a mutation event, or on a
// schedule. Idempotent: re-running reconciles toward Core truth without duplicating
// Huabu nodes/edges.

import { worksiteProjectionInput } from './worksiteProjectionInput.js';
import type { CoreRunClient } from '../backend/runs.js';
import { reconcileExecutionProjection, type ExecutionReconciliation } from './reconcileExecutionProjection.js';
import type { CoreProjectClient } from '../backend/projects.js';
import type { CoreRelationClient } from '../backend/relations.js';
import type { CoreConversationClient } from '../backend/conversations.js';
import type { CoreCollectionClient } from '../backend/collections.js';
import type { ProjectToSpaceProjection } from './projectToSpaceProjection.js';
import type { ArtifactProjectionSource } from './projectToSpaceProjection.js';
import { RelationProjection, type RelationKind, type SemanticRelation } from './relationProjection.js';
import type { ProjectionBindingRegistry } from './projectionBinding.js';
import type { RelationEntityType } from '@local-creative-os/domain';

export interface ReconciliationResult {
  projectId: string;
  canvasId: string;
  artifactsScanned: number;
  artifactsProjected: number;
  conversationsScanned: number;
  conversationsProjected: number;
  workflowScopesScanned: number;
  workflowScopesProjected: number;
  collectionsScanned: number;
  collectionsProjected: number;
  relationsScanned: number;
  reconciledEdges: number;
  removedOrphanEdges: number;
  removedOrphanNodes: number;
  skippedRelations: number;
  failures: ReconciliationFailureSummary;
  degraded: boolean;
  execution?: { runsScanned: number; runsProjected: number; slotsScanned: number; slotsProjected: number; promoted: number };
}

export interface ReconciliationFailureSummary {
  artifactProjection: number;
  conversationProjection: number;
  workflowScopeProjection: number;
  collectionProjection: number;
  relationProjection: number;
  orphanCleanup: number;
  executionProjection?: number;
}

export interface ReconciliationDeps {
  projectId: string;
  canvasId: string;
  projects: CoreProjectClient;
  relations: CoreRelationClient;
  nodeProjector: ProjectToSpaceProjection;
  relationProjector: RelationProjection;
  bindings: ProjectionBindingRegistry;
  /**
   * 承接会话的 Core client（R2 返工）。有它才会把已确认身份的会话投影成 Glyth 节点、
   * 并在会话消失时清理孤儿绑定；没有就跳过这一段（不假装有）。
   */
  conversations?: CoreConversationClient;
  collections?: CoreCollectionClient;
  runs?: CoreRunClient;
}

function projectionArtifactKind(kind: unknown): ArtifactProjectionSource['kind'] {
  switch (String(kind)) {
    case 'image':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'presentation':
      return 'presentation';
    case 'markdown':
      return 'markdown';
    case 'other':
      return 'other';
    default:
      return 'other';
  }
}

function artifactSource(
  projectId: string,
  value: unknown,
  viewSize?: { width: number; height: number },
  mimeType?: string,
  displayMode?: string,
  fileRecordId?: string,
  currentRevisionId?: string,
): ArtifactProjectionSource | undefined {
  if (typeof value === 'string') {
    return value ? { projectId, artifactId: value, kind: 'text', title: value } : undefined;
  }
  if (typeof value === 'object' && value !== null) {
    const artifact = value as {
      id?: unknown;
      artifactId?: unknown;
      title?: unknown;
      kind?: unknown;
      managed?: unknown;
      sourceRunId?: unknown;
    };
    const artifactId = String(artifact.id ?? artifact.artifactId ?? '');
    if (!artifactId) return undefined;
    const title = typeof artifact.title === 'string' && artifact.title.trim() !== '' ? artifact.title : artifactId;
    return {
      projectId,
      artifactId,
      kind: projectionArtifactKind(artifact.kind),
      title,
      ...(mimeType === undefined || mimeType === '' ? {} : { mimeType }),
      ...(fileRecordId === undefined || fileRecordId === '' ? {} : { fileRecordId }),
      ...(currentRevisionId === undefined || currentRevisionId === '' ? {} : { currentRevisionId }),
      ...(typeof artifact.managed === 'boolean' ? { managed: artifact.managed } : {}),
      ...(typeof artifact.sourceRunId === 'string' && artifact.sourceRunId !== '' ? { sourceRunId: artifact.sourceRunId } : {}),
      ...(displayMode === undefined || displayMode === '' ? {} : { displayMode }),
      // R2：带上 Core 侧呈现尺寸（ArtifactView.size），让 Main 首屏有真实主次分组。
      ...(viewSize === undefined ? {} : { size: viewSize }),
    };
  }
  return undefined;
}

/**
 * Select the ArtifactView for the active Huabu canvas. Workspace scope and
 * focused view ids are explicit when available; the fallback is deterministic
 * (primary first, then view id), never API array order.
 */
export function viewPresentationByArtifact(
  views: readonly {
    id?: unknown;
    artifactId?: unknown;
    scopeId?: unknown;
    referenceKind?: unknown;
    revisionId?: unknown;
    size?: { width?: unknown; height?: unknown };
    displayMode?: unknown;
  }[],
  target: { scopeId?: string; focusedViewIds?: ReadonlySet<string> } = {},
): ReadonlyMap<string, {
  viewId: string;
  revisionId?: string;
  fileRecordId?: string;
  size: { width: number; height: number };
  displayMode?: string;
}> {
  const candidatesByArtifact = new Map<string, typeof views[number][]>();
  for (const view of views) {
    const artifactId = String(view.artifactId ?? '');
    const viewId = String(view.id ?? '');
    const width = Number(view.size?.width);
    const height = Number(view.size?.height);
    if (artifactId === '' || viewId === '' || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) continue;
    if (target.scopeId !== undefined && String(view.scopeId ?? '') !== target.scopeId) continue;
    const bucket = candidatesByArtifact.get(artifactId) ?? [];
    bucket.push(view);
    candidatesByArtifact.set(artifactId, bucket);
  }
  const map = new Map<string, { viewId: string; revisionId?: string; size: { width: number; height: number }; displayMode?: string }>();
  for (const [artifactId, candidates] of candidatesByArtifact) {
    candidates.sort((left, right) => {
      const leftId = String(left.id ?? '');
      const rightId = String(right.id ?? '');
      const leftFocused = target.focusedViewIds?.has(leftId) ? 0 : 1;
      const rightFocused = target.focusedViewIds?.has(rightId) ? 0 : 1;
      if (leftFocused !== rightFocused) return leftFocused - rightFocused;
      const leftPrimary = left.referenceKind === 'primary' ? 0 : 1;
      const rightPrimary = right.referenceKind === 'primary' ? 0 : 1;
      if (leftPrimary !== rightPrimary) return leftPrimary - rightPrimary;
      return leftId.localeCompare(rightId);
    });
    const view = candidates[0];
    if (view === undefined) continue;
    const revisionId = String(view.revisionId ?? '');
    const displayMode = String(view.displayMode ?? '');
    map.set(artifactId, {
      viewId: String(view.id),
      ...(revisionId === '' ? {} : { revisionId }),
      size: { width: Number(view.size?.width), height: Number(view.size?.height) },
      ...(displayMode === '' ? {} : { displayMode }),
    });
  }
  return map;
}

export function mimeTypeByArtifact(graph: {
  artifacts?: readonly { id?: unknown; artifactId?: unknown; currentRevisionId?: unknown }[];
  artifactRevisions?: readonly { id?: unknown; artifactId?: unknown; fileRecordId?: unknown }[];
  fileRecords?: readonly { id?: unknown; mimeType?: unknown }[];
}, selectedViews: ReadonlyMap<string, { revisionId?: string }> = new Map()): ReadonlyMap<string, { mimeType: string; fileRecordId?: string; revisionId?: string }> {
  const recordMime = new Map<string, string>();
  for (const record of graph.fileRecords ?? []) {
    const id = String(record.id ?? '');
    const mime = String(record.mimeType ?? '').toLowerCase().split(';', 1)[0]?.trim() ?? '';
    if (id !== '' && mime !== '') recordMime.set(id, mime);
  }
  const revisionById = new Map<string, NonNullable<typeof graph.artifactRevisions>[number]>();
  for (const revision of graph.artifactRevisions ?? []) {
    const revisionId = String(revision.id ?? '');
    if (revisionId !== '') revisionById.set(revisionId, revision);
  }
  const out = new Map<string, { mimeType: string; fileRecordId?: string; revisionId?: string }>();
  for (const artifact of graph.artifacts ?? []) {
    const artifactId = String(artifact.id ?? artifact.artifactId ?? '');
    if (artifactId === '') continue;
    const selectedRevisionId = selectedViews.get(artifactId)?.revisionId ?? String(artifact.currentRevisionId ?? '');
    const revision = revisionById.get(selectedRevisionId);
    if (revision === undefined) continue;
    const fileRecordId = String(revision.fileRecordId ?? '');
    const mime = recordMime.get(fileRecordId);
    if (mime !== undefined) out.set(artifactId, { mimeType: mime, fileRecordId, revisionId: selectedRevisionId });
  }
  return out;
}

function toSemanticRelation(relation: {
  id: unknown;
  kind: unknown;
  sourceEntityType: unknown;
  sourceEntityId: unknown;
  targetEntityType: unknown;
  targetEntityId: unknown;
}): SemanticRelation {
  return {
    id: String(relation.id),
    kind: String(relation.kind) as RelationKind,
    from: { entityType: String(relation.sourceEntityType) as RelationEntityType, entityId: String(relation.sourceEntityId) },
    to: { entityType: String(relation.targetEntityType) as RelationEntityType, entityId: String(relation.targetEntityId) },
  };
}

/**
 * Walks Core truth (graph artifacts + relations) and reconciles the Huabu spatial
 * projection: ensures artifact nodes exist (repairing stale bindings), reconciles
 * each Core relation into an Edge, and prunes orphan Edges whose Core relation no
 * longer exists. Run after startup or a mutation; safe to run repeatedly.
 */
export class ReconciliationRunner {
  constructor(private readonly deps: ReconciliationDeps) {}

  async runOnce(): Promise<ReconciliationResult> {
    const { projectId, canvasId } = this.deps;
    const graph = await this.deps.projects.getProjectGraph(projectId);
    const allArtifacts = Array.isArray(graph?.artifacts) ? (graph.artifacts as unknown[]) : [];
    // Archived entities remain in Project Graph truth but leave every active spatial projection.
    const rawArtifacts = allArtifacts.filter((artifact) =>
      typeof artifact !== 'object' || artifact === null || (artifact as { archivedAt?: unknown }).archivedAt === undefined);
    const targetWorkspace = graph?.workspaces?.find((workspace) => String(workspace.canvasId ?? '') === canvasId);
    let execution: ExecutionReconciliation | undefined;
    let executionReadFailed = false;
    if (this.deps.runs) {
      try {
        const snapshot = await this.deps.runs.readExecutionProjection(projectId);
        execution = await reconcileExecutionProjection({ projectId, canvasId, snapshot,
          ...(targetWorkspace === undefined ? {} : { workspace: targetWorkspace }),
          activeArtifactIds: new Set(rawArtifacts.map((value) => String((value as { id?: string }).id ?? ''))),
          runs: this.deps.runs, nodeProjector: this.deps.nodeProjector, bindings: this.deps.bindings });
      } catch (error) {
        executionReadFailed = true;
        console.warn('[lcos] Execution projection unavailable; existing Run/slot nodes are retained.', error);
      }
    }
    const worksiteInput = worksiteProjectionInput(graph, targetWorkspace);
    const viewPresentation = viewPresentationByArtifact(worksiteInput.views, {
      focusedViewIds: worksiteInput.preferredViews,
    });
    const mimeTypes = mimeTypeByArtifact({
      ...(graph?.artifacts === undefined ? {} : { artifacts: graph.artifacts }),
      ...(graph?.artifactRevisions === undefined ? {} : { artifactRevisions: graph.artifactRevisions }),
      ...(graph?.fileRecords === undefined ? {} : { fileRecords: graph.fileRecords }),
    }, viewPresentation);

    // If the execution census is unavailable, a Run draft may have an unseen
    // reserved slot. Keep existing sources but do not materialize that draft at
    // a new location until its owner can be read again.
    const deferredArtifactIds = execution?.blockedArtifactIds ?? new Set(executionReadFailed
      ? (graph?.artifactRevisions ?? []).filter((revision) => revision.status === 'draft' && revision.runId !== undefined)
        .map((revision) => String(revision.artifactId)) : []);
    const sources = rawArtifacts
      .filter((value) => !worksiteInput.artifactIds || worksiteInput.artifactIds.has(String((value as {id?: unknown}).id ?? '')))
      .filter((value) => !deferredArtifactIds.has(String((value as { id?: string }).id ?? '')))
      .map((a) => {
        const artifactId = String((a as { id?: unknown; artifactId?: unknown }).id ?? (a as { artifactId?: unknown }).artifactId ?? '');
        const view = viewPresentation.get(artifactId);
        return artifactSource(
          projectId,
          a,
          view?.size,
          mimeTypes.get(artifactId)?.mimeType,
          view?.displayMode,
          mimeTypes.get(artifactId)?.fileRecordId,
          mimeTypes.get(artifactId)?.revisionId,
        );
      })
      .filter((s): s is ArtifactProjectionSource => s !== undefined)
      .map((source) => {
        const revision = graph?.artifactRevisions?.find((value) => String(value.id) === source.currentRevisionId);
        return { ...source, ...(revision ? { revisionStatus: revision.status } : {}) };
      });
    const artifactReport = await this.deps.nodeProjector.projectArtifactsWithReport(sources);
    const artifactBindings = [...artifactReport.bindings];
    const failures: ReconciliationFailureSummary = {
      artifactProjection: artifactReport.failures.length,
      conversationProjection: 0,
      workflowScopeProjection: 0,
      collectionProjection: 0,
      relationProjection: 0,
      orphanCleanup: 0,
      ...(this.deps.runs ? { executionProjection: executionReadFailed ? 1 : execution?.failures ?? 0 } : {}),
    };

    const noteReport = worksiteInput.notes.length === 0 ? {bindings: [], failures: []} : await this.deps.nodeProjector.projectBatchWithReport(worksiteInput.notes.map((note) => ({
      projectId, entityType: 'note' as const, entityId: String(note.id), kind: 'text' as const,
      title: String(note.body).split(/\r?\n/, 1)[0]?.slice(0, 80) || '笔记',
    })));
    failures.artifactProjection += noteReport.failures.length;

    const entityKey = (entityType: string, entityId: string): string => `${entityType}:${entityId}`;
    const nodeIdByEntity = new Map<string, string>();
    for (const binding of [...artifactBindings, ...noteReport.bindings, ...(execution?.bindings ?? [])]) {
      nodeIdByEntity.set(entityKey(String(binding.entityType), binding.entityId), binding.spatialId);
    }

    // An existing source involved in a pending revision is still a real
    // relation endpoint. Deferring its NEW projection must not hide its identity.
    for (const artifactId of deferredArtifactIds) {
      const retained = await this.deps.bindings.findNode(projectId, canvasId, 'artifact', artifactId);
      if (retained) nodeIdByEntity.set(entityKey('artifact', artifactId), retained.spatialId);
    }

    // Workflow scopes are real Core scope identities, projected through the
    // same binding/projector as every other entity. Only the root/Main canvas
    // receives them; Context/Workflow canvases remain their own worksite
    // projections rather than duplicating the collection entry everywhere.
    const targetScope = targetWorkspace?.scopeId === undefined
      ? undefined
      : graph?.scopes?.find((scope) => String(scope.id) === String(targetWorkspace.scopeId));
    const isMainCanvas = targetWorkspace === undefined || targetScope?.kind === 'root';
    const workflowScopes = isMainCanvas
      ? (graph?.scopes ?? []).filter((scope) => scope.kind === 'workflow')
      : [];
    const workflowScopeReport = workflowScopes.length === 0
      ? { bindings: [], failures: [] }
      : await this.deps.nodeProjector.projectBatchWithReport(
        workflowScopes.map((scope) => ({
          projectId,
          entityType: 'scope' as const,
          entityId: String(scope.id),
          // scope kind is presentation metadata; the native host remains note,
          // while the LCOS junction resolves the workflow collection body.
          kind: 'file' as const,
          sourceKind: 'workflow',
          title: String(scope.name ?? scope.id),
          size: { width: 248, height: 244 },
        })),
      );
    for (const binding of workflowScopeReport.bindings) {
      nodeIdByEntity.set(entityKey(String(binding.entityType), binding.entityId), binding.spatialId);
    }
    failures.workflowScopeProjection = workflowScopeReport.failures.length;

    // Canonical Collections are projected by identity only on the Main/root
    // canvas. Membership remains Core-owned; this projection never derives it
    // from parentId or frame geometry.
    let collectionsScanned = 0;
    let collectionsProjected = 0;
    let collectionIds: ReadonlySet<string> | null = null;
    if (isMainCanvas && this.deps.collections) {
      try {
        const collections = await this.deps.collections.list(projectId);
        collectionsScanned = collections.length;
        collectionIds = new Set(collections.map((collection) => String(collection.id)));
        const collectionReport = collections.length === 0
          ? { bindings: [], failures: [] }
          : await this.deps.nodeProjector.projectBatchWithReport(collections.map((collection) => ({
              projectId,
              entityType: 'collection' as const,
              entityId: String(collection.id),
              kind: 'file' as const,
              sourceKind: 'collection',
              title: collection.title,
              size: { width: 248, height: 244 },
            })));
        collectionsProjected = collectionReport.bindings.length;
        failures.collectionProjection += collectionReport.failures.length;
        for (const binding of collectionReport.bindings) {
          nodeIdByEntity.set(entityKey(String(binding.entityType), binding.entityId), binding.spatialId);
        }
      } catch (error) {
        failures.collectionProjection += 1;
        console.warn('[lcos] Canonical Collection projection failed; existing spatial state is retained.', error);
      }
    }

    // 承接会话 → Glyth 节点：与 artifact 走同一条投影/落位/绑定路径（没有第二套 projector）。
    // 只投影**已确认身份**的会话（`pending-*` 不是身份，绝不伪造 Glyth）。
    // 读不到会话列表时宁可本轮不投影，也不清空既有 Glyth（见下面的孤儿清理守卫）。
    let conversationsScanned = 0;
    let conversationsProjected = 0;
    let conversationIds: ReadonlySet<string> | null = null;
    if (this.deps.conversations) {
      try {
        const conversations = await this.deps.conversations.listConnectedConversations(projectId);
        const confirmed = conversations.filter(
          (conversation) => !conversation.conversationRef.startsWith('pending-'),
        );
        conversationsScanned = conversations.length;
        conversationIds = new Set(confirmed.map((conversation) => String(conversation.id)));
        const conversationReport = await this.deps.nodeProjector.projectBatchWithReport(
          confirmed.map((conversation) => ({
            projectId,
            entityType: 'conversation' as const,
            entityId: String(conversation.id),
            kind: 'text' as const,
            title: String(conversation.label ?? conversation.id),
          })),
        );
        conversationsProjected = conversationReport.bindings.length;
        failures.conversationProjection += conversationReport.failures.length;
        for (const binding of conversationReport.bindings) {
          nodeIdByEntity.set(entityKey(String(binding.entityType), binding.entityId), binding.spatialId);
        }
      } catch (error) {
        failures.conversationProjection += 1;
        console.warn('[lcos] 承接会话投影失败（Glyth 本次缺席，不伪造）', error);
      }
    }

    for (const binding of await this.deps.bindings.list()) {
      if (binding.projectId === projectId && binding.canvasId === canvasId && binding.spatialKind === 'node') {
        const exists = binding.entityType === 'artifact'
          ? rawArtifacts.some((a) => String((a as {id?: unknown}).id) === binding.entityId)
          : binding.entityType === 'note' && (graph?.notes ?? []).some((n) => String(n.id) === binding.entityId);
        if (exists) nodeIdByEntity.set(entityKey(binding.entityType, binding.entityId), binding.spatialId);
      }
    }
    const relations = await this.deps.relations.listRelations(projectId);
    let reconciledEdges = 0;
    let skippedRelations = 0;
    // Resolve endpoints first, then reconcile the whole pass in ONE
    // `CONNECT_NODES` write. One execute per relation produced a seconds-long
    // write trickle, and every write broadcasts a sync `update` that lands in
    // the live client's undo history — a pass that straddles a user gesture
    // then hijacks the user's Ctrl+Z (and clears their redo). See
    // `RelationProjection.reconcileRelationEdges`.
    const relationEntries: { relation: SemanticRelation; fromNodeId: string; toNodeId: string }[] = [];
    for (const rel of relations) {
      const fromNode = nodeIdByEntity.get(entityKey(String(rel.sourceEntityType), String(rel.sourceEntityId)));
      const toNode = nodeIdByEntity.get(entityKey(String(rel.targetEntityType), String(rel.targetEntityId)));
      if (fromNode === undefined || toNode === undefined) {
        skippedRelations += 1;
        failures.relationProjection += 1;
        continue;
      }
      relationEntries.push({ relation: toSemanticRelation(rel), fromNodeId: fromNode, toNodeId: toNode });
    }
    if (relationEntries.length > 0) {
      try {
        const reconciled = await this.deps.relationProjector.reconcileRelationEdges(relationEntries);
        reconciledEdges += relationEntries.length - reconciled.skipped;
        skippedRelations += reconciled.skipped;
        failures.relationProjection += reconciled.skipped;
      } catch (error) {
        failures.relationProjection += relationEntries.length;
        // A malformed or conflicting relation must not discard valid node
        // projections or the remaining relations in this reconciliation pass.
        console.warn('[lcos] 关系投影批次失败，本轮跳过（不丢弃节点投影）', error);
      }
    }

    // Prune orphan edges: bound for this project/canvas but the Core relation is gone.
    const coreRelationIds = new Set(relations.map((r) => String(r.id)));
    const bindings = await this.deps.bindings.list();
    let removedOrphanEdges = 0;
    for (const binding of bindings) {
      if (binding.projectId === projectId && binding.canvasId === canvasId && binding.spatialKind === 'edge' && binding.entityType === 'relation') {
        if (!coreRelationIds.has(binding.entityId)) {
          try {
            await this.deps.relationProjector.removeOrphanRelationEdge(binding.entityId);
            removedOrphanEdges += 1;
          } catch (error) {
            failures.orphanCleanup += 1;
            console.warn('[lcos] 清理单项孤儿关系失败，继续处理', { relationId: binding.entityId, error });
          }
        }
      }
    }

    // Prune orphan node bindings: an artifact-projected node whose Core artifact
    // no longer exists is stale spatial truth -> delete the Huabu node + unbind.
    const coreArtifactIds = new Set(
      rawArtifacts
        .map((a) => String((a as { id?: unknown }).id ?? (a as { artifactId?: unknown }).artifactId ?? ''))
        .filter((id) => id !== ''),
    );
    let removedOrphanNodes = 0;
    for (const binding of bindings) {
      if (
        binding.projectId === projectId &&
        binding.canvasId === canvasId &&
        binding.spatialKind === 'node' &&
        binding.entityType === 'artifact' &&
        !coreArtifactIds.has(binding.entityId)
      ) {
        try {
          await this.deps.nodeProjector.removeOrphanNode(binding);
          removedOrphanNodes += 1;
        } catch (error) {
          failures.orphanCleanup += 1;
          console.warn('[lcos] 清理单项孤儿节点失败，继续处理', { entityId: binding.entityId, error });
        }
      }
    }

    // 会话孤儿：**只在本轮真实读到会话列表时才敢删**（一次读取失败清空全部 Glyth 是灾难）。
    if (conversationIds !== null) {
      const knownConversationIds = conversationIds;
      for (const binding of bindings) {
        if (
          binding.projectId === projectId &&
          binding.canvasId === canvasId &&
          binding.spatialKind === 'node' &&
          binding.entityType === 'conversation' &&
          !knownConversationIds.has(binding.entityId)
        ) {
          try {
            await this.deps.nodeProjector.removeOrphanNode(binding);
            removedOrphanNodes += 1;
          } catch (error) {
            failures.orphanCleanup += 1;
            console.warn('[lcos] 清理单项孤儿会话失败，继续处理', { entityId: binding.entityId, error });
          }
        }
      }
    }

    if (collectionIds !== null) {
      for (const binding of bindings) {
        if (binding.projectId === projectId && binding.canvasId === canvasId && binding.spatialKind === 'node' && binding.entityType === 'collection' && !collectionIds.has(binding.entityId)) {
          try {
            await this.deps.nodeProjector.removeOrphanNode(binding);
            removedOrphanNodes += 1;
          } catch (error) {
            failures.orphanCleanup += 1;
            console.warn('[lcos] Failed to remove one orphan Collection projection.', { entityId: binding.entityId, error });
          }
        }
      }
    }

    if (execution) {
      // Only a complete successful identity read permits removal. 503 is not an empty list.
      for (const binding of bindings) {
        if (binding.projectId !== projectId || binding.canvasId !== canvasId || binding.spatialKind !== 'node') continue;
        const obsolete = binding.entityType === 'run' ? !execution.runIds.has(binding.entityId)
          : binding.entityType === 'result-slot' ? !execution.slotIds.has(binding.entityId) : false;
        if (!obsolete) continue;
        try { await this.deps.nodeProjector.removeOrphanNode(binding); removedOrphanNodes += 1; }
        catch (error) { failures.orphanCleanup += 1; console.warn('[lcos] Execution node cleanup deferred.', error); }
      }
    }

    return {
      projectId,
      canvasId,
      ...(execution ? { execution: { runsScanned: execution.runIds.size, runsProjected: execution.runsProjected,
        slotsScanned: execution.slotIds.size, slotsProjected: execution.slotsProjected, promoted: execution.promoted } } : {}),
      artifactsScanned: rawArtifacts.length,
      artifactsProjected: artifactBindings.length,
      conversationsScanned,
      conversationsProjected,
      workflowScopesScanned: workflowScopes.length,
      workflowScopesProjected: workflowScopeReport.bindings.length,
      collectionsScanned,
      collectionsProjected,
      relationsScanned: relations.length,
      reconciledEdges,
      removedOrphanEdges,
      removedOrphanNodes,
      skippedRelations,
      failures,
      degraded:
        (failures.executionProjection ?? 0) > 0 ||
        failures.artifactProjection > 0 ||
        failures.conversationProjection > 0 ||
        failures.workflowScopeProjection > 0 ||
        failures.collectionProjection > 0 ||
        failures.relationProjection > 0 ||
        failures.orphanCleanup > 0,
    };
  }
}
