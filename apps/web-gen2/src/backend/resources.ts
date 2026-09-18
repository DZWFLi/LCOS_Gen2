// R4 Assembly Source Bay（Sources 路）：既有 Resource 路由的 typed facade。
//
// 纪律：artifactId != resourceId——本 facade 只透传 canonical 身份，不做任何推断/映射；
// resource → 目标 的 apply 由 Core AssemblyApplyService 经 descriptor.artifactId 解析（前端零推断）。

import type { ResourceDescriptorV0 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

/** GET /projects/:pid/resources 的 canonical 摘要形状（route 投影，非新 truth）。 */
export interface ResourceSummaryV1 {
  readonly resourceId: string;
  readonly artifactId: string;
  readonly title: string;
  readonly sourceKind: string;
  readonly status: string;
  readonly analyzerVersion: string;
}

export class CoreResourceClient {
  constructor(private readonly http: HttpClient) {}

  list(projectId: string, signal?: AbortSignal): Promise<readonly ResourceSummaryV1[]> {
    return coreRequest<readonly ResourceSummaryV1[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/resources`,
      { signal },
    );
  }

  /** GET /projects/:pid/resources/:rid/descriptor → ResourceDescriptorV0（descriptor/preview）。 */
  descriptor(projectId: string, resourceId: string, signal?: AbortSignal): Promise<ResourceDescriptorV0> {
    return coreRequest<ResourceDescriptorV0>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}/descriptor`,
      { signal },
    );
  }
}