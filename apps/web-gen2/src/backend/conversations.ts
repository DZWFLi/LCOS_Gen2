// Sprint 2B（T4）：Conversation / Work View 的唯一 typed HTTP facade（React-free）。
//
// 只消费既有 Core routes（receiver / conversation-identity / f6-assembly 的
// identity·reach），按 connectedConversationId 定位；不新建第二 Conversation truth。
// Work View 聚合 route 属 T6 PLANNED，缺失时前端保持 identity/reach 可读的 partial 状态。

import type {
  ConnectedConversationV1,
  ConversationIdentityChainV1,
  ConversationReachResultV0,
  ConversationWorkViewAggregateV1,
} from '@local-creative-os/contracts';
import { HttpClient } from './client.js';
import { coreRequest } from './coreTypes.js';

export class CoreConversationClient {
  constructor(private readonly http: HttpClient) {}

  /** GET /projects/:pid/connected-conversations → 承接关系列表。 */
  listConnectedConversations(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ConnectedConversationV1[]> {
    return coreRequest<ConnectedConversationV1[]>(
      this.http,
      'GET',
      `/projects/${encodeURIComponent(projectId)}/connected-conversations`,
      { signal },
    );
  }

  /** GET .../connected-conversations/:cid/identity → 身份链；404 → undefined（不猜）。 */
  getIdentity(
    projectId: string,
    connectedConversationId: string,
    signal?: AbortSignal,
  ): Promise<ConversationIdentityChainV1 | undefined> {
    return this.getOrUndefined<ConversationIdentityChainV1>(
      `/projects/${encodeURIComponent(projectId)}/connected-conversations/${encodeURIComponent(connectedConversationId)}/identity`,
      signal,
    );
  }

  /** GET .../connected-conversations/:cid/reach → 可达性；404 → undefined。 */
  getReach(
    projectId: string,
    connectedConversationId: string,
    signal?: AbortSignal,
  ): Promise<ConversationReachResultV0 | undefined> {
    return this.getOrUndefined<ConversationReachResultV0>(
      `/projects/${encodeURIComponent(projectId)}/connected-conversations/${encodeURIComponent(connectedConversationId)}/reach`,
      signal,
    );
  }

  /** GET .../connected-conversations/:cid/work-view → T6 聚合（identity-only 也返回 200 partial）。 */
  getWorkView(
    projectId: string,
    connectedConversationId: string,
    signal?: AbortSignal,
  ): Promise<ConversationWorkViewAggregateV1 | undefined> {
    return this.getOrUndefined<ConversationWorkViewAggregateV1>(
      `/projects/${encodeURIComponent(projectId)}/connected-conversations/${encodeURIComponent(connectedConversationId)}/work-view`,
      signal,
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
