// useLcosWorksite — 项目工作现场（workspace↔canvasId）解析与建立控制。
// 真实性：workspaces 来自 Core route；canvasId 缺失时 createCanvas（Huabu 唯一画布创建命令）
// 并回写 workspace.canvasId（T2 C2-1D 机制；Wave 2 换为 Gen2 runtime retarget 时保持同一流程）。
// 禁止把 canvas title / URL 猜成 project identity。

import { useCallback, useEffect, useMemo, useState } from 'react';

import { createCanvas } from '@/api/canvas';


import { createLcosCoreSession, type LcosCoreSession } from './lcosCoreClient';
import { useLcosShellStore, type LcosSurfaceKey } from '../shell/lcosShellStore';

import type { Workspace } from '@local-creative-os/domain';

export type WorksiteStatus =
  | 'loading'
  | 'ready'
  | 'offline'
  | 'error';

export interface LcosWorksiteState {
  readonly status: WorksiteStatus;
  readonly statusDetail?: string;
  readonly projectName: string | null;
  readonly workspaces: readonly Workspace[];
  readonly surfaceCanvasId: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  ensureSurfaceCanvas(surface: LcosSurfaceKey): Promise<string | undefined>;
  retry(): void;
}

const SURFACE_PREFERENCE: Readonly<Record<LcosSurfaceKey, string>> = {
  main: 'main',
  context: 'context',
  workflow: 'workflow',
};

export function useLcosWorksite(projectId: string): LcosWorksiteState {
  const session: LcosCoreSession = useMemo(() => createLcosCoreSession(), []);
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [status, setStatus] = useState<WorksiteStatus>('loading');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  const surfaceCanvasId = useLcosShellStore((s) => s.surfaceCanvasId);
  const setSurfaceCanvasMap = useLcosShellStore((s) => s.setSurfaceCanvasMap);
  const setSurfaceCanvasId = useLcosShellStore((s) => s.setSurfaceCanvasId);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const [list, ws] = await Promise.all([
          session.projects.listProjects(),
          session.projects.getWorkspaces(projectId),
        ]);
        if (cancelled) return;
        const matched = list.find((p) => p.id === projectId);
        setProjectName(matched?.name ?? null);
        const map: Partial<Record<LcosSurfaceKey, string>> = {};
        for (const workspace of ws) {
          const pref = workspace.preferredSurface as LcosSurfaceKey | undefined;
          if (pref && workspace.canvasId !== undefined) map[pref] = workspace.canvasId;
        }
        setSurfaceCanvasMap(map);
        setWorkspaces(ws);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        const code = (error as { code?: string }).code;
        setStatus(code === 'network' || code === 'aborted' ? 'offline' : 'error');
        setStatusDetail(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reloadKey]);

  const ensureSurfaceCanvas = useCallback(
    async (surface: LcosSurfaceKey): Promise<string | undefined> => {
      const existing = surfaceCanvasId[surface];
      if (existing) return existing;
      const workspace = workspaces.find((w) => w.preferredSurface === SURFACE_PREFERENCE[surface]);
      if (!workspace) return undefined;
      try {
        const created = await createCanvas();
        await session.projects.updateWorkspaceCanvasId(projectId, String(workspace.id), created.canvasId);
        setSurfaceCanvasId(surface, created.canvasId);
        return created.canvasId;
      } catch (error) {
        setStatusDetail(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
    [surfaceCanvasId, workspaces, session, projectId, setSurfaceCanvasId],
  );

  const retry = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  return {
    status,
    statusDetail,
    projectName,
    workspaces,
    surfaceCanvasId,
    ensureSurfaceCanvas,
    retry,
  };
}