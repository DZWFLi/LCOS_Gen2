// Collaboration facade V1 —— Collaboration Contract V1 的 UI-facing seam（收敛方案 V1）。
//
// V0（25f97a2）只验证 delegate()；V1 增加：
// - read path：readSession / readTimeline / subscribe（复用既有 SSE 事件总线
//   GET /projects/:pid/events，不新建第二 Event Bus）
// - command seam：delegate / answerInput / approve / cancel / recover / resume / handoff
//   全部 receipt-or-error（CollaborationCommandResultV1），真实 owner 已在 Core 落线；
//   send / fork 保持 fail-closed（无真实 transport，禁止 fake 成功、禁止 fallback 到 createRun）。
//
// 它仍不拥有 Conversation, Run, Continuation, provider-session, recovery truth。

import type {
  AnswerRunInputRequestV1,
  CollaborationAnswerInputV1,
  CollaborationApproveInputV1,
  CollaborationCancelInputV1,
  CollaborationCommandResultV1,
  CollaborationForkInputV1,
  CollaborationHandoffInputV1,
  CollaborationDiagnosticsV1,
  CollaborationPendingInputV1,
  CollaborationProductErrorV1,
  CollaborationReceiptV1,
  CollaborationRecoverInputV1,
  CollaborationRetryInputV1,
  CollaborationReviewV1,
  CollaborationResumeInputV1,
  CollaborationSendInputV1,
  CollaborationSessionEventV1,
  CollaborationSessionProjectionV1,
  CollaborationTimelineItemV1,
  ConnectedConversationV1,
  ProjectEventEnvelope,
} from '@local-creative-os/contracts';
import { collaborationProductErrorV1 } from '@local-creative-os/contracts';
import type { ArtifactRevisionId } from '@local-creative-os/domain';

import { CoreContinuationClient } from './continuation.js';
import { CoreConversationClient } from './conversations.js';
import { HttpClient, HttpError } from './client.js';
import { CoreRunClient } from './runs.js';
import { coreRequest, CoreApiError } from './coreTypes.js';

import type { CreateRunInputV1 } from './runs.js';

function receipt(
  command: CollaborationReceiptV1['command'],
  ids: Partial<Pick<CollaborationReceiptV1, 'runId' | 'returnId' | 'continuationOperationId' | 'conversationId'>>,
): { readonly ok: true; readonly receipt: CollaborationReceiptV1 } {
  return {
    ok: true,
    receipt: { schemaVersion: 1, command, acceptedAt: new Date().toISOString(), ...ids },
  };
}

/** Core/Http 错误 → 产品错误（§21：产品错误回答用户能做什么；工程细节留在 diagnostics）。 */
function toProductError(error: unknown, fallback: string): { readonly ok: false; readonly error: CollaborationProductErrorV1 } {
  if (error instanceof CoreApiError) {
    if (error.status === 0 || error.code === 'network' || error.code === 'aborted') {
      return { ok: false, error: collaborationProductErrorV1('provider_offline', '本地 Core 暂时连不上，稍后再试', { retryable: true, diagnosticsRef: error.message }) };
    }
    if (error.status === 404 || error.code === 'NOT_FOUND') {
      return { ok: false, error: collaborationProductErrorV1('unavailable', fallback, { diagnosticsRef: error.message }) };
    }
    if (error.status === 409 || error.code === 'CONFLICT' || error.code === 'STALE_REVISION') {
      return { ok: false, error: collaborationProductErrorV1('needs_recovery', '状态已变化，需要先刷新或恢复', { retryable: true, diagnosticsRef: error.message }) };
    }
    if (error.code === 'INPUT_REQUIRED') {
      return { ok: false, error: collaborationProductErrorV1('input_required', '需要先回答未完成的问题', { diagnosticsRef: error.message }) };
    }
    if (error.code === 'CANCELLED') {
      return { ok: false, error: collaborationProductErrorV1('cancelled', '已取消', { diagnosticsRef: error.message }) };
    }
    return { ok: false, error: collaborationProductErrorV1('operation_failed', fallback, { retryable: true, diagnosticsRef: `${error.status}: ${error.message}` }) };
  }
  if (error instanceof HttpError) {
    if (error.status === 0 || error.code === 'network' || error.code === 'aborted') {
      return { ok: false, error: collaborationProductErrorV1('provider_offline', '本地 Core 暂时连不上，稍后再试', { retryable: true, diagnosticsRef: error.message }) };
    }
    if (error.status === 404) {
      return { ok: false, error: collaborationProductErrorV1('unavailable', fallback, { diagnosticsRef: error.message }) };
    }
    if (error.status === 409) {
      return { ok: false, error: collaborationProductErrorV1('needs_recovery', '状态已变化，需要先刷新或恢复', { retryable: true, diagnosticsRef: error.message }) };
    }
    return { ok: false, error: collaborationProductErrorV1('operation_failed', fallback, { retryable: true, diagnosticsRef: `${error.status}: ${error.message}` }) };
  }
  return { ok: false, error: collaborationProductErrorV1('operation_unknown', fallback, { diagnosticsRef: String(error) }) };
}

function unavailable(message: string): { readonly ok: false; readonly error: CollaborationProductErrorV1 } {
  return { ok: false, error: collaborationProductErrorV1('unavailable', message) };
}

export interface CollaborationSubscribeOptions {
  /** 断线重连续点（对应 SSE 路由的 lastSeenProjectSeq / runtimeId）。 */
  readonly lastSeenProjectSeq?: number;
  readonly runtimeId?: string;
  /** 测试注入用；默认全局 EventSource。 */
  readonly eventSourceFactory?: (url: string) => EventSource;
}

export class CoreCollaborationClient {
  // B1（Batch B）：raw clients 只留在 facade 内部，Collaboration UX 域 UI 不得访问。
  private readonly conversations: CoreConversationClient;
  private readonly runs: CoreRunClient;
  private readonly continuations: CoreContinuationClient;

  constructor(private readonly http: HttpClient) {
    this.conversations = new CoreConversationClient(http);
    this.runs = new CoreRunClient(http);
    this.continuations = new CoreContinuationClient(http);
  }

  // ------------------------------------------------------------------
  // Read path（Gate 2）
  // ------------------------------------------------------------------

  /** GET 协作会话产品投影；404（会话不存在）= undefined。 */
  async readSession(
    projectId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<CollaborationSessionProjectionV1 | undefined> {
    try {
      return await coreRequest<CollaborationSessionProjectionV1>(
        this.http,
        'GET',
        `/projects/${encodeURIComponent(projectId)}/connected-conversations/${encodeURIComponent(conversationId)}/collaboration-session`,
        { signal },
      );
    } catch (error: unknown) {
      if (error instanceof CoreApiError && error.status === 404) return undefined;
      if (error instanceof HttpError && error.status === 404) return undefined;
      throw error;
    }
  }

  /** GET 协作会话 timeline 投影。 */
  readTimeline(
    projectId: string,
    conversationId: string,
    options: { readonly limit?: number; readonly signal?: AbortSignal } = {},
  ): Promise<readonly CollaborationTimelineItemV1[]> {
    const query = options.limit === undefined ? '' : `?limit=${options.limit}`;
    return coreRequest<readonly CollaborationTimelineItemV1[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/connected-conversations/${encodeURIComponent(conversationId)}/collaboration-timeline${query}`,
      { signal: options.signal },
    );
  }

  // ------------------------------------------------------------------
  // B2 产品读投影（Batch B）：UI 只消费产品投影，不触 raw clients。
  // ------------------------------------------------------------------

  /**
   * Attention / Waiting Input 产品投影。
   * 从 Session projection 定位 pendingInputId + activeRunId，内部经 raw runs 读题，
   * UI 不接触 runs client。
   */
  async readPendingInput(
    projectId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<CollaborationPendingInputV1 | undefined> {
    const session = await this.readSession(projectId, conversationId, signal);
    if (session === undefined) return undefined;
    const pendingInputId = session.activity.pendingInputId;
    const activeRunId = session.activity.activeRunId;
    if (pendingInputId === undefined || activeRunId === undefined) return undefined;
    // CoreRunClient 已经把“合法的 404 / 当前没有 pending input”折算成 undefined。
    // 其它读取失败必须继续向上抛，让产品层显示 honest error，不能伪装成“没有待回答”。
    const request = await this.runs.getPendingInputRequest(activeRunId, signal);
    if (request === undefined || request.status !== 'pending') return undefined;
    return {
      schemaVersion: 1,
      pendingInputId,
      runId: activeRunId,
      question: request.question,
      options: request.options,
      allowFreeText: request.allowFreeText,
    };
  }

  /**
   * Artifact Review 产品投影：该项目当前会话关联 Run 的 returns 复核面。
   * 内部经 conversations.getWorkView 取 runIds + runs.listRunReviews 聚合；
   * UI 只消费产品 review 行（含 accept/reject/retry capability + reason）。
   */
  async readReviews(
    projectId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<readonly CollaborationReviewV1[]> {
    const reviews: CollaborationReviewV1[] = [];
    try {
      const workView = await this.conversations.getWorkView(projectId, conversationId, signal);
      const runIds = workView?.runs.map((run) => run.runId) ?? [];
      if (runIds.length === 0) return reviews;
      const all = await this.runs.listRunReviews(projectId, signal);
      for (const review of all) {
        if (!runIds.includes(String(review.run.id))) continue;
        for (const row of review.returns) {
          const returnId = String(row.id);
          reviews.push({
            schemaVersion: 1,
            returnId,
            ...(row.targetArtifactId === undefined ? {} : { artifactId: String(row.targetArtifactId) }),
            title: review.run.instruction.split('\n')[0]?.trim() ?? '未命名产出',
            status: row.status,
            baseRevisionId: String(row.baseRevisionId),
            capabilities: {
              accept: { enabled: review.capabilities.accept.enabled, ...(review.capabilities.accept.reason === undefined ? {} : { reason: review.capabilities.accept.reason }) },
              reject: { enabled: review.capabilities.reject.enabled, ...(review.capabilities.reject.reason === undefined ? {} : { reason: review.capabilities.reject.reason }) },
              retry: { enabled: review.capabilities.retry.enabled, ...(review.capabilities.retry.reason === undefined ? {} : { reason: review.capabilities.retry.reason }) },
            },
          });
        }
      }
    } catch (error: unknown) {
      // 读取失败 != “当前没有待复核产出”。
      // 让上层 ArtifactReturnSection 进入 error 状态，避免把 5xx / 网络故障伪装成空态。
      throw error;
    }
    return reviews;
  }

  /**
   * Diagnostics 只读 seam：identity / reach / operations 工程层原样透出。
   * Work View 不再自己拼 T6 世界观；Diagnostics 段只消费本方法。
   */
  async readDiagnostics(
    projectId: string,
    conversationId: string,
    signal?: AbortSignal,
  ): Promise<CollaborationDiagnosticsV1 | undefined> {
    try {
      const workView = await this.conversations.getWorkView(projectId, conversationId, signal);
      if (workView === undefined) return undefined;
      const operations = (await this.continuations.list(projectId, signal))
        .filter((op) => op.connectedConversationId === conversationId);
      return {
        schemaVersion: 1,
        conversationId,
        connected: true,
        ...(workView.identity === undefined ? {} : { identity: workView.identity }),
        ...(workView.reach === undefined ? {} : { reach: workView.reach }),
        operations,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * 订阅项目事件总线并折算成产品事件（§22）。
   * 只做 invalidation 信号：UI 收到后 refetch projection，事件不携带状态。
   * 返回取消函数；EventSource 缺席（非浏览器环境）= undefined（调用方退化为手动刷新）。
   */
  subscribe(
    projectId: string,
    conversationId: string,
    listener: (event: CollaborationSessionEventV1) => void,
    options: CollaborationSubscribeOptions = {},
  ): (() => void) | undefined {
    const params = new URLSearchParams();
    if (options.lastSeenProjectSeq !== undefined) params.set('lastSeenProjectSeq', String(options.lastSeenProjectSeq));
    if (options.runtimeId !== undefined) params.set('runtimeId', options.runtimeId);
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const url = `${this.http.config.baseUrl}/projects/${encodeURIComponent(projectId)}/events${query}`;

    const emit = (kind: CollaborationSessionEventV1['kind']): void => {
      listener({
        schemaVersion: 1,
        kind,
        projectId,
        conversationId,
        occurredAt: new Date().toISOString(),
      });
    };

    // §22 折算：内部 run/continuity/artifact/... → 产品三类信号。
    const handleProjectEvent = (data: string): void => {
      let envelope: ProjectEventEnvelope | undefined;
      try {
        const parsed = JSON.parse(data) as { ok?: boolean; value?: ProjectEventEnvelope };
        envelope = parsed.value;
      } catch {
        return;
      }
      if (envelope === undefined) return;
      if (envelope.type === 'run.changed') {
        emit('session.changed');
        emit('timeline.appended');
      } else if (envelope.type === 'continuity.changed') {
        emit('session.changed');
        emit('capability.changed');
      } else if (envelope.type === 'artifact.changed') {
        emit('timeline.appended');
      } else {
        emit('session.changed');
      }
    };

    // 测试 seam：显式注入的 EventSource 保持原路径。
    if (options.eventSourceFactory) {
      const source = options.eventSourceFactory(url);
      source.addEventListener('project-event', (message) => {
        handleProjectEvent((message as MessageEvent<string>).data);
      });
      // snapshot/replay = 连接（重）建，投影需整体刷新。
      source.addEventListener('snapshot', () => emit('session.changed'));
      source.addEventListener('replay', () => emit('session.changed'));
      return () => source.close();
    }

    // 生产路径必须用 fetch 读 SSE 流：`EventSource` 无法携带 `Authorization` 头，而 Core 的
    // `/projects/:id/events` 只认 `Bearer` 头（`apps/local-core/src/server.ts` 的
    // `validBearerToken` 只看 header）—— 用 EventSource 会稳定 401，协作 invalidation 信号
    // 永远收不到（实测 B2）。这里与 Huabu 客户端同一套做法：fetch + 流式读。
    if (typeof fetch !== 'function' || typeof AbortController === 'undefined') return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (this.http.config.token) headers['Authorization'] = `Bearer ${this.http.config.token}`;
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok || response.body === null) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            let eventName = 'message';
            const dataLines: string[] = [];
            for (const line of block.split('\n')) {
              if (line.startsWith(':')) continue;
              if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim();
              else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
            }
            if (eventName === 'project-event') handleProjectEvent(dataLines.join('\n'));
            else if (eventName === 'snapshot' || eventName === 'replay') emit('session.changed');
            boundary = buffer.indexOf('\n\n');
          }
        }
      } catch {
        // 中止或断流：调用方退化为手动刷新（语义同 EventSource 缺席）。
      }
    })();
    return () => controller.abort();
  }

  // ------------------------------------------------------------------
  // Command seam（Gate 3）：有真实 owner 的动作 receipt-or-error。
  // ------------------------------------------------------------------

  /**
   * Delegate work to the canonical Run path.
   * POST /projects/:pid/runs —— 本 facade 不发明第二个任务真相。
   */
  async delegate(
    projectId: string,
    input: CreateRunInputV1,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    try {
      const result = await this.runs.createRun(projectId, input, signal);
      const runId = (result as { id?: string } | null)?.id;
      return receipt('delegate', { ...(runId === undefined ? {} : { runId: String(runId) }) });
    } catch (error: unknown) {
      return toProductError(error, '任务派发失败');
    }
  }

  /** 回答 waiting_input（同一 Run，不新建 Run）。 */
  async answerInput(
    projectId: string,
    runId: string,
    input: CollaborationAnswerInputV1 & Pick<AnswerRunInputRequestV1, 'selectedOptions'>,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    void projectId;
    try {
      await this.runs.answerInput(runId, {
        requestId: input.pendingInputId,
        text: input.answer,
        ...(input.selectedOptions === undefined ? {} : { selectedOptions: input.selectedOptions }),
      }, signal);
      return receipt('answerInput', { runId });
    } catch (error: unknown) {
      return toProductError(error, '回答提交失败');
    }
  }

  /** 复核 Artifact Return：accept 必须带 expectedBaseRevisionId（CAS 防覆盖）。 */
  async approve(
    projectId: string,
    input: CollaborationApproveInputV1,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    void projectId;
    try {
      if (input.decision === 'accept') {
        if (input.expectedBaseRevisionId === undefined) {
          throw new TypeError('approve(accept) requires expectedBaseRevisionId (canonical CAS guard).');
        }
        await this.runs.acceptArtifactReturn(input.returnId, { expectedBaseRevisionId: input.expectedBaseRevisionId as ArtifactRevisionId }, signal);
      } else {
        await this.runs.rejectArtifactReturn(input.returnId, signal);
      }
      return receipt('approve', { returnId: input.returnId });
    } catch (error: unknown) {
      if (error instanceof TypeError) throw error;
      return toProductError(error, '复核操作失败');
    }
  }

  /** 基于同一 Draft 再跑一次（不新建 Run）；语义裁决：真实 product command（Review 决定族）。 */
  async retry(
    projectId: string,
    input: CollaborationRetryInputV1,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    void projectId;
    try {
      await this.runs.retryArtifactReturn(input.returnId, input.instruction === undefined ? undefined : { instruction: input.instruction }, signal);
      return receipt('retry', { returnId: input.returnId });
    } catch (error: unknown) {
      return toProductError(error, '重试失败');
    }
  }

  /** 取消进行中的 Run。 */
  async cancel(
    projectId: string,
    input: CollaborationCancelInputV1,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    void projectId;
    try {
      await this.runs.cancelRun(input.runId, signal);
      return receipt('cancel', { runId: input.runId });
    } catch (error: unknown) {
      return toProductError(error, '取消失败');
    }
  }

  /** 对 continuation operation 执行 recovery action（action 必须来自 allowedActions）。 */
  async recover(
    projectId: string,
    input: CollaborationRecoverInputV1,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    try {
      await this.continuations.executeRecoveryAction(
        projectId,
        input.continuationOperationId,
        input.action,
        input.expectedRevision,
        signal,
      );
      return receipt('recover', { continuationOperationId: input.continuationOperationId });
    } catch (error: unknown) {
      return toProductError(error, '恢复失败');
    }
  }

  /** 继续原会话：走既有 continuation submit（continue_existing / inherit / shared）。 */
  async resume(
    projectId: string,
    input: CollaborationResumeInputV1,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    try {
      // provider 是工程字段，不进产品投影；facade 内部从工程层查回（UI 不感知）。
      const conversations = await this.conversations.listConnectedConversations(projectId, signal);
      const conversation = conversations.find((item: ConnectedConversationV1) => item.id === input.conversationId);
      if (conversation === undefined) {
        return unavailable('要续走的会话不存在或已断开');
      }
      const operationId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `resume-${Date.now()}`;
      await this.continuations.submit(projectId, {
        operationId,
        mode: 'continue_existing',
        contextInheritance: 'inherit',
        checkout: 'shared',
        provider: conversation.provider,
        connectedConversationId: input.conversationId,
      }, signal);
      return receipt('resume', { continuationOperationId: operationId, conversationId: input.conversationId });
    } catch (error: unknown) {
      return toProductError(error, '续走提交失败');
    }
  }

  /**
   * 交接必须代表完整 Receiver 切换完成。
   *
   * 当前 Core 暴露的 /receiver-handoff 只负责 prepareHandoff：
   * 冻结/准备 handoff pack，本身不完成 receiver binding 切换。
   * 在 authoritative bind/commit 事务接入 facade 前，handoff 必须 fail-closed，
   * 不能把 prepare receipt 冒充成产品层“交接完成”。
   */
  async handoff(
    projectId: string,
    fromConversationId: string | null,
    input: CollaborationHandoffInputV1,
    context: {
      readonly surface: { readonly kind: 'main' | 'context' | 'workflow'; readonly surfaceId: string };
      readonly selectionEntityIds?: readonly string[];
    },
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    void projectId;
    void fromConversationId;
    void input;
    void context;
    void signal;
    return unavailable('「交接」尚未接通完整的 Receiver 切换事务；当前仅有交接快照准备能力');
  }

  // ------------------------------------------------------------------
  // Fail-closed：无真实 transport 的动作（Track B 接通前保持不可用）。
  // ------------------------------------------------------------------

  /** send = 对当前 Conversation 再说一句。Huabu live send 未接线；禁止 fallback 到 createRun。 */
  send(projectId: string, input: CollaborationSendInputV1): Promise<CollaborationCommandResultV1> {
    void projectId;
    void input;
    return Promise.resolve(unavailable('「发送」通道尚未接通（该协作方式暂不支持直接追加消息）'));
  }

  /** fork = native full-history 分叉。无 authoritative probe；selected-context new 不冒充 fork。 */
  fork(projectId: string, input: CollaborationForkInputV1): Promise<CollaborationCommandResultV1> {
    void projectId;
    void input;
    return Promise.resolve(unavailable('「从这里分叉」暂不被当前协作方式支持'));
  }
}