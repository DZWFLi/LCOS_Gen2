// Sprint P0-09（T4/T6 consumer）：Core health typed HTTP facade（React-free）。
// /health 返回扁平 HealthStatus（非 envelope），直接用 http.request 解析；repair 为 T7 固定 allowlist GAP。

import type { HealthStatus } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';

export class CoreHealthClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /health → Local Core 健康状态（扁平响应，不走 envelope 解包）。 */
  getHealth(signal?: AbortSignal): Promise<HealthStatus> {
    return this.http.request<HealthStatus>('GET', '/health', { mode: 'json', signal });
  }
}
