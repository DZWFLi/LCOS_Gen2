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
import {
  PLACEMENT_GAP,
  placeNewNodesIncrementally,
  placementOriginFor,
  type PlacementBounds,
  type PlacementItem,
} from './gen1Placement.js';

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
  /**
   * 创建时的机械落位（T1-G05：正式落位由 Huabu layout owner 接管；此处只是
   * 避免同一批投影全部叠在 DEFAULT_POSITION）。binding 复用时忽略。
   */
  position?: Point;
}

const DEFAULT_POSITION: Point = { x: 0, y: 0 };
const DEFAULT_SIZE: NodeGeometrySize = { width: 280, height: 220 };
/** 落位用的确定性尺寸（与 DEFAULT_SIZE 同值；NodeGeometrySize 允许 'auto'，落位需要纯数字）。 */
const DEFAULT_PLACEMENT_SIZE: PlacementItem = { width: 280, height: 220 };

/** 同一 canvas 上的投影批次队列（见 ProjectToSpaceProjection.projectBatch 注释）。 */
const PROJECTION_QUEUES = new Map<string, Promise<void>>();


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
    return this.projectBatch(
      artifacts.map((artifact) => ({
        projectId: artifact.projectId,
        entityType: 'artifact' as EntityType,
        entityId: artifact.artifactId,
        kind: artifact.kind,
        title: artifact.title,
      })),
    );
  }

  /**
   * 一批新投影的统一落位（R2）：只有**真正需要新建**的实体参与落位，
   * 已有 binding 的实体原位不动（复用既有节点，永不重排用户锚点）。
   * 落位算法 = GEN1 `placeNewNodesIncrementally`（见 gen1Placement.ts provenance）。
   *
   * 串行化：同一 canvas 上的投影批次排队执行。原因是一个实测缺陷 —— 开发模式
   * StrictMode 会双挂载 runtime，两次 reconcile 并发读到同一份空 outline，于是同一个
   * artifact 被投影成两个同坐标节点（2026-09-14 R2 e2e 实测）。排队后，后一批的
   * findLiveNode 一定能看到前一批刚写入的 binding，从而复用而不是重建。
   */
  async projectBatch(inputs: SpaceEntityProjectionSource[]): Promise<ProjectionBinding[]> {
    return this.enqueueForCanvas(() => this.projectBatchSerial(inputs));
  }

  /** 同 canvas 的投影串行队列（见 projectBatch 注释）。 */
  private enqueueForCanvas<T>(task: () => Promise<T>): Promise<T> {
    const key = this.rfs.config.canvasId;
    const previous = PROJECTION_QUEUES.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    PROJECTION_QUEUES.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async projectBatchSerial(
    inputs: SpaceEntityProjectionSource[],
  ): Promise<ProjectionBinding[]> {
    const results: (ProjectionBinding | undefined)[] = new Array(inputs.length).fill(undefined);
    const newcomers: { index: number; input: SpaceEntityProjectionSource }[] = [];

    let index = 0;
    for (const input of inputs) {
      const existing = await this.findLiveNode(input);
      if (existing) results[index] = existing;
      else newcomers.push({ index, input });
      index += 1;
    }

    if (newcomers.length > 0) {
      const { bbox, obstacles } = await this.readPlacementSpace();
      // 逐个落位：Huabu 会按内容重新给节点定尺寸（不采用我们请求的 size），
      // 所以必须"建一个 → 读回真实尺寸 → 作为下一个的障碍"，否则格点步长会小于真实宽度而重叠
      // （2026-09-14 R2 e2e 实测：请求 280 宽、真实 607 宽，两个节点落在同一格）。
      const placementObstacles: PlacementBounds[] = [...obstacles];
      const origin = placementOriginFor(bbox);
      for (const target of newcomers) {
        const step: PlacementItem = {
          width: Math.max(DEFAULT_PLACEMENT_SIZE.width, ...placementObstacles.map((o) => o.width)),
          height: Math.max(DEFAULT_PLACEMENT_SIZE.height, ...placementObstacles.map((o) => o.height)),
        };
        const [point] = placeNewNodesIncrementally(placementObstacles, [step], origin, PLACEMENT_GAP);
        const created = await this.createEntityNodeWithSize({
          ...target.input,
          position: point ?? origin,
        });
        const placed = point ?? origin;
        placementObstacles.push({
          x: placed.x,
          y: placed.y,
          width: created.size.width,
          height: created.size.height,
        });
        results[target.index] = created.binding;
      }
    }

    return results.filter((binding): binding is ProjectionBinding => binding !== undefined);
  }

  /** 既有节点只读：作为落位障碍物 + 新内容插入点的参考 bbox。 */
  private async readPlacementSpace(): Promise<{
    bbox: { x: number; y: number; width: number; height: number } | null;
    obstacles: readonly PlacementBounds[];
  }> {
    const outline = await this.rfs.query({ type: 'GET_SPACE_OUTLINE' });
    if (outline.type !== 'GET_SPACE_OUTLINE') return { bbox: null, obstacles: [] };
    const obstacles: PlacementBounds[] = outline.result.nodes.map((node) => ({
      x: node.absolutePosition.x,
      y: node.absolutePosition.y,
      width: node.size.width,
      height: node.size.height,
    }));
    return { bbox: outline.result.bbox ?? null, obstacles };
  }

  /** binding 存在且节点仍在 Huabu → 复用；节点已被删 → 解绑并当作新项。 */
  private async findLiveNode(input: SpaceEntityProjectionSource): Promise<ProjectionBinding | undefined> {
    const existing = await this.bindings.findNode(
      input.projectId,
      this.rfs.config.canvasId,
      input.entityType,
      input.entityId,
    );
    if (!existing) return undefined;
    const res = await this.rfs.query({ type: 'INSPECT_NODES', ids: [existing.spatialId] });
    const present = res.type === 'INSPECT_NODES' && res.result.nodes.some((n) => n.id === existing.spatialId);
    if (present) return existing;
    // Stale binding: node was removed in Huabu. Drop it and recreate.
    await this.bindings.unbindByEntity(
      input.projectId,
      this.rfs.config.canvasId,
      'node',
      input.entityType,
      input.entityId,
    );
    return undefined;
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
    const live = await this.findLiveNode(input);
    if (live) return live;
    return this.createEntityNode(input);
  }

  private async createEntityNode(input: SpaceEntityProjectionSource): Promise<ProjectionBinding> {
    return (await this.createEntityNodeWithSize(input)).binding;
  }

  /**
   * 创建节点并把 Huabu **实际**给出的尺寸读回来（CREATE 回执里带 width/height）。
   * Huabu 会按节点类型/内容重新定尺寸，因此真实尺寸才是落位依据。
   */
  private async createEntityNodeWithSize(
    input: SpaceEntityProjectionSource,
  ): Promise<{ binding: ProjectionBinding; size: PlacementItem }> {
    const nodeType = huabuNodeTypeForPresentation(input);
    const response = await this.rfs.execute([
      {
        type: 'CREATE_NODES',
        nodes: [
          {
            nodeType,
            data: { label: input.title },
            position: input.position === undefined ? { ...DEFAULT_POSITION } : { ...input.position },
            size: { ...DEFAULT_SIZE },
          },
        ],
      },
    ]);

    const nodeId = HuabuRfsClient.firstCreatedNodeId(response);
    if (!nodeId) {
      throw new Error(`CREATE_NODES did not return a node id for ${input.entityType}:${input.entityId}`);
    }
    const createdNode = response.results?.[0]?.nodes?.[0];
    const size: PlacementItem =
      createdNode !== undefined && createdNode.width > 0 && createdNode.height > 0
        ? { width: createdNode.width, height: createdNode.height }
        : { ...DEFAULT_PLACEMENT_SIZE };

    const binding: ProjectionBinding = {
      projectId: input.projectId,
      canvasId: this.rfs.config.canvasId,
      spatialKind: 'node',
      spatialId: nodeId,
      entityType: input.entityType,
      entityId: input.entityId,
    };
    await this.bindings.bind(binding);
    return { binding, size };
  }
}
