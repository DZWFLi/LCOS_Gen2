// Sprint 2B（T4）+ R4 Assembly residual：Assembly Source Bay 控制器（React-free，四路 epoch guard）。
//
// Source Bay 四来源（Project/Capture/Sources/Skills）共用一个 region（regionId=lcos:assembly），
// 切 tab 不复制 source truth；warehouse 是既有 Core read model，无第二 assembly 表。
//
// R4 补缺（只接既有 canonical owner，不建第二 Assembly backend）：
// - 四路各自 status/error：Project error != Capture error != Resource error != Skill error，
//   一路失败绝不把整个 Assembly 打死；
// - Project Warehouse：canonical 分页（nextCursor）+ 搜索（filter 变化重置 cursor）+ 去重；
// - Capture：系统级 Capture Space 快照（不复制成 Project-local Capture）；
// - Sources：既有 Resource 路由（artifactId != resourceId，前端零推断）；
// - Skills：分层只读 catalog（v0.15 不可 apply，由 UI 诚实呈现 unavailable）。

import type {
  CaptureSpacePayloadPreviewV1,
  CaptureStagingItemV0,
  ResourceDescriptorV0,
  SkillCatalogEntryV1,
  SkillCatalogReadV1,
  WarehouseSnapshotV1,
} from '@local-creative-os/contracts';
import type { CoreAssemblyClient } from '../../backend/assembly.js';
import type { CoreCaptureSpaceClient } from '../../backend/captureSpace.js';
import type { CoreResourceClient, ResourceSummaryV1 } from '../../backend/resources.js';
import type { CoreSkillCatalogClient } from '../../backend/skills.js';

export type AssemblySourceTabV1 = 'project' | 'capture' | 'sources' | 'skills';

/** 单路读取状态：idle/loading/loaded/error（四路互不牵连）。 */
export type AssemblyPathStatusV1 = 'idle' | 'loading' | 'loaded' | 'error';

export interface AssemblySourceBayDepsV1 {
  readonly assembly: CoreAssemblyClient;
  readonly captureSpace?: CoreCaptureSpaceClient;
  readonly resources?: CoreResourceClient;
  readonly skills?: CoreSkillCatalogClient;
}

/**
 * Project Warehouse 单页大小：分页走 canonical nextCursor，不用本地切片冒充分页。
 * 取 canonical route 的 DEFAULT_LIMIT（50），使第一页与「不传 limit」的历史行为逐字一致。
 */
export const ASSEMBLY_WAREHOUSE_PAGE_SIZE = 50;

export interface AssemblySourceBayStateV1 {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly tab: AssemblySourceTabV1;
  /** Project Warehouse 路（保留既有字段名，既有消费点不迁移）。 */
  readonly warehouseStatus: AssemblyPathStatusV1;
  readonly warehouse?: WarehouseSnapshotV1;
  readonly warehouseErrorCode?: string;
  readonly warehouseNextCursor?: string;
  readonly warehouseLoadingMore: boolean;
  readonly warehouseSearch: string;
  /** 兼容既有消费点 = warehouseErrorCode。 */
  readonly errorCode?: string;
  /** Capture 路（system-level staging）。 */
  readonly captureStatus: AssemblyPathStatusV1;
  readonly captureItems?: readonly CaptureStagingItemV0[];
  readonly captureErrorCode?: string;
  /** Sources 路（既有 Resource）。 */
  readonly resourceStatus: AssemblyPathStatusV1;
  readonly resources?: readonly ResourceSummaryV1[];
  readonly resourceErrorCode?: string;
  /** Skills 路（分层只读 catalog）。 */
  readonly skillStatus: AssemblyPathStatusV1;
  readonly skills?: readonly SkillCatalogEntryV1[];
  readonly skillErrorCode?: string;
  readonly revision: number;
}

interface AssemblySourceBayEpoch {
  readonly projectId: string;
  readonly generation: number;
  readonly controller: AbortController;
}

export class AssemblySourceBayController {
  private state: AssemblySourceBayStateV1 | undefined;
  private epoch: AssemblySourceBayEpoch | undefined;
  private readonly pathGeneration: Record<AssemblySourceTabV1, number> = { project: 0, capture: 0, sources: 0, skills: 0 };
  private readonly listeners = new Set<() => void>();
  private readonly deps: AssemblySourceBayDepsV1;

  constructor(deps: AssemblySourceBayDepsV1) {
    this.deps = deps;
  }

  /** React 消费侧订阅（pull-based）。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  open(projectId: string): void {
    this.epoch?.controller.abort();
    const generation = (this.epoch?.generation ?? 0) + 1;
    const controller = new AbortController();
    this.epoch = { projectId, generation, controller };
    this.bumpAllPaths();
    this.state = {
      schemaVersion: 1,
      projectId,
      tab: 'project',
      warehouseStatus: 'loading',
      warehouseLoadingMore: false,
      warehouseSearch: '',
      captureStatus: 'idle',
      resourceStatus: 'idle',
      skillStatus: 'idle',
      revision: 0,
    };
    this.notify();
    void this.loadWarehouseFirstPage(this.pathGeneration.project, '');
  }

  /** 切 tab 只改 tab，不发请求（source data 保留；由 UI 显式 loadTab 懒加载）。 */
  selectTab(tab: AssemblySourceTabV1): void {
    if (!this.state) return;
    this.state = { ...this.state, tab };
    this.notify();
  }

  /** 懒加载某一路（仅 idle 时发起；retry 走 reloadX 显式入口）。 */
  loadTab(tab: AssemblySourceTabV1): void {
    const state = this.state;
    if (state === undefined) return;
    if (tab === 'project') {
      if (state.warehouseStatus === 'idle') this.reloadWarehouse();
      return;
    }
    if (tab === 'capture') {
      if (state.captureStatus === 'idle') this.reloadCapture();
      return;
    }
    if (tab === 'sources') {
      if (state.resourceStatus === 'idle') this.reloadResources();
      return;
    }
    if (state.skillStatus === 'idle') this.reloadSkills();
  }

  read(): AssemblySourceBayStateV1 | undefined {
    return this.state;
  }

  dispose(): void {
    this.epoch?.controller.abort();
    this.epoch = undefined;
    this.bumpAllPaths();
    this.state = undefined;
    this.notify();
  }

  // ---- Project Warehouse（分页 / 搜索 / 去重）----

  reloadWarehouse(): void {
    if (this.epoch === undefined) return;
    const generation = this.bumpPath('project');
    this.setState({ warehouseStatus: 'loading', warehouseErrorCode: undefined, errorCode: undefined, warehouseLoadingMore: false });
    void this.loadWarehouseFirstPage(generation, this.state?.warehouseSearch ?? '');
  }

  /** filter/query 变化：重置 cursor 并重取第一页（不追加到旧结果）。 */
  setWarehouseSearch(search: string): void {
    if (this.state === undefined) return;
    const generation = this.bumpPath('project');
    this.setState({ warehouseSearch: search, warehouseStatus: 'loading', warehouseErrorCode: undefined, errorCode: undefined, warehouseLoadingMore: false, warehouseNextCursor: undefined });
    void this.loadWarehouseFirstPage(generation, search);
  }

  /** 追加下一页：仅在已有 nextCursor 且没有 in-flight 时；按 canonical 身份去重。 */
  loadMoreWarehouse(): void {
    const state = this.state;
    const epoch = this.epoch;
    if (state === undefined || epoch === undefined) return;
    const cursor = state.warehouseNextCursor;
    if (cursor === undefined || state.warehouseLoadingMore || state.warehouseStatus !== 'loaded') return;
    const generation = this.pathGeneration.project;
    this.setState({ warehouseLoadingMore: true });
    void this.deps.assembly
      .queryWarehouse(epoch.projectId, { search: state.warehouseSearch, limit: ASSEMBLY_WAREHOUSE_PAGE_SIZE, cursor }, epoch.controller.signal)
      .then((page) => {
        if (!this.isCurrent('project', generation)) return;
        const current = this.state;
        if (current === undefined) return;
        const merged = dedupeWarehouseItems(current.warehouse?.items ?? [], page.items);
        this.setState({
          warehouseLoadingMore: false,
          warehouse: { ...page, items: merged },
          warehouseNextCursor: page.nextCursor,
        });
      })
      .catch((error: unknown) => {
        if (!this.isCurrent('project', generation)) return;
        this.setState({ warehouseLoadingMore: false, warehouseErrorCode: this.errorCodeOf(error), errorCode: this.errorCodeOf(error) });
      });
  }

  // ---- 另外三路的显式重取 ----

  reloadCapture(): void {
    if (this.epoch === undefined) return;
    const generation = this.bumpPath('capture');
    this.setState({ captureStatus: 'loading', captureErrorCode: undefined });
    void this.loadCapture(generation);
  }

  reloadResources(): void {
    if (this.epoch === undefined) return;
    const generation = this.bumpPath('sources');
    this.setState({ resourceStatus: 'loading', resourceErrorCode: undefined });
    void this.loadResources(generation);
  }

  reloadSkills(): void {
    if (this.epoch === undefined) return;
    const generation = this.bumpPath('skills');
    this.setState({ skillStatus: 'loading', skillErrorCode: undefined });
    void this.loadSkills(generation);
  }

  /** canonical result refresh：apply 之后按已加载的路重读（未加载的路保持 idle 不打扰）。 */
  async refreshApplied(paths: readonly AssemblySourceTabV1[]): Promise<void> {
    const jobs: Promise<unknown>[] = [];
    for (const path of paths) {
      if (path === 'project') jobs.push(this.reloadWarehouseAsync());
      else if (path === 'capture') jobs.push(this.reloadCaptureAsync());
      else if (path === 'sources') jobs.push(this.reloadResourcesAsync());
      else jobs.push(this.reloadSkillsAsync());
    }
    await Promise.allSettled(jobs);
  }

  // ---- transient reads（预览/描述符/技能正文；不改 Source Bay 状态）----

  async previewCapture(captureId: string): Promise<CaptureSpacePayloadPreviewV1> {
    const epoch = this.requireEpoch();
    const client = this.deps.captureSpace;
    if (client === undefined) throw new Error('Capture Space is not configured.');
    return client.preview(captureId, epoch.controller.signal);
  }

  async readResourceDescriptor(resourceId: string): Promise<ResourceDescriptorV0> {
    const epoch = this.requireEpoch();
    const client = this.deps.resources;
    if (client === undefined) throw new Error('Resource service is not configured.');
    return client.descriptor(epoch.projectId, resourceId, epoch.controller.signal);
  }

  async readSkill(skillId: string): Promise<SkillCatalogReadV1> {
    const epoch = this.requireEpoch();
    const client = this.deps.skills;
    if (client === undefined) throw new Error('Skill catalog is not configured.');
    return client.read(epoch.projectId, skillId, epoch.controller.signal);
  }

  // ---- internals ----

  private requireEpoch(): AssemblySourceBayEpoch {
    if (this.epoch === undefined) throw new Error('Assembly Source Bay is not open.');
    return this.epoch;
  }

  private errorCodeOf(error: unknown): string {
    return (error as { code?: string }).code ?? 'read_error';
  }

  private bumpPath(tab: AssemblySourceTabV1): number {
    this.pathGeneration[tab] += 1;
    return this.pathGeneration[tab];
  }

  private bumpAllPaths(): void {
    for (const tab of ['project', 'capture', 'sources', 'skills'] as const) this.pathGeneration[tab] += 1;
  }

  private isCurrent(tab: AssemblySourceTabV1, generation: number): boolean {
    return this.epoch !== undefined && this.pathGeneration[tab] === generation;
  }

  private async loadWarehouseFirstPage(generation: number, search: string): Promise<void> {
    const epoch = this.epoch;
    if (epoch === undefined) return;
    try {
      const snapshot = await this.deps.assembly.queryWarehouse(
        epoch.projectId,
        search.trim() === '' ? { limit: ASSEMBLY_WAREHOUSE_PAGE_SIZE } : { search, limit: ASSEMBLY_WAREHOUSE_PAGE_SIZE },
        epoch.controller.signal,
      );
      if (!this.isCurrent('project', generation)) return;
      this.setState({
        warehouseStatus: 'loaded',
        warehouse: snapshot,
        warehouseNextCursor: snapshot.nextCursor,
        warehouseErrorCode: undefined,
        errorCode: undefined,
      });
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      if (!this.isCurrent('project', generation)) return;
      const code = this.errorCodeOf(error);
      this.setState({ warehouseStatus: 'error', warehouseErrorCode: code, errorCode: code });
    }
  }

  private async reloadWarehouseAsync(): Promise<void> {
    const epoch = this.epoch;
    if (epoch === undefined) return;
    const generation = this.bumpPath('project');
    this.setState({ warehouseStatus: 'loading', warehouseErrorCode: undefined, errorCode: undefined, warehouseLoadingMore: false });
    await this.loadWarehouseFirstPage(generation, this.state?.warehouseSearch ?? '');
  }

  private async loadCapture(generation: number): Promise<void> {
    const epoch = this.epoch;
    if (epoch === undefined) return;
    const client = this.deps.captureSpace;
    if (client === undefined) {
      this.setState({ captureStatus: 'error', captureErrorCode: 'unavailable' });
      return;
    }
    try {
      const snapshot = await client.snapshot(undefined, epoch.controller.signal);
      if (!this.isCurrent('capture', generation)) return;
      this.setState({ captureStatus: 'loaded', captureItems: snapshot.items, captureErrorCode: undefined });
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      if (!this.isCurrent('capture', generation)) return;
      this.setState({ captureStatus: 'error', captureErrorCode: this.errorCodeOf(error) });
    }
  }

  private async reloadCaptureAsync(): Promise<void> {
    if (this.epoch === undefined) return;
    const generation = this.bumpPath('capture');
    this.setState({ captureStatus: 'loading', captureErrorCode: undefined });
    await this.loadCapture(generation);
  }

  private async loadResources(generation: number): Promise<void> {
    const epoch = this.epoch;
    if (epoch === undefined) return;
    const client = this.deps.resources;
    if (client === undefined) {
      this.setState({ resourceStatus: 'error', resourceErrorCode: 'unavailable' });
      return;
    }
    try {
      const resources = await client.list(epoch.projectId, epoch.controller.signal);
      if (!this.isCurrent('sources', generation)) return;
      this.setState({ resourceStatus: 'loaded', resources, resourceErrorCode: undefined });
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      if (!this.isCurrent('sources', generation)) return;
      this.setState({ resourceStatus: 'error', resourceErrorCode: this.errorCodeOf(error) });
    }
  }

  private async reloadResourcesAsync(): Promise<void> {
    if (this.epoch === undefined) return;
    const generation = this.bumpPath('sources');
    this.setState({ resourceStatus: 'loading', resourceErrorCode: undefined });
    await this.loadResources(generation);
  }

  private async loadSkills(generation: number): Promise<void> {
    const epoch = this.epoch;
    if (epoch === undefined) return;
    const client = this.deps.skills;
    if (client === undefined) {
      this.setState({ skillStatus: 'error', skillErrorCode: 'unavailable' });
      return;
    }
    try {
      const skills = await client.list(epoch.projectId, undefined, epoch.controller.signal);
      if (!this.isCurrent('skills', generation)) return;
      this.setState({ skillStatus: 'loaded', skills, skillErrorCode: undefined });
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      if (!this.isCurrent('skills', generation)) return;
      this.setState({ skillStatus: 'error', skillErrorCode: this.errorCodeOf(error) });
    }
  }

  private async reloadSkillsAsync(): Promise<void> {
    if (this.epoch === undefined) return;
    const generation = this.bumpPath('skills');
    this.setState({ skillStatus: 'loading', skillErrorCode: undefined });
    await this.loadSkills(generation);
  }

  private setState(patch: Partial<AssemblySourceBayStateV1>): void {
    if (this.state === undefined) return;
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** 追加分页时按 canonical 身份去重（kind:id），不产生重复卡。 */
export function dedupeWarehouseItems<T extends WarehouseItemLikeV1>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set(existing.map((item) => `${item.kind}:${item.entityRef.id}`));
  const merged = [...existing];
  for (const item of incoming) {
    const key = `${item.kind}:${item.entityRef.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/** 去重所需的最小行形状（与 WarehouseItemV1 兼容）。 */
export interface WarehouseItemLikeV1 {
  readonly kind: string;
  readonly entityRef: { readonly id: string };
}