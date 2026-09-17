// Collaboration Session Store —— Glyth / Work View / Composer 共享的 projection 消费口。
//
// 数据唯一来源：Core Collaboration read projection（协作会话产品投影）。
// 每个 project 共享一条既有 SSE（GET /projects/:pid/events，ProjectEventHub 是唯一
// 事件 owner；本 store 不建第二 Event Bus）。事件到达 = 重取该 project 下全部 watched
// 会话的投影（invalidation，事件本身不携带状态）。
//
// 不缓存真相；投影缺席/失败如实呈现（loading / error），不伪造 ready。

import { create } from 'zustand';

import { CoreCollaborationClient } from '@local-creative-os/web-gen2';

import { createLcosCoreSession } from '../app/lcosCoreClient';

import type {
  CollaborationSessionProjectionV1,
  CollaborationTimelineItemV1,
} from '@local-creative-os/contracts';

export interface CollaborationSessionEntry {
  readonly status: 'loading' | 'ready' | 'error';
  readonly projection?: CollaborationSessionProjectionV1;
  readonly timeline?: readonly CollaborationTimelineItemV1[];
}

const keyOf = (projectId: string, conversationId: string): string =>
  `${projectId}:${conversationId}`;

interface CollaborationSessionState {
  readonly entries: ReadonlyMap<string, CollaborationSessionEntry>;
  /** 开始 watch（幂等）：首个 watcher 建立 project 级 SSE；返回 void。 */
  readonly watch: (projectId: string, conversationId: string) => void;
  /** 停止 watch；project 无 watcher 时关闭共享 SSE。 */
  readonly unwatch: (projectId: string, conversationId: string) => void;
  /** 立即重取（手动刷新 / 动作回执后）。 */
  readonly refresh: (projectId: string, conversationId: string) => Promise<void>;
}

// module 级运行态（不进 React 树）：project → watcher 集合 / SSE 关闭器 / facade。
const watchersByProject = new Map<string, Set<string>>();
const subscriptionByProject = new Map<string, () => void>();
const clientByProject = new Map<string, CoreCollaborationClient>();

function collaborationFor(projectId: string): CoreCollaborationClient {
  const existing = clientByProject.get(projectId);
  if (existing !== undefined) return existing;
  const session = createLcosCoreSession();
  const client = new CoreCollaborationClient(session.http);
  clientByProject.set(projectId, client);
  return client;
}

export const useCollaborationSessionStore = create<CollaborationSessionState>((set, get) => {
  const setEntry = (key: string, entry: CollaborationSessionEntry): void => {
    set((state) => {
      const next = new Map(state.entries);
      next.set(key, entry);
      return { entries: next };
    });
  };

  const refresh = async (projectId: string, conversationId: string): Promise<void> => {
    const key = keyOf(projectId, conversationId);
    const collaboration = collaborationFor(projectId);
    try {
      const [projection, timeline] = await Promise.all([
        collaboration.readSession(projectId, conversationId),
        collaboration.readTimeline(projectId, conversationId, { limit: 50 }),
      ]);
      if (projection === undefined) {
        setEntry(key, { status: 'error' });
        return;
      }
      setEntry(key, { status: 'ready', projection, timeline });
    } catch {
      setEntry(key, { status: 'error' });
    }
  };

  const ensureProjectSubscription = (projectId: string): void => {
    if (subscriptionByProject.has(projectId)) return;
    const collaboration = collaborationFor(projectId);
    // 会话维度仅占位（事件按 project 广播，重取按 watcher 列表）。
    const close = collaboration.subscribe(projectId, '*', () => {
      const watched = watchersByProject.get(projectId);
      if (watched === undefined) return;
      for (const conversationId of watched) {
        void get().refresh(projectId, conversationId);
      }
    });
    if (close !== undefined) subscriptionByProject.set(projectId, close);
  };

  return {
    entries: new Map(),

    watch: (projectId, conversationId) => {
      const key = keyOf(projectId, conversationId);
      let watchers = watchersByProject.get(projectId);
      if (watchers === undefined) {
        watchers = new Set();
        watchersByProject.set(projectId, watchers);
      }
      if (watchers.has(conversationId)) return;
      watchers.add(conversationId);
      if (!get().entries.has(key)) setEntry(key, { status: 'loading' });
      ensureProjectSubscription(projectId);
      void get().refresh(projectId, conversationId);
    },

    unwatch: (projectId, conversationId) => {
      const watchers = watchersByProject.get(projectId);
      if (watchers === undefined) return;
      watchers.delete(conversationId);
      if (watchers.size === 0) {
        watchersByProject.delete(projectId);
        subscriptionByProject.get(projectId)?.();
        subscriptionByProject.delete(projectId);
        clientByProject.delete(projectId);
      }
    },

    refresh,
  };
});

/** 读取某会话的投影 entry（未 watch = undefined，调用方决定是否在 effect 里 watch）。 */
export function readCollaborationEntry(
  entries: ReadonlyMap<string, CollaborationSessionEntry>,
  projectId: string | null | undefined,
  conversationId: string | null | undefined,
): CollaborationSessionEntry | undefined {
  if (projectId === null || projectId === undefined || conversationId === null || conversationId === undefined) {
    return undefined;
  }
  return entries.get(keyOf(projectId, conversationId));
}