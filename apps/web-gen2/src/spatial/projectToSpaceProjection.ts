// Projection of LCOS Core Domain objects into Huabu Space nodes.
// One-way: Core -> Huabu. Geometry lives in Huabu; only node identity + label +
// type come from Core. Idempotent: an artifact with an existing binding reuses
// its node instead of creating a duplicate. No custom metadata embedded in Huabu
// node data (Huabu RFS `data` is a strict schema: label/content/src/style only).

import { HuabuRfsClient } from './huabuRfsClient.js';
import { ProjectionBinding, ProjectionBindingRegistry } from './projectionBinding.js';
import type { CanvasNodeType, Point, NodeSize } from './types.js';

export type ArtifactKind = 'text' | 'image' | 'pdf' | 'file';

export interface ArtifactProjectionSource {
  projectId: string;
  artifactId: string;
  kind: ArtifactKind;
  title: string;
}

const DEFAULT_POSITION: Point = { x: 0, y: 0 };
const DEFAULT_SIZE: NodeSize = { width: 280, height: 220 };

export function huabuNodeTypeFor(kind: ArtifactKind): CanvasNodeType {
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
   * Project each artifact; returns the binding for each, idempotently.
   * - Existing node binding -> reuse that node (no duplicate node).
   * - New -> CREATE_NODES, extract real nodeId from results[0].nodes[0].nodeId.
   */
  async projectArtifacts(artifacts: ArtifactProjectionSource[]): Promise<ProjectionBinding[]> {
    const out: ProjectionBinding[] = [];
    for (const artifact of artifacts) {
      const existing = await this.bindings.findNode(artifact.projectId, this.rfs.config.canvasId, 'artifact', artifact.artifactId);
      const binding = existing ?? (await this.createNode(artifact));
      out.push(binding);
    }
    return out;
  }

  private async createNode(artifact: ArtifactProjectionSource): Promise<ProjectionBinding> {
    const nodeType = huabuNodeTypeFor(artifact.kind);
    const response = await this.rfs.execute([
      {
        type: 'CREATE_NODES',
        nodes: [
          {
            nodeType,
            data: { label: artifact.title },
            position: { ...DEFAULT_POSITION },
            size: { ...DEFAULT_SIZE },
          },
        ],
      },
    ]);

    const nodeId = HuabuRfsClient.firstCreatedNodeId(response);
    if (!nodeId) {
      throw new Error(`CREATE_NODES did not return a node id for artifact ${artifact.artifactId}`);
    }

    const binding: ProjectionBinding = {
      projectId: artifact.projectId,
      canvasId: this.rfs.config.canvasId,
      spatialKind: 'node',
      spatialId: nodeId,
      entityType: 'artifact',
      entityId: artifact.artifactId,
    };
    await this.bindings.bind(binding);
    return binding;
  }
}
