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

export interface LcosShellUiState {
  projectId: string | null;
  activeSurface: LcosSurfaceKey;
  /** 现场 → stable canvasId（只读镜像；真实性来自 Core workspaces）。 */
  surfaceCanvasId: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  setProject(projectId: string): void;
  setActiveSurface(surface: LcosSurfaceKey): void;
  setSurfaceCanvasId(surface: LcosSurfaceKey, canvasId: string): void;
  setSurfaceCanvasMap(map: Readonly<Partial<Record<LcosSurfaceKey, string>>>): void;
  clear(): void;
}

export const useLcosShellStore = create<LcosShellUiState>((set) => ({
  projectId: null,
  activeSurface: 'main',
  surfaceCanvasId: {},
  setProject: (projectId) => set({ projectId }),
  setActiveSurface: (activeSurface) => set({ activeSurface }),
  setSurfaceCanvasId: (surface, canvasId) =>
    set((s) => ({ surfaceCanvasId: { ...s.surfaceCanvasId, [surface]: canvasId } })),
  setSurfaceCanvasMap: (map) => set({ surfaceCanvasId: map }),
  clear: () => set({ projectId: null, activeSurface: 'main', surfaceCanvasId: {} }),
}));