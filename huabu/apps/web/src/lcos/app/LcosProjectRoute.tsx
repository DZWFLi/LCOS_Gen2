// LcosProjectRoute — /projects/:projectId/:surface? 的项目路由元件（project→现场→画布 解析）。
// projectId 来自 URL（真实 Core binding）；surface 非法时回退 main。

import { Navigate, useLocation, useParams } from 'react-router-dom';

import { useLcosWorksite } from './useLcosWorksite';
import { LcosProjectShell } from '../shell/LcosProjectShell';

import type { LcosSurfaceKey } from '../shell/lcosShellStore';

const VALID_SURFACES: ReadonlySet<string> = new Set(['main', 'context', 'workflow']);

export function LcosProjectRoute(): React.JSX.Element {
  const { projectId, surface } = useParams<{ projectId: string; surface?: string }>();
  const location = useLocation();
  const normalized: LcosSurfaceKey =
    surface !== undefined && VALID_SURFACES.has(surface)
      ? (surface as LcosSurfaceKey)
      : 'main';

  // 全部 hooks 先于条件返回（rules-of-hooks）。
  const worksite = useLcosWorksite(projectId ?? '');
  const childWorkspaceId = new URLSearchParams(location.search).get('workspaceId') ?? undefined;

  if (!projectId) {
    return <Navigate to="/projects" replace />;
  }

  if (surface !== normalized) {
    return <Navigate to={`/projects/${encodeURIComponent(projectId)}/${normalized}${location.search}`} replace />;
  }

  return (
    <LcosProjectShell
      projectId={projectId}
      projectName={worksite.projectName}
      surface={normalized}
      workspaces={worksite.workspaces}
      {...(childWorkspaceId === undefined ? {} : { childWorkspaceId })}
      canvasBySurface={worksite.surfaceCanvasId}
      surfaceByWorkspace={worksite.surfaceByWorkspace}
      ensureCanvas={worksite.ensureSurfaceCanvas}
      ensureWorkspaceCanvas={worksite.ensureWorkspaceCanvas}
      ensureError={worksite.statusDetail}
      shellStatus={worksite.status}
      onRetry={worksite.retry}
    />
  );
}
