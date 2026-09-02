// SurfacePort (Phase A08): 三现场共享协议但不共享状态。
//
// F-ROOT-06 / F-SURFACE: Main / Context / Workflow 是同一物理内核下的独立一等
// 现场，物理同构。Phase A 只建立协议与注册表，不创建三个 ReactFlow —— 一个
// Huabu runtime 根据当前 project+surface 装相应的 canvas identity。每个现场
// 拥有独立 canvasId 与 Huabu persistence；相机 / selection / history 由
// canvasId 隔离。
//
// 身份规则（F-SURFACE §10 冻结）：
//   - projectId 相同、surface key 不同 → canvasId 必须不同。
//   - 同一 artifact 可投影到多个 canvas；每个 binding 由 projectId+canvasId+
//     entity 唯一（ProjectionBinding 已用该 key）。
//   - 关系是否跨 surface 可见由投影策略决定，不复制 Core relation。
//   - Main 不叫 active workspace；文案为 “Project Main Presentation / 主现场”。
//
// 本模块纯逻辑、可测：不含任何 DOM/React/网络。

/** 现场 key。Phase A 具名冻结三个一等现场；未来通过 registry 扩展。 */
export type SurfaceKeyName = 'main' | 'context' | 'workflow';

export interface SurfaceDescriptor {
  readonly key: SurfaceKeyName;
  /** 恒定、可读的展示名称（主现场，不用 active workspace）。 */
  readonly label: string;
  /** 该现场在 Huabu 空间中的 canvas identity，随 projectId 组合。 */
  readonly canvasId: string;
  readonly capabilities: ReadonlySet<SurfaceCapability>;
}

export type SurfaceCapability =
  | 'place-artifact'
  | 'compose-run'
  | 'inspect-context'
  | 'edit-workflow'
  | 'open-work-view';

/**
 * 现场端口 —— 对某个已装载现场的最小只读视图。uc 抽象“一个现场能做什么 +
 * 它落在哪张 canvas”，host 据此路由而不持有三个现场状态。
 */
export interface SurfacePort {
  readonly key: SurfaceKeyName;
  readonly label: string;
  readonly canvasId: string;
  readonly hasCapability: (cap: SurfaceCapability) => boolean;
}

export interface SurfacePorts {
  readonly main: SurfacePort;
  readonly context: SurfacePort;
  readonly workflow: SurfacePort;
}

function harnessedPort(descriptor: SurfaceDescriptor): SurfacePort {
  return {
    key: descriptor.key,
    label: descriptor.label,
    canvasId: descriptor.canvasId,
    hasCapability: (cap) => descriptor.capabilities.has(cap),
  };
}

export type SurfaceRegistryDeps = {
  /** 组装一个现场 descriptor。Phase A 各现场共用同一 Huabu runtime，仅 canvasId 不同。 */
  readonly portFor: (key: SurfaceKeyName) => SurfaceDescriptor;
};

/**
 * 现场注册表：把 key 解析成当前已装载的现场端口。projectId 相同、key 不同
 * canvasId 必须不同的约束在构造时校验（fail-close，拒绝错误装载）。
 */
export class SurfaceRegistry {
  private readonly ports: SurfacePorts;

  constructor(
    private readonly deps: SurfaceRegistryDeps,
    readonly projectId: string,
  ) {
    this.ports = {
      main: harnessedPort(this.deps.portFor('main')),
      context: harnessedPort(this.deps.portFor('context')),
      workflow: harnessedPort(this.deps.portFor('workflow')),
    };
    this.assertDistinctCanvas();
  }

  /** 解析一个 key 到端口；未装载则抛出（fail-close，不静默 fallback）。 */
  current(key: SurfaceKeyName): SurfacePort {
    const port = this.ports[key];
    if (!port) throw new Error(`Surface port unavailable: ${key}`);
    return port;
  }

  /** 装载全部三个现场（同一 runtime 的三种 canvas identity）。 */
  all(): SurfacePorts {
    return this.ports;
  }

  private assertDistinctCanvas(): void {
    const seen = new Set<string>();
    for (const key of ['main', 'context', 'workflow'] as const) {
      const port = this.ports[key];
      if (seen.has(port.canvasId)) {
        throw new Error(
          `Surface identity collision: two surfaces share canvasId '${port.canvasId}' under project ${this.projectId}. ` +
            `F-SURFACE §10 requires distinct canvasId per surface.`,
        );
      }
      seen.add(port.canvasId);
    }
  }
}
