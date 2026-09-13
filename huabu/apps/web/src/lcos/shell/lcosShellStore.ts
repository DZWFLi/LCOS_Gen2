// lcosShellStore — LCOS 局部 UI intent（可丢失）。禁止放 Project/Run/Relation truth。
// 只放：activeSurface、open region、draft、focus/hover 等 ephemeral intent。

import { create } from 'zustand';

export type LcosSurfaceKey = 'main' | 'context' | 'workflow';

export const LCOS_SURFACES: readonly { key: LcosSurfaceKey; label: string }[] = [
  { key: 'main', label: 'Main' },
  { key: 'context', label: 'Context' },
  { key: 'workflow', label: 'Workflow' },
];

export const SURFACE_LABEL: Readonly<Record<LcosSurfaceKey, string>> = {
  main: 'Main',
  context: 'Context',
  workflow: 'Workflow',
};

export interface LcosLocateRequest {
  /** 请求唯一 id（pipeline 消费后 clear，避免重复 focus）。 */
  readonly reqId: string;
  /** 目标现场；与当前现场不同时先切现场再 pendingFocus。 */
  readonly surface: LcosSurfaceKey;
  /** 目标 canvasId（可选；resolve 用 workspace）。 */
  readonly canvasId?: string;
  /** 当前现场已存在该 nodeId → 直接 focus（无需换现场）。 */
  readonly nodeId?: string;
  /** 未投影 → unavailable 展示原因（不假定位）。 */
  readonly status?: 'projected' | 'unprojected' | 'unavailable';
}

export type LcosCameraCommandKind = 'zoom-in' | 'zoom-out' | 'fit' | 'reset';

/** Professional body 键（body registry）。 */
export type LcosProfessionalBodyKey =
  | 'assembly'
  | 'reader'
  | 'conversation'
  | 'runtime-doctor'
  | 'capture-inbox'
  | 'connector-source';

export interface LcosWindow {
  readonly id: string;
  readonly bodyKey: LcosProfessionalBodyKey;
  readonly title: string;
  /** body 上下文（如 artifactId / projectId）。 */
  readonly target?: string;
  readonly active: boolean;
}

export interface LcosShellUiState {
  projectId: string | null;
  activeSurface: LcosSurfaceKey;
  /** 现场 → stable canvasId（只读镜像；真实性来自 Core workspaces）。 */
  surfaceCanvasId: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  /** 画布内待执行命令（route-level 组件发布，canvas-local overlay 消费）。 */
  cameraRequest: { id: number; kind: LcosCameraCommandKind } | null;
  locateRequest: LcosLocateRequest | null;
  /** route-level Professional 窗口（只放窗口拓扑 intent；body 数据仍在 Core）。 */
  windows: readonly LcosWindow[];
  setProject(projectId: string): void;
  setActiveSurface(surface: LcosSurfaceKey): void;
  setSurfaceCanvasId(surface: LcosSurfaceKey, canvasId: string): void;
  setSurfaceCanvasMap(map: Readonly<Partial<Record<LcosSurfaceKey, string>>>): void;
  requestCamera(kind: LcosCameraCommandKind): void;
  requestLocate(request: LcosLocateRequest): void;
  consumeCamera(): void;
  consumeLocate(): void;
  openWindow(bodyKey: LcosProfessionalBodyKey, title: string, target?: string): void;
  closeWindow(id: string): void;
  activateWindow(id: string): void;
  clear(): void;
}

export const useLcosShellStore = create<LcosShellUiState>((set) => ({
  projectId: null,
  activeSurface: 'main',
  surfaceCanvasId: {},
  cameraRequest: null,
  locateRequest: null,
  windows: [],
  setProject: (projectId) => set({ projectId }),
  setActiveSurface: (activeSurface) => set({ activeSurface }),
  setSurfaceCanvasId: (surface, canvasId) =>
    set((s) => ({ surfaceCanvasId: { ...s.surfaceCanvasId, [surface]: canvasId } })),
  setSurfaceCanvasMap: (map) => set({ surfaceCanvasId: map }),
  requestCamera: (kind) =>
    set((s) => ({ cameraRequest: { id: (s.cameraRequest?.id ?? 0) + 1, kind } })),
  requestLocate: (request) => set({ locateRequest: request }),
  consumeCamera: () => set({ cameraRequest: null }),
  consumeLocate: () => set({ locateRequest: null }),
  openWindow: (bodyKey, title, target) =>
    set((s) => {
      const existing = s.windows.find((w) => w.bodyKey === bodyKey && (target === undefined || w.target === target));
      if (existing) {
        return { windows: s.windows.map((w) => ({ ...w, active: w.id === existing.id })) };
      }
      const id = `${bodyKey}-${Date.now()}`;
      return { windows: [...s.windows.map((w) => ({ ...w, active: false })), { id, bodyKey, title, target, active: true }] };
    }),
  closeWindow: (id) =>
    set((s) => {
      const remaining = s.windows.filter((w) => w.id !== id);
      if (remaining.length === 0) return { windows: [] };
      const anyActive = remaining.some((w) => w.active);
      return { windows: anyActive ? remaining : remaining.map((w, i) => (i === remaining.length - 1 ? { ...w, active: true } : w)) };
    }),
  activateWindow: (id) =>
    set((s) => ({ windows: s.windows.map((w) => ({ ...w, active: w.id === id })) })),
  clear: () =>
    set({
      projectId: null,
      activeSurface: 'main',
      surfaceCanvasId: {},
      cameraRequest: null,
      locateRequest: null,
      windows: [],
    }),
}));