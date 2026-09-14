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
      return 'file';
    case 'markdown':
      return 'text';
    default:
      return 'text'; // 'other' / unknown -> text (safe default)
  }
}

function artifactSource(
  projectId: string,
  value: unknown,
  viewSize?: { width: number; height: number },
): ArtifactProjectionSource | undefined {
  if (typeof value === 'string') {
    return value ? { projectId, artifactId: value, kind: 'text', title: value } : undefined;
  }
  if (typeof value === 'object' && value !== null) {
    const artifact = value as { id?: unknown; artifactId?: unknown; title?: unknown; kind?: unknown };
    const artifactId = String(artifact.id ?? artifact.artifactId ?? '');
    if (!artifactId) return undefined;
    const title = typeof artifact.title === 'string' && artifact.title.trim() !== '' ? artifact.title : artifactId;
    return {
      projectId,
      artifactId,
      kind: projectionArtifactKind(artifact.kind),
      title,
      // R2：带上 Core 侧呈现尺寸（ArtifactView.size），让 Main 首屏有真实主次分组。
      ...(viewSize === undefined ? {} : { size: viewSize }),
    };
  }
  return undefined;
}

/**
 * R2：artifact → Core 呈现尺寸。取该 artifact 的第一个 ArtifactView 的 size
 * （Core 是 view 几何的 owner；这里只读，不发明尺寸）。
 */
function viewSizeByArtifact(
  views: readonly { artifactId?: unknown; size?: { width?: unknown; height?: unknown } }[],
): ReadonlyMap<string, { width: number; height: number }> {
  const map = new Map<string, { width: number; height: number }>();
  for (const view of views) {
    const artifactId = String(view.artifactId ?? '');
    const width = Number(view.size?.width);
    const height = Number(view.size?.height);
    if (artifactId === '' || !Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width <= 0 || height <= 0) continue;
    if (!map.has(artifactId)) map.set(artifactId, { width, height });
  }
  return map;
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
    const viewSizes = viewSizeByArtifact(
      (Array.isArray(graph?.artifactViews) ? graph.artifactViews : []) as readonly {
        artifactId?: unknown;
        size?: { width?: unknown; height?: unknown };
      }[],
    );

    const sources = rawArtifacts
      .map((a) => {
        const artifactId = String((a as { id?: unknown; artifactId?: unknown }).id ?? (a as { artifactId?: unknown }).artifactId ?? '');
        return artifactSource(projectId, a, viewSizes.get(artifactId));
      })
      .filter((s): s is ArtifactProjectionSource => s !== undefined);
    const artifactBindings = await this.deps.nodeProjector.projectArtifacts(sources);

    const nodeIdByArtifact = new Map<string, string>();
    for (const binding of artifactBindings) {
      if (binding.entityType === 'artifact') nodeIdByArtifact.set(binding.entityId, binding.spatialId);
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
        const conversationBindings = await this.deps.nodeProjector.projectBatch(
          confirmed.map((conversation) => ({
            projectId,
            entityType: 'conversation' as const,
            entityId: String(conversation.id),
            kind: 'text' as const,
            title: String(conversation.label ?? conversation.id),
          })),
        );
        conversationsProjected = conversationBindings.length;
        for (const binding of conversationBindings) nodeIdByArtifact.set(binding.entityId, binding.spatialId);
      } catch (error) {
        console.warn('[lcos] 承接会话投影失败（Glyth 本次缺席，不伪造）', error);
      }
    }

    const relations = await this.deps.relations.listRelations(projectId);
    let reconciledEdges = 0;
    let skippedRelations = 0;
    for (const rel of relations) {
      const fromNode = nodeIdByArtifact.get(String(rel.sourceEntityId));
      const toNode = nodeIdByArtifact.get(String(rel.targetEntityId));
      if (fromNode === undefined || toNode === undefined) {
        skippedRelations += 1;
        continue;
      }
      await this.deps.relationProjector.reconcileRelationEdge(toSemanticRelation(rel), fromNode, toNode);
      reconciledEdges += 1;
    }

    // Prune orphan edges: bound for this project/canvas but the Core relation is gone.
    const coreRelationIds = new Set(relations.map((r) => String(r.id)));
    const bindings = await this.deps.bindings.list();
    let removedOrphanEdges = 0;
    for (const binding of bindings) {
      if (binding.projectId === projectId && binding.canvasId === canvasId && binding.spatialKind === 'edge' && binding.entityType === 'relation') {
        if (!coreRelationIds.has(binding.entityId)) {
          await this.deps.relationProjector.removeOrphanRelationEdge(binding.entityId);
          removedOrphanEdges += 1;
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
        await this.deps.nodeProjector.removeOrphanNode(binding);
        removedOrphanNodes += 1;
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
          await this.deps.nodeProjector.removeOrphanNode(binding);
          removedOrphanNodes += 1;
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
    };
  }
}
