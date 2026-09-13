// T2 C2-1C §12-13：Railway thin typed HTTP facade（React-free）。
// 只消费既有 Core `GET/PUT /projects/:pid/view-rail-order`（CORE_OWNER_EXISTS）。
// 本文件只做：GET durable order / PUT durable order（expectedVersion 乐观并发）/
// typed Core error 透传 / AbortSignal。不缓存 truth、不持 UI state、不做排序策略、
// 不解释 legacy、不复制 Receiver。来源：T2 C2-1C Railway ExactSourceBlueprint。

import type { ProjectViewRailOrderV0, ProjectViewRailRefV0 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export interface RailwayOrderWriteInputV1 {
  readonly projectId: string;
  readonly orderedRefs: readonly ProjectViewRailRefV0[];
  readonly expectedVersion: number;
}

export class CoreRailwayClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:pid/view-rail-order → 持久化 rail order（无 stored 时为 undefined）。 */
  read(projectId: string, signal?: AbortSignal): Promise<ProjectViewRailOrderV0 | undefined> {
    return coreRequest<ProjectViewRailOrderV0 | undefined>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/view-rail-order`,
      { signal },
    );
  }

  /** PUT /projects/:pid/view-rail-order（expectedVersion 乐观并发；409 冲突抛 typed Core error）。 */
  write(input: RailwayOrderWriteInputV1, signal?: AbortSignal): Promise<ProjectViewRailOrderV0> {
    return coreRequest<ProjectViewRailOrderV0>(
      this.http,
      'PUT',
      `/projects/${encodeURIComponent(input.projectId)}/view-rail-order`,
      {
        signal,
        body: {
          orderedRefs: input.orderedRefs,
          expectedVersion: input.expectedVersion,
        },
      },
    );
  }
}
