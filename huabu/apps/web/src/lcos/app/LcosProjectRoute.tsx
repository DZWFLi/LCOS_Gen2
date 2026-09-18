// LcosProjectRoute — 项目路由元件（project→现场→画布 解析）。唯一 `LcosProjectShell` 组合根。
//
// 两种入口共用本元件，保证 Shell 只有一个 caller：
//   1) `/projects/:projectId/:surface?`：projectId 来自 URL（真实 Core binding）；
//      surface 非法时纠正 URL 并回退 main。
//   2) `/canvas/:canvasId`（Wave 1 退役入口）：由 `useLcosCanvasBinding` 解析出
//      projectId/workspaceId/surface 后以 override 传入；此时**不改写 URL**，
//      也不改写 surface，URL 契约与 loader/guard/not-found 行为保持不变。

import { Navigate, useLocation, useParams } from 'react-router-dom';

import { useLcosWorksite } from './useLcosWorksite';
import { LcosProjectShell } from '../shell/LcosProjectShell';

import type { LcosSurfaceKey } from '../shell/lcosShellStore';

const VALID_SURFACES: ReadonlySet<string> = new Set(['main', 'context', 'workflow']);

export interface LcosProjectRouteProps {
  /** 来自 `/canvas/:canvasId` 的 canonical 解析结果；存在时不再读 URL param。 */
  readonly projectIdOverride?: string;
  /** 显式工作现场（`/canvas/:canvasId` 解析结果），等价于 `?workspaceId=`。 */
  readonly workspaceIdOverride?: string;
  readonly surfaceOverride?: LcosSurfaceKey;
}

export function LcosProjectRoute({
  projectIdOverride,
  workspaceIdOverride,
  surfaceOverride,
}: LcosProjectRouteProps = {}): React.JSX.Element {
  const params = useParams<{ projectId?: string; surface?: string }>();
  const location = useLocation();
  const projectId = projectIdOverride ?? params.projectId;
  const rawSurface = surfaceOverride ?? params.surface;
  const normalized: LcosSurfaceKey =
    rawSurface !== undefined && VALID_SURFACES.has(rawSurface)
      ? (rawSurface as LcosSurfaceKey)
      : 'main';

  // 全部 hooks 先于条件返回（rules-of-hooks）。
  const worksite = useLcosWorksite(projectId ?? '');
  const childWorkspaceId = workspaceIdOverride
    ?? new URLSearchParams(location.search).get('workspaceId')
    ?? undefined;

  if (!projectId) {
    return <Navigate to="/projects" replace />;
  }

  // 只在 URL 驱动入口上纠正 surface；override 入口（`/canvas/:id`）保持 URL 原样。
  if (projectIdOverride === undefined && rawSurface !== normalized) {
    return (
      <Navigate
        to={`/projects/${encodeURIComponent(projectId)}/${normalized}${location.search}`}
        replace
      />
    );
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