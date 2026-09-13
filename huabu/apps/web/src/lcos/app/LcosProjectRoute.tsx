// LcosProjectRoute — /projects/:projectId/:surface? 的项目路由元件（project→现场→画布 解析）。
// projectId 来自 URL（真实 Core binding）；surface 非法时回退 main。

import { Navigate, useParams } from 'react-router-dom';

import { useLcosWorksite } from './useLcosWorksite';
import { LcosProjectShell } from '../shell/LcosProjectShell';

import type { LcosSurfaceKey } from '../shell/lcosShellStore';

const VALID_SURFACES: ReadonlySet<string> = new Set(['main', 'context', 'workflow']);

export function LcosProjectRoute(): React.JSX.Element {
  const { projectId, surface } = useParams<{ projectId: string; surface?: string }>();
  const normalized: LcosSurfaceKey =
    surface !== undefined && VALID_SURFACES.has(surface)
      ? (surface as LcosSurfaceKey)
      : 'main';

  // 全部 hooks 先于条件返回（rules-of-hooks）。
  const worksite = useLcosWorksite(projectId ?? '');

  if (!projectId) {
    return <Navigate to="/projects" replace />;
  }

  if (surface !== normalized) {
    return <Navigate to={`/projects/${encodeURIComponent(projectId)}/${normalized}`} replace />;
  }

  return (
    <LcosProjectShell
      projectId={projectId}
      projectName={worksite.projectName}
      surface={normalized}
      canvasBySurface={worksite.surfaceCanvasId}
      ensureCanvas={worksite.ensureSurfaceCanvas}
      ensureError={worksite.statusDetail}
      shellStatus={worksite.status}
      onRetry={worksite.retry}
    />
  );
}