// Sprint 2B 补（T4/T6 consumer）：Continuation journal typed HTTP facade（React-free）。
// 只消费 Sprint 1A 的 journal 路由；allowedActions 由 T6 read projection 提供，前端不推断。

import type { ContinuationActionV1, ContinuationRecoveryProjectionV1, ContinuationSubmitRequestV1 } from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreContinuationClient {
  constructor(private readonly http: HttpClient) {}

  /** POST /projects/:pid/conversation-continuations → 续工提交（ContinueSubmissionRequested 分流）。 */
  submit(projectId: string, input: Omit<ContinuationSubmitRequestV1, 'projectId' | 'schemaVersion'>, signal?: AbortSignal): Promise<ContinuationRecoveryProjectionV1> {
    return coreRequest<ContinuationRecoveryProjectionV1>(
      this.http,
      'POST',
      `/projects/${encodeURIComponent(projectId)}/conversation-continuations`,
      { body: { input }, signal },
    );
  }

  /** GET /projects/:pid/conversation-continuations → journal 列表投影（Recovery body 入口）。 */
  list(projectId: string, signal?: AbortSignal): Promise<ContinuationRecoveryProjectionV1[]> {
    return coreRequest<ContinuationRecoveryProjectionV1[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/conversation-continuations`,
      { signal },
    );
  }

  /** POST .../recovery-actions → 执行 recovery intent（T6 service → T7 adapter → receipt），返回 fresh projection。 */
  executeRecoveryAction(
    projectId: string,
    operationId: string,
    action: ContinuationActionV1,
    expectedRevision?: number,
    signal?: AbortSignal,
  ): Promise<ContinuationRecoveryProjectionV1> {
    return coreRequest<ContinuationRecoveryProjectionV1>(
      this.http,
      'POST',
      `/projects/${encodeURIComponent(projectId)}/conversation-continuations/${encodeURIComponent(operationId)}/recovery-actions`,
      {
        body: { input: { action, ...(expectedRevision === undefined ? {} : { expectedRevision }) } },
        signal,
      },
    );
  }

  /** GET .../conversation-continuations/:operationId → 单条投影；404 → undefined。 */
  get(projectId: string, operationId: string, signal?: AbortSignal): Promise<ContinuationRecoveryProjectionV1 | undefined> {
    return this.getOrUndefined(`/projects/${encodeURIComponent(projectId)}/conversation-continuations/${encodeURIComponent(operationId)}`, signal);
  }

  private async getOrUndefined<T>(path: string, signal?: AbortSignal): Promise<T | undefined> {
    try {
      return await coreRequest<T>(this.http, 'GET', path, { signal });
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      if (status === 404) return undefined;
      throw error;
    }
  }
}
