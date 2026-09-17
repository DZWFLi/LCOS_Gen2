// Sprint 4 补（T4/T6 consumer）：Run / waiting-input typed HTTP facade（React-free）。
// 只消费既有 /runs/:id/input-request 读写 route；waiting_input 状态由 Core 判定，
// 前端不伪造 "waiting"。

import type {
  AcceptArtifactReturnInput,
  AcceptArtifactReturnResult,
  AnswerRunInputRequestV1,
  RunInputRequestV1,
  RunReview,
} from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

/** 普通 Run 提交输入（与 Core POST /projects/:pid/runs 校验面一致，T5 P0-03 分流）。 */
export interface CreateRunInputV1 {
  readonly instruction: string;
  readonly outputIntent: 'create' | 'revise' | 'analyze';
  readonly targetArtifactId?: string;
  readonly targetRevisionId?: string;
  readonly contextArtifactIds?: readonly string[];
  readonly savedContextId?: string;
  readonly workspaceId?: string;
  readonly requestedProvider?: 'workbuddy' | 'codex' | 'auto';
  readonly resultPolicy?: { readonly type: string };
  readonly sessionId?: string;
  readonly receiverRef?: { readonly connectedConversationId: string };
  readonly orderedReferences?: readonly unknown[];
  readonly resultSlotId?: string;
}

export class CoreRunClient {
  constructor(private readonly http: HttpClient) {}

  /** POST /projects/:pid/runs → 普通提交：创建 canonical Run（普通 submit 分流）。 */
  createRun(
    projectId: string,
    input: CreateRunInputV1,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return coreRequest<unknown>(
      this.http,
      'POST',
      `/projects/${encodeURIComponent(projectId)}/runs`,
      { body: input, signal },
    );
  }

  /** GET /runs/:runId/input-request → 未决输入请求；404（不等待）= undefined。 */
  getPendingInputRequest(runId: string, signal?: AbortSignal): Promise<RunInputRequestV1 | undefined> {
    return this.getOrUndefined<RunInputRequestV1>(`/runs/${encodeURIComponent(runId)}/input-request`, signal);
  }

  /** POST /runs/:runId/input-request → 回答未决输入（同一 run，不新建 Run）。 */
  answerInput(runId: string, input: AnswerRunInputRequestV1, signal?: AbortSignal): Promise<unknown> {
    return coreRequest<unknown>(this.http, 'POST', `/runs/${encodeURIComponent(runId)}/input-request`, { body: input, signal });
  }

  /**
   * GET /projects/:pid/runs → 项目 Run 复核视图（每个 run 的 returns / draftRevisions /
   * capabilities / presentationPhase）。Review/Accept/Retry 段只读这里，不另建 review truth。
   */
  listRunReviews(projectId: string, signal?: AbortSignal): Promise<readonly RunReview[]> {
    return coreRequest<readonly RunReview[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/runs`,
      { signal },
    );
  }

  /** POST /artifact-returns/:id/accept —— 采纳 Draft 为 Current（必须带 expectedBaseRevisionId，防覆盖他人修订）。 */
  acceptArtifactReturn(
    returnId: string,
    input: AcceptArtifactReturnInput,
    signal?: AbortSignal,
  ): Promise<AcceptArtifactReturnResult> {
    return coreRequest<AcceptArtifactReturnResult>(
      this.http,
      'POST',
      `/artifact-returns/${encodeURIComponent(returnId)}/accept`,
      { body: input, signal },
    );
  }

  /** POST /runs/:runId/cancel —— 取消进行中的 Run（Core runtimeApplication.cancel 为唯一 owner）。 */
  cancelRun(runId: string, signal?: AbortSignal): Promise<unknown> {
    return coreRequest<unknown>(this.http, 'POST', `/runs/${encodeURIComponent(runId)}/cancel`, { signal });
  }

  /** POST /artifact-returns/:id/reject —— 拒绝该 Draft（不改 Current）。 */
  rejectArtifactReturn(returnId: string, signal?: AbortSignal): Promise<unknown> {
    return coreRequest<unknown>(
      this.http,
      'POST',
      `/artifact-returns/${encodeURIComponent(returnId)}/reject`,
      { signal },
    );
  }

  /** POST /artifact-returns/:id/retry —— 基于同一 Draft 再跑一次（可带新指令）。 */
  retryArtifactReturn(
    returnId: string,
    input?: { readonly instruction?: string },
    signal?: AbortSignal,
  ): Promise<unknown> {
    return coreRequest<unknown>(
      this.http,
      'POST',
      `/artifact-returns/${encodeURIComponent(returnId)}/retry`,
      { body: input ?? {}, signal },
    );
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
