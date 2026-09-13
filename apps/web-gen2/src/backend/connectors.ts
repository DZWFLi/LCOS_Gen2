// Sprint P0-05（T4/T7 consumer）：Connector source typed HTTP facade（React-free）。
// 只消费 T7 connector-source 投影路由；scan/import 是否可执行由投影 allowedActions 决定。

import type { ConnectorSourceProjectionV1 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreConnectorClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:pid/connector-sources → T7 connector source 投影列表。 */
  listSources(projectId: string, signal?: AbortSignal): Promise<ConnectorSourceProjectionV1[]> {
    return coreRequest<ConnectorSourceProjectionV1[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/connector-sources`,
      { signal },
    );
  }
}
