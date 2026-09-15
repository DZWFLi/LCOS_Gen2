// Reconciliation orchestrator — the part that actually runs the repair primitives
// (projectArtifacts stale-binding repair + reconcileRelationEdge +
// removeOrphanRelationEdge). Trigger it at startup, after a mutation event, or on a
// schedule. Idempotent: re-running reconciles toward Core truth without duplicating
// Huabu nodes/edges.

import type { CoreProjectClient } from '../backend/projects.js';
import type { CoreRelationClient } from '../backend/relations.js';
import type { CoreConversationClient } from '../backend/conversations.js';
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
  relationsScanned: number;
  reconciledEdges: number;
  removedOrphanEdges: number;
  removedOrphanNodes: number;
  skippedRelations: number;
  failures: ReconciliationFailureSummary;
  degraded: boolean;
}

export interface ReconciliationFailureSummary {
  artifactProjection: number;
  conversationProjection: number;
  relationProjection: number;
  orphanCleanup: number;
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
    const rawArtifacts = Array.isArray(graph?.artifacts) ? (graph.artifacts as unknown[]) : [];
    const targetWorkspace = graph?.workspaces?.find((workspace) => String(workspace.canvasId ?? '') === canvasId);
    const viewPresentation = viewPresentationByArtifact(
      (Array.isArray(graph?.artifactViews) ? graph.artifactViews : []) as readonly {
        id?: unknown;
        artifactId?: unknown;
        scopeId?: unknown;
        referenceKind?: unknown;
        revisionId?: unknown;
        size?: { width?: unknown; height?: unknown };
        displayMode?: unknown;
      }[],
      {
        ...(targetWorkspace?.scopeId === undefined ? {} : { scopeId: String(targetWorkspace.scopeId) }),
        ...(targetWorkspace === undefined ? {} : { focusedViewIds: new Set(targetWorkspace.focusedViewIds.map(String)) }),
      },
    );
    const mimeTypes = mimeTypeByArtifact({
      ...(graph?.artifacts === undefined ? {} : { artifacts: graph.artifacts }),
      ...(graph?.artifactRevisions === undefined ? {} : { artifactRevisions: graph.artifactRevisions }),
      ...(graph?.fileRecords === undefined ? {} : { fileRecords: graph.fileRecords }),
    }, viewPresentation);

    const sources = rawArtifacts
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
      .filter((s): s is ArtifactProjectionSource => s !== undefined);
    const artifactReport = await this.deps.nodeProjector.projectArtifactsWithReport(sources);
    const artifactBindings = [...artifactReport.bindings];
    const failures: ReconciliationFailureSummary = {
      artifactProjection: artifactReport.failures.length,
      conversationProjection: 0,
      relationProjection: 0,
      orphanCleanup: 0,
    };

    const entityKey = (entityType: string, entityId: string): string => `${entityType}:${entityId}`;
    const nodeIdByEntity = new Map<string, string>();
    for (const binding of artifactBindings) {
      nodeIdByEntity.set(entityKey(String(binding.entityType), binding.entityId), binding.spatialId);
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

    const relations = await this.deps.relations.listRelations(projectId);
    let reconciledEdges = 0;
    let skippedRelations = 0;
    for (const rel of relations) {
      const fromNode = nodeIdByEntity.get(entityKey(String(rel.sourceEntityType), String(rel.sourceEntityId)));
      const toNode = nodeIdByEntity.get(entityKey(String(rel.targetEntityType), String(rel.targetEntityId)));
      if (fromNode === undefined || toNode === undefined) {
        skippedRelations += 1;
        failures.relationProjection += 1;
        continue;
      }
      try {
        await this.deps.relationProjector.reconcileRelationEdge(toSemanticRelation(rel), fromNode, toNode);
        reconciledEdges += 1;
      } catch (error) {
        failures.relationProjection += 1;
        // A malformed or conflicting relation must not discard valid node
        // projections or the remaining relations in this reconciliation pass.
        console.warn('[lcos] 单项关系投影失败，继续处理其余关系', { relationId: String(rel.id), error });
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

    return {
      projectId,
      canvasId,
      artifactsScanned: rawArtifacts.length,
      artifactsProjected: artifactBindings.length,
      conversationsScanned,
      conversationsProjected,
      relationsScanned: relations.length,
      reconciledEdges,
      removedOrphanEdges,
      removedOrphanNodes,
      skippedRelations,
      failures,
      degraded:
        failures.artifactProjection > 0 ||
        failures.conversationProjection > 0 ||
        failures.relationProjection > 0 ||
        failures.orphanCleanup > 0,
    };
  }
}
