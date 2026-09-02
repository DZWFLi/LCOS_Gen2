// Reconciliation orchestrator — the part that actually runs the repair primitives
// (projectArtifacts stale-binding repair + reconcileRelationEdge +
// removeOrphanRelationEdge). Trigger it at startup, after a mutation event, or on a
// schedule. Idempotent: re-running reconciles toward Core truth without duplicating
// Huabu nodes/edges.

import type { CoreProjectClient } from '../backend/projects.js';
import type { CoreRelationClient } from '../backend/relations.js';
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

function artifactSource(projectId: string, value: unknown): ArtifactProjectionSource | undefined {
  if (typeof value === 'string') {
    return value ? { projectId, artifactId: value, kind: 'text', title: value } : undefined;
  }
  if (typeof value === 'object' && value !== null) {
    const artifact = value as { id?: unknown; artifactId?: unknown; title?: unknown; kind?: unknown };
    const artifactId = String(artifact.id ?? artifact.artifactId ?? '');
    if (!artifactId) return undefined;
    const title = typeof artifact.title === 'string' && artifact.title.trim() !== '' ? artifact.title : artifactId;
    return { projectId, artifactId, kind: projectionArtifactKind(artifact.kind), title };
  }
  return undefined;
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

    const sources = rawArtifacts
      .map((a) => artifactSource(projectId, a))
      .filter((s): s is ArtifactProjectionSource => s !== undefined);
    const artifactBindings = await this.deps.nodeProjector.projectArtifacts(sources);

    const nodeIdByArtifact = new Map<string, string>();
    for (const binding of artifactBindings) {
      if (binding.entityType === 'artifact') nodeIdByArtifact.set(binding.entityId, binding.spatialId);
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

    return {
      projectId,
      canvasId,
      artifactsScanned: rawArtifacts.length,
      artifactsProjected: artifactBindings.length,
      relationsScanned: relations.length,
      reconciledEdges,
      removedOrphanEdges,
      removedOrphanNodes,
      skippedRelations,
    };
  }
}
