// Projection of LCOS Core Domain objects into Huabu Space nodes.
// One-way: Core -> Huabu. Geometry lives in Huabu; only node identity + label +
// type come from Core. Idempotent: an entity with an existing binding reuses its
// node instead of creating a duplicate. No custom metadata embedded in Huabu
// node data (Huabu RFS `data` is a strict schema: label/content/src/style only).
//
// G0.9: this is the SINGLE spatial consumer. Any Core entity (artifact /
// conversation / skill / run) projects through the SAME ProjectionBinding model
// (bindingKey + ProjectionBinding + Memory/Sqlite store). We do NOT create a new
// Binding type per entity kind — `entityType` already carries it. Conversation /
// Skill / Run entering space just call projectEntity() with that entityType.

import { HuabuRfsClient } from './huabuRfsClient.js';
import { ProjectionBinding, ProjectionBindingRegistry, type EntityType } from './projectionBinding.js';
import type { AgentCreatableNodeType, Point, NodeGeometrySize } from './types.js';
import { resolveVisualFamily, huabuNodeTypeForFamily, type VisualFamilySource } from '../presentation/visualFamily.js';

export type ArtifactKind = 'text' | 'image' | 'pdf' | 'file';

export interface ArtifactProjectionSource {
  projectId: string;
  artifactId: string;
  kind: ArtifactKind;
  title: string;
}

export interface SpaceEntityProjectionSource {
  projectId: string;
  entityType: EntityType;
  entityId: string;
  kind: ArtifactKind;
  title: string;
  /** B00-R2: Core metadata consumed by the visual family resolver (never title guesses). */
  mimeType?: string;
  sourceKind?: string;
  sourceRunId?: string;
  managed?: boolean;
}

const DEFAULT_POSITION: Point = { x: 0, y: 0 };
const DEFAULT_SIZE: NodeGeometrySize = { width: 280, height: 220 };


/**
 * B00-R4: visual-family -> Huabu NATIVE node type (adoption registry).
 * Reads Core metadata (kind + MIME), never title/suffix. Returns only
 * Huabu built-ins; no lcos/* synonyms.
 */
export function huabuNodeTypeForPresentation(
  source: Pick<SpaceEntityProjectionSource, 'kind'> & Partial<VisualFamilySource>,
): AgentCreatableNodeType {
  const family = resolveVisualFamily({
    entityType: source.entityType,
    artifactKind: source.kind,
    mimeType: source.mimeType,
    sourceKind: source.sourceKind,
    sourceRunId: source.sourceRunId,
    managed: source.managed,
  });
  return huabuNodeTypeForFamily(family) as AgentCreatableNodeType;
}

export function huabuNodeTypeFor(kind: ArtifactKind): AgentCreatableNodeType {
  switch (kind) {
    case 'image':
      return 'image';
    case 'pdf':
      return 'pdf';
    case 'text':
      return 'text';
    case 'file':
    default:
      return 'note';
  }
}

export class ProjectToSpaceProjection {
  constructor(
    private readonly rfs: HuabuRfsClient,
    private readonly bindings: ProjectionBindingRegistry,
  ) {}

  /**
   * Project each Artifact node; returns the binding for each, idempotently.
   * Backwards-compatible convenience over projectEntity('artifact').
   */
  async projectArtifacts(artifacts: ArtifactProjectionSource[]): Promise<ProjectionBinding[]> {
    const out: ProjectionBinding[] = [];
    for (const artifact of artifacts) {
      out.push(await this.projectEntity({ projectId: artifact.projectId, entityType: 'artifact', entityId: artifact.artifactId, kind: artifact.kind, title: artifact.title }));
    }
    return out;
  }

  /**
   * Generic single spatial consumer — ANY Core entity (artifact/conversation/skill/
   * run) reuses the same ProjectionBinding model + stale-binding repair. No new
   * Binding type; `entityType` distinguishes the consumer.
   */
  async projectEntity(input: SpaceEntityProjectionSource): Promise<ProjectionBinding> {
    return this.ensureEntityNode(input);
  }

  /**
   * Remove a projection whose Core entity no longer exists. Deletes the Huabu
   * node and unbinds the node binding, so reconciliation converges the spatial
   * truth back toward Core truth. Mirrors RelationProjection.removeOrphanRelationEdge.
   */
  async removeOrphanNode(binding: ProjectionBinding): Promise<void> {
    await this.rfs.execute([{ type: 'DELETE_NODES', nodeIds: [binding.spatialId] }]);
    await this.bindings.unbindByEntity(binding.projectId, binding.canvasId, 'node', binding.entityType, binding.entityId);
  }

  private async ensureEntityNode(input: SpaceEntityProjectionSource): Promise<ProjectionBinding> {
    const existing = await this.bindings.findNode(input.projectId, this.rfs.config.canvasId, input.entityType, input.entityId);
    if (existing) {
      const res = await this.rfs.query({ type: 'INSPECT_NODES', ids: [existing.spatialId] });
      const present = res.type === 'INSPECT_NODES' && res.result.nodes.some((n) => n.id === existing.spatialId);
      if (present) return existing;
      // Stale binding: node was removed in Huabu. Drop it and recreate.
      await this.bindings.unbindByEntity(input.projectId, this.rfs.config.canvasId, 'node', input.entityType, input.entityId);
    }
    return this.createEntityNode(input);
  }

  private async createEntityNode(input: SpaceEntityProjectionSource): Promise<ProjectionBinding> {
    const nodeType = huabuNodeTypeForPresentation(input);
    const response = await this.rfs.execute([
      {
        type: 'CREATE_NODES',
        nodes: [
          {
            nodeType,
            data: { label: input.title },
            position: { ...DEFAULT_POSITION },
            size: { ...DEFAULT_SIZE },
          },
        ],
      },
    ]);

    const nodeId = HuabuRfsClient.firstCreatedNodeId(response);
    if (!nodeId) {
      throw new Error(`CREATE_NODES did not return a node id for ${input.entityType}:${input.entityId}`);
    }

    const binding: ProjectionBinding = {
      projectId: input.projectId,
      canvasId: this.rfs.config.canvasId,
      spatialKind: 'node',
      spatialId: nodeId,
      entityType: input.entityType,
      entityId: input.entityId,
    };
    await this.bindings.bind(binding);
    return binding;
  }
}
