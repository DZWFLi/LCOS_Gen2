// Collaboration facade V1 —— Collaboration Contract V1 的 UI-facing seam（收敛方案 V1）。
//
// V0（25f97a2）只验证 delegate()；V1 增加：
// - read path：readSession / readTimeline / subscribe（复用既有 SSE 事件总线
//   GET /projects/:pid/events，不新建第二 Event Bus）
// - command seam：delegate / answerInput / approve / cancel / recover / resume / newSession / handoff
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
  CollaborationNewSessionInputV1,
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
  ProjectEventReconnectV1,
  ProjectEventSnapshotV1,
} from '@local-creative-os/contracts';
import { collaborationProductErrorV1 } from '@local-creative-os/contracts';
import type { ArtifactRevisionId } from '@local-creative-os/domain';

import { normalizeCollaborationSendReceipt } from './collaborationSendReceipt.js';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

class ProjectEventStreamProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectEventStreamProtocolError';
  }
}

class ProjectEventStreamRecoveryRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectEventStreamRecoveryRequired';
  }
}

interface ParsedSseFrame {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
}

function takeSseFrame(buffer: string): { readonly frame: ParsedSseFrame; readonly rest: string } | undefined {
  const boundary = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  if (boundary === null || boundary.index === undefined) return undefined;
  const block = buffer.slice(0, boundary.index);
  const lines = block.split(/\r\n|\n|\r/);
  let event = '';
  let id: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const rawValue = colon < 0 ? '' : line.slice(colon + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) id = value;
  }
  const frame: ParsedSseFrame = { event, data: data.join('\n'), ...(id === undefined ? {} : { id }) };
  return { frame, rest: buffer.slice(boundary.index + boundary[0].length) };
}

function unwrapProjectEventFrame(data: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    throw new ProjectEventStreamProtocolError('Project event frame contains invalid JSON.');
  }
  if (!isRecord(parsed) || parsed.ok !== true || !('value' in parsed)) {
    throw new ProjectEventStreamProtocolError('Project event frame is not a successful Core envelope.');
  }
  return parsed.value;
}

function isProjectEventEnvelope(value: unknown, projectId: string): value is ProjectEventEnvelope {
  return isRecord(value)
    && value.projectId === projectId
    && typeof value.runtimeId === 'string'
    && value.runtimeId.length > 0
    && Number.isSafeInteger(value.projectSeq)
    && Number(value.projectSeq) > 0
    && typeof value.type === 'string';
}

function parseProjectEventEnvelope(data: string, projectId: string): ProjectEventEnvelope {
  const envelope = unwrapProjectEventFrame(data);
  if (!isProjectEventEnvelope(envelope, projectId)) {
    throw new ProjectEventStreamProtocolError('Project event identity or projectSeq is invalid.');
  }
  return envelope;
}

function isProjectEventSnapshot(value: unknown, projectId: string): value is ProjectEventSnapshotV1 {
  return isRecord(value)
    && value.projectId === projectId
    && typeof value.runtimeId === 'string'
    && value.runtimeId.length > 0
    && Number.isSafeInteger(value.currentSeq)
    && Number(value.currentSeq) >= 0;
}

function isProjectEventReplay(value: unknown): value is Extract<ProjectEventReconnectV1, { readonly kind: 'replay' }> {
  return isRecord(value)
    && value.kind === 'replay'
    && typeof value.runtimeId === 'string'
    && value.runtimeId.length > 0
    && Number.isSafeInteger(value.currentSeq)
    && Number(value.currentSeq) >= 0
    && Array.isArray(value.events);
}

function projectEventRetryDelay(attempt: number): number {
  const schedule = [500, 1_000, 2_000, 5_000, 10_000, 30_000] as const;
  const base = schedule[Math.min(Math.max(attempt, 0), schedule.length - 1)] ?? 30_000;
  return base + Math.floor(Math.random() * base * 0.2);
}

export interface CollaborationSubscribeOptions {
  /** 初始断线续点；只有 seq 与 runtimeId 同时提供时才可安全使用。 */
  readonly lastSeenProjectSeq?: number;
  readonly runtimeId?: string;
  /** 测试注入用；默认全局 EventSource。 */
  readonly eventSourceFactory?: (url: string) => EventSource;
  /** Shared project-event owner hook. Consumers may invalidate non-conversation projections without opening a second SSE. */
  readonly onProjectEvent?: (event: ProjectEventEnvelope) => void;
  /** Called when a snapshot establishes a recovery boundary, so non-session projections can refetch too. */
  readonly onProjectRecovery?: (snapshot: ProjectEventSnapshotV1) => void;
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
    if (request.requestId !== pendingInputId) throw new Error('待回答的问题已变化，请刷新后再回答');
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
    const handleProjectEvent = (envelope: ProjectEventEnvelope): void => {
      options.onProjectEvent?.(envelope);
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

    const baseUrl = this.http.config.baseUrl.replace(/\/$/, '');
    const endpoint = `${baseUrl}/projects/${encodeURIComponent(projectId)}/events`;
    const initialParams = new URLSearchParams();
    if (options.runtimeId !== undefined && options.lastSeenProjectSeq !== undefined) {
      initialParams.set('lastSeenProjectSeq', String(options.lastSeenProjectSeq));
      initialParams.set('runtimeId', options.runtimeId);
    }
    const url = `${endpoint}${initialParams.size > 0 ? `?${initialParams.toString()}` : ''}`;

    // Production uses bearer-authenticated fetch streaming. Keep the caller's
    // shared project subscription as the sole owner; this method owns only its
    // transport cursor, reconnect timer and abortable stream.
    const fetcher = this.http.config.fetch ?? globalThis.fetch?.bind(globalThis);

    let cursor: { runtimeId: string; seq: number } | undefined;
    if (
      options.runtimeId !== undefined
      && options.runtimeId.length > 0
      && options.lastSeenProjectSeq !== undefined
      && Number.isSafeInteger(options.lastSeenProjectSeq)
      && options.lastSeenProjectSeq >= 0
    ) {
      cursor = { runtimeId: options.runtimeId, seq: options.lastSeenProjectSeq };
    }

    let disposed = false;
    let generation = 0;
    let retryAttempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | undefined;
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let connect: () => Promise<void>;
    let browserOffline = false;

    const dispatchProjectEvent = (envelope: ProjectEventEnvelope): void => {
      handleProjectEvent(envelope);
    };

    const currentUrl = (): string => {
      if (cursor === undefined) return endpoint;
      const params = new URLSearchParams({ lastSeenProjectSeq: String(cursor.seq), runtimeId: cursor.runtimeId });
      return `${endpoint}?${params.toString()}`;
    };

    const scheduleReconnect = (forceSnapshot: boolean, terminal: boolean): void => {
      if (disposed || browserOffline || terminal || retryTimer !== undefined) return;
      if (forceSnapshot) cursor = undefined;
      const delay = projectEventRetryDelay(retryAttempt);
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, delay);
    };

    const processFrame = (frame: ParsedSseFrame): void => {
      if (frame.event === '' && frame.data === '') return; // heartbeat/comment frame
      if (frame.event === 'snapshot') {
        const snapshot = unwrapProjectEventFrame(frame.data);
        if (!isProjectEventSnapshot(snapshot, projectId)) {
          throw new ProjectEventStreamProtocolError('Snapshot identity or currentSeq is invalid.');
        }
        if (cursor?.runtimeId === snapshot.runtimeId && snapshot.currentSeq < cursor.seq) {
          throw new ProjectEventStreamProtocolError('Snapshot currentSeq moved backwards within the same runtime.');
        }
        // Dispatch invalidation synchronously; consumers start their authoritative refetch.
        emit('session.changed');
        options.onProjectRecovery?.(snapshot);
        cursor = { runtimeId: snapshot.runtimeId, seq: snapshot.currentSeq };
        return;
      }

      if (frame.event === 'replay') {
        const replay = unwrapProjectEventFrame(frame.data);
        if (!isProjectEventReplay(replay) || cursor === undefined || replay.runtimeId !== cursor.runtimeId) {
          throw new ProjectEventStreamRecoveryRequired('Replay cannot continue the accepted runtime cursor.');
        }
        let expectedSeq = cursor.seq + 1;
        let lastSeq = cursor.seq;
        for (const candidate of replay.events) {
          if (!isProjectEventEnvelope(candidate, projectId) || candidate.runtimeId !== replay.runtimeId) {
            throw new ProjectEventStreamProtocolError('Replay contains an invalid project event identity.');
          }
          if (candidate.projectSeq <= lastSeq) continue; // duplicate replay entries are idempotent
          if (candidate.projectSeq !== expectedSeq) {
            throw new ProjectEventStreamRecoveryRequired('Replay has a projectSeq gap.');
          }
          if (frame.id !== undefined && replay.events.length === 1 && frame.id !== String(candidate.projectSeq)) {
            throw new ProjectEventStreamProtocolError('Replay SSE id does not match its event sequence.');
          }
          dispatchProjectEvent(candidate);
          lastSeq = candidate.projectSeq;
          expectedSeq += 1;
          cursor = { runtimeId: replay.runtimeId, seq: lastSeq };
        }
        if (replay.currentSeq !== lastSeq) {
          throw new ProjectEventStreamRecoveryRequired('Replay does not cover the reconnect currentSeq.');
        }
        return;
      }

      if (frame.event === 'project-event') {
        const envelope = parseProjectEventEnvelope(frame.data, projectId);
        if (frame.id !== undefined && frame.id !== String(envelope.projectSeq)) {
          throw new ProjectEventStreamProtocolError('Live SSE id does not match projectSeq.');
        }
        if (cursor === undefined || envelope.runtimeId !== cursor.runtimeId) {
          throw new ProjectEventStreamRecoveryRequired('Live event runtime has no accepted snapshot cursor.');
        }
        if (envelope.projectSeq <= cursor.seq) return; // replay/live overlap
        if (envelope.projectSeq !== cursor.seq + 1) {
          throw new ProjectEventStreamRecoveryRequired('Live event projectSeq has a gap.');
        }
        dispatchProjectEvent(envelope);
        cursor = { runtimeId: envelope.runtimeId, seq: envelope.projectSeq };
        retryAttempt = 0;
        return;
      }

      // The current Core route has only snapshot, replay and project-event
      // frames. Unknown frame names require a fresh authoritative snapshot.
      throw new ProjectEventStreamRecoveryRequired(`Unknown ProjectEvent SSE frame: ${frame.event}`);
    };

    // Optional EventSource seam follows the same protocol validation and dispatch path.
    if (options.eventSourceFactory) {
      const source = options.eventSourceFactory(url);
      for (const eventName of ['snapshot', 'replay', 'project-event']) {
        source.addEventListener(eventName, (message) => {
          try {
            processFrame({ event: eventName, data: (message as MessageEvent<string>).data,
              ...((message as MessageEvent<string>).lastEventId ? { id: (message as MessageEvent<string>).lastEventId } : {}) });
          } catch {
            // Ignore malformed seam frames, matching production's reconnect recovery behavior.
          }
        });
      }
      return () => source.close();
    }

    if (fetcher === undefined || typeof AbortController === 'undefined') return undefined;

    connect = async (): Promise<void> => {
      if (disposed || browserOffline) return;
      const ownGeneration = ++generation;
      const controller = new AbortController();
      activeController = controller;
      let forceSnapshot = false;
      let terminal = false;
      try {
        const headers: Record<string, string> = { Accept: 'text/event-stream' };
        if (this.http.config.token) headers['Authorization'] = `Bearer ${this.http.config.token}`;
        const response = await fetcher(currentUrl(), { headers, signal: controller.signal });
        if (disposed || ownGeneration !== generation || controller.signal.aborted) return;
        if (!response.ok) {
          terminal = response.status === 401 || response.status === 403 || response.status === 404;
          throw new Error(`ProjectEvent stream returned HTTP ${response.status}.`);
        }
        if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
          forceSnapshot = true;
          throw new ProjectEventStreamProtocolError('ProjectEvent response is not text/event-stream.');
        }
        if (response.body === null) throw new Error('ProjectEvent response has no readable body.');

        const reader = response.body.getReader();
        activeReader = reader;
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (disposed || ownGeneration !== generation || controller.signal.aborted) return;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const next = takeSseFrame(buffer);
            if (next === undefined) break;
            buffer = next.rest;
            processFrame(next.frame);
          }
        }
        buffer += decoder.decode();
        // An unterminated tail is not a complete SSE event and cannot advance
        // the cursor. EOF still reconnects from the last complete frame.
      } catch (error: unknown) {
        if (error instanceof ProjectEventStreamRecoveryRequired || error instanceof ProjectEventStreamProtocolError) {
          forceSnapshot = true;
        }
        if (disposed || ownGeneration !== generation || controller.signal.aborted) return;
      } finally {
        if (activeReader !== undefined && ownGeneration === generation) {
          try { await activeReader.cancel(); } catch { /* stream may already be closed */ }
          activeReader = undefined;
        }
        if (activeController === controller) activeController = undefined;
      }
      if (disposed || ownGeneration !== generation) return;
      scheduleReconnect(forceSnapshot, terminal);
    };

    const clearRetry = (): void => {
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      retryTimer = undefined;
    };
    const stopCurrentConnection = async (): Promise<void> => {
      generation += 1;
      const controller = activeController;
      const reader = activeReader;
      activeController = undefined;
      activeReader = undefined;
      controller?.abort();
      if (reader !== undefined) {
        try { await reader.cancel(); } catch { /* stream may already be closed */ }
      }
    };
    const onOffline = (): void => {
      browserOffline = true;
      clearRetry();
      void stopCurrentConnection();
    };
    const onOnline = (): void => {
      if (!browserOffline || disposed) return;
      browserOffline = false;
      cursor = undefined;
      retryAttempt = 0;
      clearRetry();
      void (async () => {
        await stopCurrentConnection();
        if (!disposed) await connect();
      })();
    };
    const connectivityTarget = globalThis as typeof globalThis & {
      addEventListener?: (type: string, listener: EventListener) => void;
      removeEventListener?: (type: string, listener: EventListener) => void;
    };
    connectivityTarget.addEventListener?.('offline', onOffline);
    connectivityTarget.addEventListener?.('online', onOnline);

    void connect();
    return () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      clearRetry();
      connectivityTarget.removeEventListener?.('offline', onOffline);
      connectivityTarget.removeEventListener?.('online', onOnline);
      activeController?.abort();
      activeController = undefined;
      const reader = activeReader;
      activeReader = undefined;
      if (reader !== undefined) void reader.cancel().catch(() => undefined);
    };
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
      const run = (result as { review?: { run?: { id?: string; projectId?: string } } } | null)?.review?.run;
      if (typeof run?.id !== 'string' || !run.id || run.projectId !== projectId) {
        throw new Error('创建回执没有确认当前项目的任务身份，请先核对任务，勿重复创建。');
      }
      return receipt('delegate', { runId: run.id });
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
      await this.continuations.submit(projectId, {
        operationId: input.operationId,
        mode: 'continue_existing',
        contextInheritance: 'inherit',
        checkout: 'shared',
        provider: conversation.provider,
        connectedConversationId: input.conversationId,
      }, signal);
      return receipt('resume', { continuationOperationId: input.operationId, conversationId: input.conversationId });
    } catch (error: unknown) {
      return toProductError(error, '续走提交失败');
    }
  }

  /**
   * Start one of the two honest "new session" modes through the existing T6
   * continuation journal. This only records the intent and returns the
   * operation receipt; provider side effects happen later through the existing
   * recovery action path, so a retry cannot create a second external session.
   */
  async newSession(
    projectId: string,
    mode: 'selected_context' | 'blank_new',
    input: CollaborationNewSessionInputV1,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    try {
      const session = await this.readSession(projectId, input.conversationId, signal);
      if (session === undefined) return unavailable('当前会话不存在或已断开');
      const capability = mode === 'selected_context'
        ? session.capabilities.canSelectedContext
        : session.capabilities.canBlankNew;
      if (!capability) {
        return unavailable(
          session.capabilityReasons?.[mode === 'selected_context' ? 'canSelectedContext' : 'canBlankNew']
            ?? '当前协作方式暂不支持新建会话',
        );
      }
      const conversations = await this.conversations.listConnectedConversations(projectId, signal);
      const conversation = conversations.find((item: ConnectedConversationV1) => item.id === input.conversationId);
      if (conversation === undefined) return unavailable('当前会话不存在或已断开');
      await this.continuations.submit(projectId, {
        operationId: input.operationId,
        mode,
        // New-session modes never inherit the source conversation history;
        // selected references are carried explicitly in orderedReferences.
        contextInheritance: 'none',
        checkout: input.checkout ?? 'shared',
        provider: conversation.provider,
        connectedConversationId: input.conversationId,
        ...(input.orderedReferences === undefined ? {} : { orderedReferences: input.orderedReferences }),
      }, signal);
      return receipt('new_session', { continuationOperationId: input.operationId, conversationId: input.conversationId });
    } catch (error: unknown) {
      return toProductError(error, '新建会话提交失败');
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
  // Live continuation transport
  // ------------------------------------------------------------------

  /**
   * send = 对当前 Conversation 再说一句。
   *
   * 这是 continuation 的独立 transport。它故意不调用 `delegate` /
   * `CoreRunClient.createRun`：一次“继续当前会话”只能由 caller-owned
   * continuationOperationId + messageId 去重并回到原 provider session。
   */
  async send(
    projectId: string,
    input: CollaborationSendInputV1,
    signal?: AbortSignal,
  ): Promise<CollaborationCommandResultV1> {
    const sendInput = input as CollaborationSendInputV1 & {
      readonly continuationOperationId: string;
      readonly messageId: string;
    };
    try {
      const value = await coreRequest<unknown>(
        this.http,
        'POST',
        `/projects/${encodeURIComponent(projectId)}/connected-conversations/${encodeURIComponent(input.conversationId)}/collaboration-send`,
        {
          signal,
          body: {
            conversationId: input.conversationId,
            continuationOperationId: sendInput.continuationOperationId,
            messageId: sendInput.messageId,
            text: input.text,
            ...(input.orderedReferences === undefined ? {} : { orderedReferences: input.orderedReferences }),
            ...(input.targetRefs === undefined ? {} : { targetRefs: input.targetRefs }),
          },
        },
      );

      return normalizeCollaborationSendReceipt(value, sendInput);
    } catch (error: unknown) {
      // Once POST has begun, a lost response does not prove that the message was not sent.
      if ((error instanceof HttpError || error instanceof CoreApiError) && error.status === 0) {
        return { ok: false, error: collaborationProductErrorV1('operation_unknown',
          '连接中断，发送结果尚未确认。请核对记录或重试同一条原消息。', { retryable: true }) };
      }
      return toProductError(error, '续聊发送失败');
    }
  }

  /** fork = native full-history 分叉。无 authoritative probe；selected-context new 不冒充 fork。 */
  fork(projectId: string, input: CollaborationForkInputV1): Promise<CollaborationCommandResultV1> {
    void projectId;
    void input;
    return Promise.resolve(unavailable('「从这里分叉」暂不被当前协作方式支持'));
  }
}
