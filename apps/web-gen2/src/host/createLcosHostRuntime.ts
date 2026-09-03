// LCOS host runtime (Phase A10) — Gen2Host 收窄与生命周期。
//
// 当前事实：Gen2Host 只有 project/artifacts/relations/search typed clients；
// Local Core 已有 runs/runtime/workflow/workbench/voice/skill-author 等大量 route。
// Phase A 不把 facade 扩成 199 方法 monolith。
//
// 决策：按功能 dock 拆 client；Host 只持有稳定能力组。Phase A 只登记缺口与
// 创建 ports 接口（DockGapRegistry），不实现 Phase C 功能 —— 每个后续 port 必须
// 直接对应已有 Core route/contract；若 Core 没有，先证明旧 LCOS 语义是否
// canonical，不能 UI 自造。
//
// 生命周期契约（验收主项）：
//   - Host 创建一次；React re-render 不重复 new binding registry/reconciler。
//   - dispose 时清理 reconciler timer。
//   - project change 销毁旧 host 并创建新 host。
//   - token/URL change 不泄漏旧 client（重装配 new config）。
//
// 本模块是“配置 + 一次创建 → 持有 → 切换/dispose”的唯一装配点，宿主页与测试
// 复用；Gen2Host facade 本身保持兼容（不强制拆内部 client）。

import type { Gen2Host } from './projectionFacade.js';

/** 端点与认证配置 —— 变化随时可重装配 host（不泄漏旧 client）。 */
export interface LcosEndpointConfig {
  readonly coreUrl: string;
  readonly coreToken: string;
  readonly rfsBaseUrl: string;
  readonly rfsToken: string;
  readonly canvasId: string;
}

export interface LcosHostRuntime {
  readonly host: Gen2Host;
  /** 当前装配的 canvas identity（host 的 RFS 目标），供宿主判断是否需重定向。 */
  readonly canvasId: string;
  readonly projectId: string;
  /**
   * 在同一个 session 内重新装配配置（画布就绪 / 切 project 后调用）。
   * 只销毁旧 host 的 reconciler timer 并用新配置重建一个 host，宿主侧
   * 持有的 seam/extension 引用保持不变。无变化的调用是 no-op。
   */
  retarget(next: { projectId?: string; canvasId?: string }): void;
  /** 卸载/切项目：彻底清理 reconciler timer 与引用。 */
  dispose(): void;
  readonly disposed: boolean;
}

/** A10 端口缺口登记 —— 只登记，不实现。 */
export type PhaseCDock = 'run' | 'workflow' | 'skill' | 'voice' | 'workbench';

export interface DockGapRegistry {
  readonly dock: PhaseCDock;
  /** 该 dock 对应的 Core route/contract（Phase A 登记；缺证时为 null）。 */
  readonly coreContract: string | null;
  /** UI 是否已在该 dock 自行造语义（Phase A 必须为 false —— 不许自造）。 */
  readonly uiFabricated: false;
}

/** 登记的正本证据：runs/runtime/workflow/workbench/voice/skill-author 等 Core route。 */
export const DOCK_GAP_REGISTRY: readonly DockGapRegistry[] = [
  { dock: 'run', coreContract: 'runs', uiFabricated: false },
  { dock: 'workflow', coreContract: 'workflow', uiFabricated: false },
  { dock: 'skill', coreContract: 'skill-author', uiFabricated: false },
  { dock: 'voice', coreContract: 'voice', uiFabricated: false },
  { dock: 'workbench', coreContract: 'workbench', uiFabricated: false },
];

export interface CreateLcosRuntimeDeps {
  /** 用当前配置 + projectId 装配一个持有 reconciler 的 Gen2Host。 */
  build(config: LcosEndpointConfig, projectId: string): Gen2Host;
}

/**
 * 装配带生命周期的 host runtime。创建一次；switchProject 销毁旧 host 并重建
 * （旧 reconciler 的 timer 被 dispose）；dispose 彻底清理。每次重建 new 一套
 * binding registry / reconciler，但只发生在 project/config 变化时，不在 React
 * re-render 重复执行（值守方应在 effect 里只调一次构建，用 projectId 驱动切换）。
 */
export function createLcosHostRuntime(
  deps: CreateLcosRuntimeDeps,
  config: LcosEndpointConfig,
  initialProjectId: string,
): LcosHostRuntime {
  let host: Gen2Host = deps.build(config, initialProjectId);
  let projectId = initialProjectId;
  let canvasId = config.canvasId;
  let disposed = false;

  const runtime: LcosHostRuntime = {
    get host() {
      return host;
    },
    get disposed() {
      return disposed;
    },
    get projectId() {
      return projectId;
    },
    get canvasId() {
      return canvasId;
    },
    retarget(next: { projectId?: string; canvasId?: string }) {
      if (disposed) return;
      const wantProject = next.projectId ?? projectId;
      const wantCanvas = next.canvasId ?? canvasId;
      if (wantProject === projectId && wantCanvas === canvasId) return;
      disposeHost(host);
      host = deps.build({ ...config, canvasId: wantCanvas }, wantProject);
      projectId = wantProject;
      canvasId = wantCanvas;
    },
    dispose() {
      if (disposed) return;
      disposeHost(host);
      disposed = true;
    },
  };
  return runtime;
}

function disposeHost(host: Gen2Host): void {
  host.reconciler.dispose();
}
