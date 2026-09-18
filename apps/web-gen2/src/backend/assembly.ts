// Sprint 2B（T4）：Assembly 唯一 typed HTTP facade（React-free）。
//
// 只消费既有 Core `GET /projects/:pid/warehouse`（P0-B2 Material/Relation View 共用
// read model）；apply 仍走既有 AssemblyApplyRequestV1 通道，本文件不建第二 membership。

import type {
  AssemblyApplyRequestV1,
  AssemblyApplyResultV1,
  WarehouseQueryV1,
  WarehouseSnapshotV1,
} from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

/** WarehouseQueryV1 → canonical query string（只透传 route 已支持的轴）。 */
export function warehouseQueryStringV1(query: WarehouseQueryV1): string {
  const params = new URLSearchParams();
  if (query.search !== undefined && query.search.trim() !== '') params.set('search', query.search);
  if (query.kinds !== undefined && query.kinds.length > 0) params.set('kinds', query.kinds.join(','));
  if (query.provenanceOrigin !== undefined) params.set('provenance', query.provenanceOrigin);
  if (query.usedHereTarget !== undefined && query.usedHereTarget.kind === 'workspace') {
    params.set('usedHereTarget', `workspace:${query.usedHereTarget.id}`);
  }
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.cursor !== undefined) params.set('cursor', query.cursor);
  const value = params.toString();
  return value === '' ? '' : `?${value}`;
}

export class CoreAssemblyClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:pid/warehouse → WarehouseSnapshotV1（默认第一页）。 */
  getWarehouse(projectId: string, signal?: AbortSignal): Promise<WarehouseSnapshotV1> {
    return this.queryWarehouse(projectId, {}, signal);
  }

  /** GET /projects/:pid/warehouse + WarehouseQueryV1（分页/搜索/筛选；canonical nextCursor）。 */
  queryWarehouse(projectId: string, query: WarehouseQueryV1, signal?: AbortSignal): Promise<WarehouseSnapshotV1> {
    return coreRequest<WarehouseSnapshotV1>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/warehouse${warehouseQueryStringV1(query)}`,
      { signal },
    );
  }

  /** POST /projects/:pid/assembly/apply → 统一 Semantic Drop apply（逐项回执，partial 如实展示）。 */
  apply(projectId: string, request: AssemblyApplyRequestV1, signal?: AbortSignal): Promise<AssemblyApplyResultV1> {
    return coreRequest<AssemblyApplyResultV1>(
      this.http,
      'POST',
      `/projects/${encodeURIComponent(projectId)}/assembly/apply`,
      { body: request, signal },
    );
  }
}