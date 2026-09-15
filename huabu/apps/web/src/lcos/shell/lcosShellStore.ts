// lcosShellStore — LCOS 局部 UI intent（可丢失）。禁止放 Project/Run/Relation truth。
// 只放：activeSurface、open region、draft、focus/hover 等 ephemeral intent。

import { create } from 'zustand';

import type { AssemblyTargetRefV1 } from '@local-creative-os/contracts';
import type { ProfessionalWindowEnvironmentV1 } from '@local-creative-os/web-gen2';

export type LcosSurfaceKey = 'main' | 'context' | 'workflow';

export const LCOS_SURFACES: readonly { key: LcosSurfaceKey; label: string }[] =
  [
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

/**
 * Same-tab return context for a Context/Workflow child worksite.
 * This is UI navigation state only; the workspace and canvas remain owned by Core/Huabu.
 */
export interface LcosChildReturn {
  readonly projectId: string;
  readonly sourceSurface: LcosSurfaceKey;
  readonly sourceWorkspaceId?: string;
  readonly sourceWasChild: boolean;
  readonly sourceCanvasId?: string;
  readonly selectedNodeIds: readonly string[];
}

export type LcosCameraCommandKind = 'zoom-in' | 'zoom-out' | 'fit' | 'reset';

/** Selection-local Composer intent. It is ephemeral UI state, never Run truth. */
export interface LcosComposerTarget {
  readonly nodeId: string;
  /** User-facing target identity captured from the selected node. */
  readonly title: string;
  readonly anchor: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly workspaceId?: string;
  /** Canonical connected-conversation receiver, only set after an explicit Core identity read. */
  readonly receiverConversationId?: string;
  /** Optional honest block reason for a host that cannot resolve a receiver yet. */
  readonly receiverBlockedReason?: string;
}

/** Professional body 键（body registry）。 */
export type LcosProfessionalBodyKey =
  | 'assembly'
  | 'reader'
  | 'conversation'
  | 'portal-preview'
  | 'runtime-doctor'
  | 'capture-inbox'
  | 'connector-source';

export interface LcosWindow {
  readonly id: string;
  readonly bodyKey: LcosProfessionalBodyKey;
  readonly title: string;
  /** body 上下文（如 artifactId / projectId）。 */
  readonly target?: string;
  /** Explicit address kind; an entity id must never be fetched as a canvas id. */
  readonly targetKind?: 'canvas';
  /** Assembly caller 注入的 canonical target；Assembly 本身不保存 target truth。 */
  readonly assemblyTargetRef?: AssemblyTargetRefV1;
  readonly active: boolean;
}

/**
 * Window topology intent is separate from the window instances themselves.
 * A region owns grouping/layout; an instance owns body identity and target.
 * Geometry is published by ProfessionalWindowStage, never inferred here.
 */
export type LcosWindowRegionLayout = 'floating' | 'docked-right';

export interface LcosWindowRegion {
  readonly id: string;
  readonly layout: LcosWindowRegionLayout;
  readonly windowIds: readonly string[];
  readonly activeWindowId: string;
}

export interface LcosShellUiState {
  projectId: string | null;
  activeSurface: LcosSurfaceKey;
  /** 当前 Surface 对应的真实 Core workspace；只读镜像，用于 Run/Assembly target。 */
  activeWorkspaceId: string | null;
  /** 现场 → stable canvasId（只读镜像；真实性来自 Core workspaces）。 */
  surfaceCanvasId: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  /** 画布内待执行命令（route-level 组件发布，canvas-local overlay 消费）。 */
  cameraRequest: { id: number; kind: LcosCameraCommandKind } | null;
  locateRequest: LcosLocateRequest | null;
  composerOpen: boolean;
  composerTarget: LcosComposerTarget | null;
  composerPrompt: string;
  /** route-level Professional 窗口（只放窗口拓扑 intent；body 数据仍在 Core）。 */
  windows: readonly LcosWindow[];
  /** Window instances → regions 的拓扑关系；不会把所有 instance 自动变成一个 tab 组。 */
  windowRegions: readonly LcosWindowRegion[];
  /** 由 ProfessionalWindowStage 唯一发布的临时占位环境。 */
  windowEnvironment: ProfessionalWindowEnvironmentV1 | null;
  /** Child worksite 的来源现场；刷新后允许丢失，返回按钮仍有安全 fallback。 */
  childReturn: LcosChildReturn | null;
  setProject(projectId: string): void;
  setActiveSurface(surface: LcosSurfaceKey): void;
  setActiveWorkspaceId(workspaceId: string | null): void;
  setSurfaceCanvasId(surface: LcosSurfaceKey, canvasId: string): void;
  setSurfaceCanvasMap(
    map: Readonly<Partial<Record<LcosSurfaceKey, string>>>,
  ): void;
  beginChildNavigation(returnContext: LcosChildReturn): void;
  clearChildNavigation(): void;
  requestCamera(kind: LcosCameraCommandKind): void;
  requestLocate(request: LcosLocateRequest): void;
  consumeCamera(): void;
  consumeLocate(): void;
  openComposer(target: LcosComposerTarget): void;
  closeComposer(): void;
  setComposerPrompt(prompt: string): void;
  clearSubmittedComposerPrompt(projectId: string, target: LcosComposerTarget, prompt: string): void;
  openWindow(
    bodyKey: LcosProfessionalBodyKey,
    title: string,
    target?: string,
    targetKind?: 'canvas',
  ): void;
  openAssembly(targetRef: AssemblyTargetRefV1, title?: string): void;
  closeWindow(id: string): void;
  activateWindow(id: string): void;
  setWindowRegionLayout(regionId: string, layout: LcosWindowRegionLayout): void;
  publishWindowEnvironment(environment: ProfessionalWindowEnvironmentV1): void;
  clearWindowEnvironment(): void;
  clear(): void;
}

type ProjectUiSession = Pick<LcosShellUiState,
  'windows' | 'windowRegions' | 'composerPrompt' | 'composerTarget' | 'composerOpen' | 'activeSurface'>;

// Same-tab project switching only. This is UI continuity, not reload persistence.
const projectUiSessions = new Map<string, ProjectUiSession>();

export const useLcosShellStore = create<LcosShellUiState>((set) => ({
  projectId: null,
  activeSurface: 'main',
  activeWorkspaceId: null,
  surfaceCanvasId: {},
  cameraRequest: null,
  locateRequest: null,
  composerOpen: false,
  composerTarget: null,
  composerPrompt: '',
  windows: [],
  windowRegions: [],
  windowEnvironment: null,
  childReturn: null,
  setProject: (projectId) => set((state) => {
    if (state.projectId === projectId) return state;
    if (state.projectId !== null) {
      projectUiSessions.set(state.projectId, {
        windows: state.windows,
        windowRegions: state.windowRegions,
        composerPrompt: state.composerPrompt,
        composerTarget: state.composerTarget,
        composerOpen: state.composerOpen,
        activeSurface: state.activeSurface,
      });
    }
    const restored = projectUiSessions.get(projectId);
    return {
      projectId,
      windows: restored?.windows ?? [],
      windowRegions: restored?.windowRegions ?? [],
      windowEnvironment: null,
      composerPrompt: restored?.composerPrompt ?? '',
      composerTarget: restored?.composerTarget ?? null,
      composerOpen: restored?.composerOpen ?? false,
      activeSurface: restored?.activeSurface ?? 'main',
      childReturn: null,
      activeWorkspaceId: null,
      surfaceCanvasId: {},
      cameraRequest: null,
      locateRequest: null,
    };
  }),
  setActiveSurface: (activeSurface) => set({ activeSurface }),
  setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
  setSurfaceCanvasId: (surface, canvasId) =>
    set((s) => ({
      surfaceCanvasId: { ...s.surfaceCanvasId, [surface]: canvasId },
    })),
  setSurfaceCanvasMap: (map) => set({ surfaceCanvasId: map }),
  beginChildNavigation: (childReturn) => set({ childReturn }),
  clearChildNavigation: () => set({ childReturn: null }),
  requestCamera: (kind) =>
    set((s) => ({
      cameraRequest: { id: (s.cameraRequest?.id ?? 0) + 1, kind },
    })),
  requestLocate: (request) => set({ locateRequest: request }),
  consumeCamera: () => set({ cameraRequest: null }),
  consumeLocate: () => set({ locateRequest: null }),
  openComposer: (composerTarget) => set({ composerOpen: true, composerTarget }),
  closeComposer: () => set({ composerOpen: false }),
  setComposerPrompt: (composerPrompt) => set({ composerPrompt }),
  clearSubmittedComposerPrompt: (projectId, target, prompt) => set((state) => {
    if (state.projectId === projectId) {
      return state.composerTarget === target && state.composerPrompt === prompt
        ? { composerPrompt: '' } : state;
    }
    const saved = projectUiSessions.get(projectId);
    if (saved?.composerTarget === target && saved.composerPrompt === prompt) {
      projectUiSessions.set(projectId, { ...saved, composerPrompt: '' });
    }
    return state;
  }),
  openWindow: (bodyKey, title, target, targetKind) =>
    set((s) => {
      const existing = s.windows.find(
        (w) =>
          w.bodyKey === bodyKey &&
          w.targetKind === targetKind &&
          w.target === target,
      );
      if (existing) {
        return {
          windows: s.windows.map((w) => ({
            ...w,
            active: w.id === existing.id,
          })),
          windowRegions: s.windowRegions.map((region) =>
            region.windowIds.includes(existing.id)
              ? { ...region, activeWindowId: existing.id }
              : region,
          ),
        };
      }
      const id = `${bodyKey}-${crypto.randomUUID()}`;
      return {
        windows: [
          ...s.windows.map((w) => ({ ...w, active: false })),
          { id, bodyKey, title, target, ...(targetKind ? { targetKind } : {}), active: true },
        ],
        windowRegions: [
          ...s.windowRegions.map((region) => ({ ...region, activeWindowId: region.activeWindowId })),
          { id: `region-${id}`, layout: 'floating', windowIds: [id], activeWindowId: id },
        ],
      };
    }),
  openAssembly: (assemblyTargetRef, title = 'Assembly') =>
    set((s) => {
      const sameTarget = (window: LcosWindow): boolean =>
        window.bodyKey === 'assembly' &&
        window.assemblyTargetRef?.kind === assemblyTargetRef.kind &&
        ('id' in assemblyTargetRef
          ? window.assemblyTargetRef !== undefined &&
            'id' in window.assemblyTargetRef &&
            window.assemblyTargetRef.id === assemblyTargetRef.id
          : window.assemblyTargetRef !== undefined &&
            !('id' in window.assemblyTargetRef));
      const existing = s.windows.find(sameTarget);
      if (existing) {
        return {
          windows: s.windows.map((window) => ({
            ...window,
            active: window.id === existing.id,
          })),
          windowRegions: s.windowRegions.map((region) =>
            region.windowIds.includes(existing.id)
              ? { ...region, activeWindowId: existing.id }
              : region,
          ),
        };
      }
      const id = `assembly-${crypto.randomUUID()}`;
      return {
        windows: [
          ...s.windows.map((window) => ({ ...window, active: false })),
          {
            id,
            bodyKey: 'assembly',
            title,
            assemblyTargetRef,
            active: true,
          },
        ],
        windowRegions: [
          ...s.windowRegions.map((region) => ({ ...region, activeWindowId: region.activeWindowId })),
          { id: `region-${id}`, layout: 'floating', windowIds: [id], activeWindowId: id },
        ],
      };
    }),
  closeWindow: (id) =>
    set((s) => {
      const remaining = s.windows.filter((w) => w.id !== id);
      const windowRegions = s.windowRegions
        .map((region) => {
          if (!region.windowIds.includes(id)) return region;
          const windowIds = region.windowIds.filter((windowId) => windowId !== id);
          if (windowIds.length === 0) return undefined;
          const activeWindowId = region.activeWindowId === id
            ? windowIds[windowIds.length - 1]
            : region.activeWindowId;
          return { ...region, windowIds, activeWindowId };
        })
        .filter((region): region is LcosWindowRegion => region !== undefined);
      if (remaining.length === 0) return { windows: [], windowRegions };
      const anyActive = remaining.some((w) => w.active);
      return {
        windows: anyActive
          ? remaining
          : remaining.map((w, i) =>
              i === remaining.length - 1 ? { ...w, active: true } : w,
            ),
        windowRegions,
      };
    }),
  activateWindow: (id) =>
    set((s) => ({
      windows: s.windows.map((w) => ({ ...w, active: w.id === id })),
      windowRegions: s.windowRegions.map((region) =>
        region.windowIds.includes(id) ? { ...region, activeWindowId: id } : region,
      ),
    })),
  setWindowRegionLayout: (regionId, layout) =>
    set((s) => ({
      windowRegions: s.windowRegions.map((region) =>
        region.id === regionId ? { ...region, layout } : region,
      ),
    })),
  publishWindowEnvironment: (windowEnvironment) => set({ windowEnvironment }),
  clearWindowEnvironment: () => set({ windowEnvironment: null }),
  clear: () => {
    projectUiSessions.clear();
    set({
      projectId: null,
      activeSurface: 'main',
      activeWorkspaceId: null,
      surfaceCanvasId: {},
      cameraRequest: null,
      locateRequest: null,
      composerOpen: false,
      composerTarget: null,
      composerPrompt: '',
      windows: [],
      windowRegions: [],
      windowEnvironment: null,
      childReturn: null,
    });
  },
}));
