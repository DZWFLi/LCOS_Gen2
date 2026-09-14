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
  /**
   * R2：Core 侧的呈现尺寸（来自 `ArtifactView.size` / `displayMode`）。
   * 有就给 Huabu 作为创建尺寸，让 Main 首屏形成真实主次分组；没有则用机械默认值。
   */
  size?: NodeGeometrySize;
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
  /** R2：创建尺寸（来自 ArtifactView / displayMode）；缺省用机械默认值。 */
  size?: NodeGeometrySize;
}

const DEFAULT_POSITION: Point = { x: 0, y: 0 };
const DEFAULT_SIZE: NodeGeometrySize = { width: 280, height: 220 };
/** 落位用的确定性尺寸（与 DEFAULT_SIZE 同值；NodeGeometrySize 允许 'auto'，落位需要纯数字）。 */
const DEFAULT_PLACEMENT_SIZE: PlacementItem = { width: 280, height: 220 };

/** 该投影源请求的落位尺寸（缺省用机械默认值；'auto' 不参与落位）。 */
function requestedPlacementSize(input: SpaceEntityProjectionSource): PlacementItem {
  const width = input.size?.width;
  const height = input.size?.height;
  return {
    width: typeof width === 'number' && width > 0 ? width : DEFAULT_PLACEMENT_SIZE.width,
    height: typeof height === 'number' && height > 0 ? height : DEFAULT_PLACEMENT_SIZE.height,
  };
}

/** 同一 canvas 上的投影批次队列（见 ProjectToSpaceProjection.projectBatch 注释）。 */
const PROJECTION_QUEUES = new Map<string, Promise<void>>();

/** 同一 (canvas, 实体) 的**建节点互斥**：并发批次不得为同一实体建出两个节点。 */
const ENTITY_CREATE_LOCKS = new Map<string, Promise<void>>();

/** 解绑前复核 stale 的间隔：RFS 写回执早于查询可见性，隔一拍再确认一次。 */
const REINSPECT_DELAY_MS = 300;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}


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
        ...(artifact.size === undefined ? {} : { size: artifact.size }),
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
    // 同一批输入里同一实体只投影一次（防御重复输入；与实体级建节点锁一起保证幂等）。
    const seen = new Set<string>();
    const uniqueInputs = inputs.filter((input) => {
      const key = `${input.entityType}:${input.entityId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const results: (ProjectionBinding | undefined)[] = new Array(uniqueInputs.length).fill(undefined);
    const newcomers: { index: number; input: SpaceEntityProjectionSource }[] = [];

    let index = 0;
    for (const input of uniqueInputs) {
      const existing = await this.findLiveNode(input);
      if (existing) results[index] = existing;
      else newcomers.push({ index, input });
      index += 1;
    }

    if (newcomers.length > 0) {
      const { bbox, obstacles } = await this.readPlacementSpace();
      // GEN1 的落位是**整批共用一个格点**（`stepX/stepY` 取自该次调用的 newcomers 最大值），
      // 所以这里也按"本批最大请求尺寸"定格 —— 逐节点各算一套步长会把画面拉成斜向散点。
      // 同时每个节点用 **Huabu 回执的真实尺寸**进障碍表，重叠仍由环形搜索兜住。
      const lattice: PlacementItem = {
        width: Math.max(
          DEFAULT_PLACEMENT_SIZE.width,
          ...newcomers.map((target) =>
            typeof target.input.size?.width === 'number' ? target.input.size.width : 0,
          ),
        ),
        height: Math.max(
          DEFAULT_PLACEMENT_SIZE.height,
          ...newcomers.map((target) =>
            typeof target.input.size?.height === 'number' ? target.input.size.height : 0,
          ),
        ),
      };
      const placementObstacles: PlacementBounds[] = [...obstacles];
      const origin = placementOriginFor(bbox);
      for (const target of newcomers) {
        const [point] = placeNewNodesIncrementally(placementObstacles, [lattice], origin, PLACEMENT_GAP);
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

  /** binding 存在且节点仍在 Huabu → 复用；节点确认已被删 → 解绑并当作新项。 */
  private async findLiveNode(input: SpaceEntityProjectionSource): Promise<ProjectionBinding | undefined> {
    const existing = await this.bindings.findNode(
      input.projectId,
      this.rfs.config.canvasId,
      input.entityType,
      input.entityId,
    );
    if (!existing) return undefined;
    if (await this.nodeIsPresent(existing.spatialId)) return existing;
    // RFS 写回执早于"查询可见性"：刚建好的节点立刻查可能查不到。
    // 只凭一次缺席就解绑会**误删活节点并重建一个重复节点**
    // （2026-09-14 R2 e2e 实测：画布上出现一个永不被绑定的 `项目定位 1` 孤儿）。
    // 因此解绑前先隔一拍复核一次，两次都缺席才认定为真 stale。
    await delay(REINSPECT_DELAY_MS);
    if (await this.nodeIsPresent(existing.spatialId)) return existing;
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

  /** 该 Huabu 节点此刻是否可见。 */
  private async nodeIsPresent(spatialId: string): Promise<boolean> {
    const res = await this.rfs.query({ type: 'INSPECT_NODES', ids: [spatialId] });
    return res.type === 'INSPECT_NODES' && res.result.nodes.some((n) => n.id === spatialId);
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
   *
   * 幂等护栏：同一 (canvas, 实体) 串行执行，且**锁内双检** binding ——
   * 并发 reconcile 绝不会为同一实体建出两个节点（见 ENTITY_CREATE_LOCKS 注释）。
   */
  private async createEntityNodeWithSize(
    input: SpaceEntityProjectionSource,
  ): Promise<{ binding: ProjectionBinding; size: PlacementItem }> {
    const key = `${this.rfs.config.canvasId}:${input.entityType}:${input.entityId}`;
    const previous = ENTITY_CREATE_LOCKS.get(key) ?? Promise.resolve();
    const task = async (): Promise<{ binding: ProjectionBinding; size: PlacementItem }> => {
      const live = await this.findLiveNode(input);
      // 已在锁外/锁内被别人建好 → 复用，不再建第二个。
      if (live) return { binding: live, size: requestedPlacementSize(input) };
      return this.createEntityNodeUnlocked(input);
    };
    const next = previous.then(task, task);
    ENTITY_CREATE_LOCKS.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  /** 真正的建节点调用（只允许由 createEntityNodeWithSize 在实体锁内调用）。 */
  private async createEntityNodeUnlocked(
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
            size: input.size === undefined ? { ...DEFAULT_SIZE } : { ...input.size },
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
