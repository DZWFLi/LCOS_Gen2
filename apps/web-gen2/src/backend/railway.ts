// T2 C2-1C §12-13：Railway thin typed HTTP facade（React-free）。
// 消费 Core canonical Railway read/order/receive；V0 read/write 仅保留旧客户端兼容。
// 本文件只做：GET durable order / PUT durable order（expectedVersion 乐观并发）/
// typed Core error 透传 / AbortSignal。不缓存 truth、不持 UI state、不做排序策略、
// 不解释 legacy、不复制 Receiver。来源：T2 C2-1C Railway ExactSourceBlueprint。

import type { ProjectViewRailOrderV0, ProjectViewRailRefV0 } from '@local-creative-os/contracts';
import type { RailwaySnapshotV1, RailwayStoredRefV1, RailwayReceiveRequestV1, RailwayReceiveOutcomeV1, PortalReceiveRequestV1, RailwayDestinationV1 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export interface RailwayOrderWriteInputV1 {
  readonly projectId: string;
  readonly orderedRefs: readonly ProjectViewRailRefV0[];
  readonly expectedVersion: number;
}

export class CoreRailwayClient {
  constructor(private readonly http: HttpClient) {}

  snapshot(projectId: string, signal?: AbortSignal): Promise<RailwaySnapshotV1> {
    return coreRequest(this.http, 'GET', `/projects/${encodeURIComponent(projectId)}/railway`, {signal});
  }

  save(projectId: string, orderedRefs: readonly RailwayStoredRefV1[], expectedVersion: number, signal?: AbortSignal): Promise<RailwaySnapshotV1> {
    return coreRequest(this.http, 'PUT', `/projects/${encodeURIComponent(projectId)}/railway`, {
      signal, body: {schemaVersion:1, projectId, orderedRefs, expectedVersion},
    });
  }

  receive(request: RailwayReceiveRequestV1, signal?: AbortSignal): Promise<RailwayReceiveOutcomeV1> {
    return coreRequest(this.http, 'POST', `/projects/${encodeURIComponent(request.projectId)}/railway/receive`, {signal, body:request});
  }

  receiveReceipt(projectId: string, operationId: string, signal?: AbortSignal): Promise<RailwayReceiveOutcomeV1> {
    return coreRequest(this.http, 'GET', `/projects/${encodeURIComponent(projectId)}/railway/receive/${encodeURIComponent(operationId)}`, {signal});
  }

  portalTarget(projectId: string, workspaceId: string, signal?: AbortSignal): Promise<RailwayDestinationV1> {
    return coreRequest(this.http, 'GET', `/projects/${encodeURIComponent(projectId)}/workspaces/${encodeURIComponent(workspaceId)}/portal-target`, {signal});
  }

  receivePortal(request: PortalReceiveRequestV1, signal?: AbortSignal): Promise<RailwayReceiveOutcomeV1> {
    return coreRequest(this.http, 'POST', `/projects/${encodeURIComponent(request.projectId)}/portal/receive`, {signal, body:request});
  }

  portalReceipt(projectId: string, operationId: string, signal?: AbortSignal): Promise<RailwayReceiveOutcomeV1> {
    return coreRequest(this.http, 'GET', `/projects/${encodeURIComponent(projectId)}/portal/receive/${encodeURIComponent(operationId)}`, {signal});
  }

  /** Conditional claim, not the normal binding upsert used by reconciliation. */
  claimPortal(projectId: string, workspaceId: string, canvasId: string, spatialId: string, expectedCanvasId: string): Promise<{projectId:string;canvasId:string;spatialId:string;entityId:string;entityType:string;spatialKind:string}> {
    return coreRequest(this.http, 'POST', `/projects/${encodeURIComponent(projectId)}/spatial/portals/${encodeURIComponent(workspaceId)}`, {
      body:{canvasId,spatialId,expectedCanvasId},
    });
  }

  /** Legacy compatibility only. Production Railway uses snapshot/save above.
   * GET /projects/:pid/view-rail-order → 持久化 rail order（无 stored 时为 undefined）。 */
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
