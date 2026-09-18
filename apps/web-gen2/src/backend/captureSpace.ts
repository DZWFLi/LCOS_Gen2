// R4 Assembly Source Bay（Capture 路）：系统级 Capture Space 只读快照 + payload preview。
//
// 复用既有 canonical 路由（GET /runtime/capture-space、GET /runtime/capture-space/items/:id/preview）。
// Capture 仍是 system-level staging，不属于任何 Project——本 facade 不建 Project-local Capture。

import type {
  CaptureSpacePayloadPreviewV1,
  CaptureSpaceSnapshotV1,
} from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreCaptureSpaceClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /runtime/capture-space → CaptureSpaceSnapshotV1（items + presentation）。 */
  snapshot(limit?: number, signal?: AbortSignal): Promise<CaptureSpaceSnapshotV1> {
    const query = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`;
    return coreRequest<CaptureSpaceSnapshotV1>(
      this.http,
      'GET',
      `/runtime/capture-space${query}`,
      { signal },
    );
  }

  /** GET /runtime/capture-space/items/:id/preview → CaptureSpacePayloadPreviewV1。 */
  preview(captureId: string, signal?: AbortSignal): Promise<CaptureSpacePayloadPreviewV1> {
    return coreRequest<CaptureSpacePayloadPreviewV1>(
      this.http,
      'GET',
      `/runtime/capture-space/items/${encodeURIComponent(captureId)}/preview`,
      { signal },
    );
  }
}