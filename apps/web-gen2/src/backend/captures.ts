// Sprint P0-04（T4/T6 consumer）：Capture operation typed HTTP facade（React-free）。
// 只消费 T6 §3.3 capture-operation 投影路由与既有 materialize 路由；allowedActions 由投影提供。

import type { CaptureMaterializeResultV1, CaptureOperationProjectionV1 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreCaptureClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:pid/capture-operations → T6 capture operation 投影列表。 */
  listOperations(projectId: string, signal?: AbortSignal): Promise<CaptureOperationProjectionV1[]> {
    return coreRequest<CaptureOperationProjectionV1[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/capture-operations`,
      { signal },
    );
  }

  /** POST /runtime/capture-space/materialize → 把 captureIds 物化到 project（apply）。 */
  materialize(projectId: string, captureIds: readonly string[], signal?: AbortSignal): Promise<CaptureMaterializeResultV1> {
    return coreRequest<CaptureMaterializeResultV1>(
      this.http,
      'POST',
      '/runtime/capture-space/materialize',
      { body: { captureIds, projectId }, signal },
    );
  }
}
