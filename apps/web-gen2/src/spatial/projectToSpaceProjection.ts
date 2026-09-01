// Projection of LCOS Core Domain objects into Huabu Space nodes.
// One-way: Core -> Huabu. Geometry is Huabu's; only node identity + label +
// type come from Core. Idempotent: an artifact with an existing binding reuses
// its node instead of creating a duplicate.

import { HuabuRfsClient } from './huabuRfsClient.js';
import { ProjectionBinding, ProjectionBindingRegistry, bindingToNodeMeta } from './projectionBinding.js';
import type { Geometry, NodeType } from './types.js';

export type ArtifactKind = 'text' | 'image' | 'pdf' | 'file';

export interface ArtifactProjectionSource {
  projectId: string;
  artifactId: string;
  kind: ArtifactKind;
  title: string;
}

const DEFAULT_SIZE: Geometry = { x: 0, y: 0, width: 280, height: 220 };

export function huabuNodeTypeFor(kind: ArtifactKind): NodeType {
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
   * - If a binding already exists -> reuse that node (no duplicate node).
   * - If not -> create a Huabu node carrying the LCOS entity identity in node meta.
   */
  async projectArtifacts(artifacts: ArtifactProjectionSource[]): Promise<ProjectionBinding[]> {
    const out: ProjectionBinding[] = [];
    for (const artifact of artifacts) {
      const existing = await this.resolveExisting(artifact);
      const binding = existing ?? (await this.createNode(artifact));
      out.push(binding);
    }
    return out;
  }

  private async resolveExisting(artifact: ArtifactProjectionSource): Promise<ProjectionBinding | undefined> {
    return this.bindings.resolve('artifact', artifact.artifactId);
  }

  private async createNode(artifact: ArtifactProjectionSource): Promise<ProjectionBinding> {
    const nodeType = huabuNodeTypeFor(artifact.kind);
    const geometry: Geometry = { ...DEFAULT_SIZE };
    const response = await this.rfs.execute([
      {
        type: 'CREATE_NODES',
        nodes: [
          {
            type: nodeType,
            label: artifact.title,
            geometry,
            data: bindingToNodeMeta({
              projectId: artifact.projectId,
              canvasId: this.rfs.config.canvasId,
              nodeId: '',
              entityType: 'artifact',
              entityId: artifact.artifactId,
            }),
          },
        ],
      },
    ]);

    const nodeId = response.createdNodes?.[0]?.id ?? response.results?.[0]?.nodeId ?? response.results?.[0]?.id;
    if (!nodeId) {
      throw new Error(`CREATE_NODES did not return a node id for artifact ${artifact.artifactId}`);
    }

    const binding: ProjectionBinding = {
      projectId: artifact.projectId,
      canvasId: this.rfs.config.canvasId,
      nodeId,
      entityType: 'artifact',
      entityId: artifact.artifactId,
    };
    await this.bindings.bind(binding);
    return binding;
  }
}
