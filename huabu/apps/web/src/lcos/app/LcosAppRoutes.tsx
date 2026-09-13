// LcosAppRoutes — LCOS 生产路由（/projects*）。App.tsx 的 data router 合并本组 route。
// RootLayout（OS frame + modal 单例）保留；本组 route 在 workspace guard 内（Canvas 需要 workspace bootstrap）。

import { lazy, Suspense, type ReactNode } from 'react';

import { WorkspaceLoadingScreen } from '@/pages/WorkspaceLoadingScreen';

import type { RouteObject } from 'react-router-dom';


const LcosProjectLauncherPage = lazy(() =>
  import('./LcosProjectLauncherPage').then((m) => ({ default: m.LcosProjectLauncherPage })),
);
const LcosProjectRoute = lazy(() =>
  import('./LcosProjectRoute').then((m) => ({ default: m.LcosProjectRoute })),
);

const withSuspense = (element: ReactNode): ReactNode => (
  <Suspense fallback={<WorkspaceLoadingScreen />}>{element}</Suspense>
);

/** LCOS production routes — 挂进 App.tsx 的 WorkspaceGuardLayout children。 */
export function lcosProjectRoutes(): readonly RouteObject[] {
  return [
    { path: '/projects', element: withSuspense(<LcosProjectLauncherPage />) },
    { path: '/projects/:projectId/:surface?', element: withSuspense(<LcosProjectRoute />) },
  ];
}