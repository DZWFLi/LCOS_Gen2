// R6 导航目标解析：canonical NavigationMarkerService 的 typed facade。
//
// 复用既有 canonical 路由 POST /projects/:pid/navigation/resolve → NavigationResolutionV0。
// unresolved 是合法结果（不是 HTTP 错误）：前端据此渲染「失效 marker」，绝不按
// title/provider/time 模糊重绑到最像的目标。

import type { NavigationResolutionV0, SpatialMarkerTargetRefV0 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreNavigationClient {
  constructor(private readonly http: HttpClient) {}

  resolveTarget(projectId: string, targetRef: SpatialMarkerTargetRefV0, signal?: AbortSignal): Promise<NavigationResolutionV0> {
    return coreRequest<NavigationResolutionV0>(
      this.http,
      'POST',
      `/projects/${encodeURIComponent(projectId)}/navigation/resolve`,
      { body: { targetRef }, signal },
    );
  }
}