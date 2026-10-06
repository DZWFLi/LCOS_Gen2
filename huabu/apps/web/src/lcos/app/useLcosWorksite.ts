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
  readonly rootScopeId?: string;
  readonly workspaces: readonly Workspace[];
  readonly surfaceCanvasId: Readonly<Partial<Record<LcosSurfaceKey, string>>>;
  /** workspaceId → surface（FocusWhere 跨现场行映射用）。 */
  readonly surfaceByWorkspace: Readonly<Map<string, LcosSurfaceKey>>;
  /**
   * 建立/确保现场画布；force=true 时即使已有映射也重建（引用失效恢复路径，
   * 见 WorksiteStage「重新建立现场画布」）。
   */
  ensureSurfaceCanvas(surface: LcosSurfaceKey, force?: boolean): Promise<string | undefined>;
  /** Same operation for an explicitly addressed child workspace. */
  ensureWorkspaceCanvas(workspaceId: string, force?: boolean): Promise<string | undefined>;
  retry(): void;
}

const SURFACE_PREFERENCE: Readonly<Record<LcosSurfaceKey, string>> = {
  main: 'main',
  context: 'context',
  workflow: 'workflow',
};

/**
 * Resolve only the three root surface workspaces for SurfaceDock.
 *
 * A canonical Workflow scope can own several child workspaces, all carrying
 * `preferredSurface: workflow`. Those are explicit `?workspaceId=` targets;
 * they must never make the root `/projects/:id/workflow` route ambiguous.
 * The root scope id comes from the Core graph, so this selection does not
 * infer a target from a title, order, or the first array item.
 */
export function buildSurfaceCanvasMap(
  workspaces: readonly Workspace[],
  rootScopeId: string,
): Partial<Record<LcosSurfaceKey, string>> {
  const bySurface = new Map<LcosSurfaceKey, readonly Workspace[]>();
  for (const workspace of workspaces) {
    const pref = workspace.preferredSurface as LcosSurfaceKey | undefined;
    if (!pref || !Object.prototype.hasOwnProperty.call(SURFACE_PREFERENCE, pref)) continue;
    if (String(workspace.scopeId) !== rootScopeId) continue;
    bySurface.set(pref, [...(bySurface.get(pref) ?? []), workspace]);
  }
  const map: Partial<Record<LcosSurfaceKey, string>> = {};
  for (const [pref, candidates] of bySurface) {
    if (candidates.length === 1 && candidates[0]?.canvasId !== undefined) map[pref] = candidates[0].canvasId;
  }
  return map;
}

export function useLcosWorksite(projectId: string): LcosWorksiteState {
  const session: LcosCoreSession = useMemo(() => createLcosCoreSession(), []);
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [surfaceByWorkspace, setSurfaceByWorkspace] = useState<Readonly<Map<string, LcosSurfaceKey>>>(new Map());
  const [projectName, setProjectName] = useState<string | null>(null);
  const [rootScopeId, setRootScopeId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<WorksiteStatus>('loading');
  const [statusDetail, setStatusDetail] = useState<string | undefined>(undefined);
  const [reloadKey, setReloadKey] = useState(0);

  const surfaceCanvasId = useLcosShellStore((s) => s.surfaceCanvasId);
  const setSurfaceCanvasMap = useLcosShellStore((s) => s.setSurfaceCanvasMap);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    void (async () => {
      try {
        const [list, ws, graph] = await Promise.all([
          session.projects.listProjects(),
          session.projects.getWorkspaces(projectId),
          session.projects.getProjectGraph(projectId),
        ]);
        if (cancelled) return;
        const nextRootScopeId = graph?.scopes.find((scope) => scope.kind === 'root')?.id;
        if (nextRootScopeId === undefined) {
          throw new Error('Project graph has no canonical root scope.');
        }
        const matched = list.find((p) => p.id === projectId);
        setProjectName(matched?.name ?? null);
        setRootScopeId(String(nextRootScopeId));
        const workspaceSurface = new Map<string, LcosSurfaceKey>();
        for (const workspace of ws) {
          const pref = workspace.preferredSurface as LcosSurfaceKey | undefined;
          if (!pref || !Object.prototype.hasOwnProperty.call(SURFACE_PREFERENCE, pref)) continue;
          workspaceSurface.set(String(workspace.id), pref);
        }
        setSurfaceByWorkspace(workspaceSurface);
        setSurfaceCanvasMap(buildSurfaceCanvasMap(ws, String(nextRootScopeId)));
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

  const ensureWorkspaceCanvas = useCallback(
    async (workspaceId: string, force = false): Promise<string | undefined> => {
      try {
        const publishWorkspaces = (next: readonly Workspace[]): void => {
          setWorkspaces(next);
          const workspaceSurface = new Map<string, LcosSurfaceKey>();
          for (const candidate of next) {
            const pref = candidate.preferredSurface as LcosSurfaceKey | undefined;
            if (!pref || !Object.prototype.hasOwnProperty.call(SURFACE_PREFERENCE, pref)) continue;
            workspaceSurface.set(String(candidate.id), pref);
          }
          setSurfaceByWorkspace(workspaceSurface);
          if (rootScopeId !== undefined) setSurfaceCanvasMap(buildSurfaceCanvasMap(next, rootScopeId));
        };
        // Railway can save a new canonical workspace after this hook mounted.
        // Re-read that identity before using the existing canvas creation owner.
        let currentWorkspaces = workspaces;
        let workspace = currentWorkspaces.find((candidate) => String(candidate.id) === workspaceId);
        if (workspace === undefined) {
          currentWorkspaces = await session.projects.getWorkspaces(projectId);
          workspace = currentWorkspaces.find((candidate) => String(candidate.id) === workspaceId
            && String(candidate.projectId) === projectId);
        }
        if (workspace === undefined) throw new Error('这个现场尚未保存到当前项目。');
        if (!force && workspace.canvasId !== undefined) {
          publishWorkspaces(currentWorkspaces);
          return workspace.canvasId;
        }
        const created = await createCanvas();
        const updated = await session.projects.updateWorkspaceCanvasId(projectId, workspaceId, created.canvasId);
        // Keep the original independent setters; never nest them in a React updater.
        const next = currentWorkspaces.map((candidate) => String(candidate.id) === workspaceId ? updated : candidate);
        publishWorkspaces(next);
        return created.canvasId;
      } catch (error) {
        setStatusDetail(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
    [projectId, rootScopeId, session, setSurfaceCanvasMap, workspaces],
  );

  const ensureSurfaceCanvas = useCallback(
    async (surface: LcosSurfaceKey, force = false): Promise<string | undefined> => {
      const existing = surfaceCanvasId[surface];
      if (!force && existing) return existing;
      const candidates = workspaces.filter((workspace) =>
        workspace.preferredSurface === SURFACE_PREFERENCE[surface]
        && rootScopeId !== undefined
        && String(workspace.scopeId) === rootScopeId,
      );
      // Root navigation cannot silently choose among same-surface workspaces.
      if (candidates.length !== 1 || candidates[0] === undefined) return undefined;
      return ensureWorkspaceCanvas(String(candidates[0].id), force);
    },
    [ensureWorkspaceCanvas, rootScopeId, surfaceCanvasId, workspaces],
  );

  const retry = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  return {
    status,
    statusDetail,
    projectName,
    rootScopeId,
    workspaces,
    surfaceCanvasId,
    surfaceByWorkspace,
    ensureSurfaceCanvas,
    ensureWorkspaceCanvas,
    retry,
  };
}
