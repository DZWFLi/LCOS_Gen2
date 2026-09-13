// Sprint 2B（T4）：Assembly 唯一 typed HTTP facade（React-free）。
//
// 只消费既有 Core `GET /projects/:pid/warehouse`（P0-B2 Material/Relation View 共用
// read model）；apply 仍走既有 AssemblyApplyRequestV1 通道，本文件不建第二 membership。

import type { WarehouseSnapshotV1 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreAssemblyClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:pid/warehouse → WarehouseSnapshotV1。 */
  getWarehouse(projectId: string, signal?: AbortSignal): Promise<WarehouseSnapshotV1> {
    return coreRequest<WarehouseSnapshotV1>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/warehouse`,
      { signal },
    );
  }
}
