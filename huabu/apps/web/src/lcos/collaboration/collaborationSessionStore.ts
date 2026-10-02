// Collaboration Session Store —— Glyth / Work View / Composer 共享的 projection 消费口。
//
// 数据唯一来源：Core Collaboration read projection（协作会话产品投影）。
// 每个 project 共享一条既有 SSE（GET /projects/:pid/events，ProjectEventHub 是唯一
// 事件 owner；本 store 不建第二 Event Bus）。事件到达 = 重取该 project 下全部 watched
// 会话的投影（invalidation，事件本身不携带状态）。
//
// 不缓存真相；投影缺席/失败如实呈现（loading / error），不伪造 ready。

import { CoreCollaborationClient } from '@local-creative-os/web-gen2';
import { create } from 'zustand';

import { SessionRefreshQueue } from './sessionRefreshQueue';

import { createLcosCoreSession } from '../app/lcosCoreClient';

import type {
  CollaborationSessionProjectionV1,
  CollaborationTimelineItemV1,
} from '@local-creative-os/contracts';

export interface CollaborationSessionEntry {
  readonly status: 'loading' | 'ready' | 'error';
  readonly projection?: CollaborationSessionProjectionV1;
  readonly timeline?: readonly CollaborationTimelineItemV1[];
  readonly timelineStatus?: 'ready' | 'error';
}

const keyOf = (projectId: string, conversationId: string): string =>
  `${projectId}:${conversationId}`;

interface CollaborationSessionState {
  readonly entries: ReadonlyMap<string, CollaborationSessionEntry>;
  /** 每个消费者持有一个 watch；同会话共享读取和 SSE，需配对 unwatch。 */
  readonly watch: (projectId: string, conversationId: string) => void;
  /** 释放一个消费者；最后一个会话与资产消费者退出时才关闭 project SSE。 */
  readonly unwatch: (projectId: string, conversationId: string) => void;
  /** 立即重取（手动刷新 / 动作回执后）。 */
  readonly refresh: (projectId: string, conversationId: string) => Promise<void>;
  /** Subscribe to canonical Artifact invalidations through the same project SSE. */
  readonly watchArtifactChanges: (projectId: string, listener: () => void) => () => void;
  /** Read-only project invalidation (Railway/bindings), sharing the same project SSE. */
  readonly watchProjectChanges: (projectId: string, listener: () => void) => () => void;
}

// module 级运行态（不进 React 树）：project → watcher 集合 / SSE 关闭器 / facade。
const watchersByProject = new Map<string, Map<string, number>>();
const subscriptionByProject = new Map<string, () => void>();
const clientByProject = new Map<string, CoreCollaborationClient>();
const artifactListenersByProject = new Map<string, Set<() => void>>();
const projectListenersByProject = new Map<string, Set<() => void>>();

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

  const queue = new SessionRefreshQueue();

  const refresh = async (projectId: string, conversationId: string): Promise<void> => {
    if (!watchersByProject.get(projectId)?.has(conversationId)) return;
    const key = keyOf(projectId, conversationId);
    const collaboration = collaborationFor(projectId);
    await queue.refresh(key, async (signal) => {
      // A timeline failure must not erase otherwise valid identity/capabilities.
      const [projection, timelineResult] = await Promise.all([
        collaboration.readSession(projectId, conversationId, signal),
        collaboration.readTimeline(projectId, conversationId, { limit: 50, signal })
          .then((timeline) => ({ ok: true as const, timeline }), () => ({ ok: false as const })),
      ]);
      if (projection?.projectId !== projectId || projection.conversationId !== conversationId) {
        throw new Error('Conversation projection identity mismatch or missing.');
      }
      return { projection, timelineResult };
    }, ({ projection, timelineResult }) => {
      const old = get().entries.get(key);
      setEntry(key, { status: 'ready', projection,
        timeline: timelineResult.ok ? timelineResult.timeline : old?.timeline,
        timelineStatus: timelineResult.ok ? 'ready' : 'error',
      });
    }, () => setEntry(key, { status: 'error', timeline: get().entries.get(key)?.timeline, timelineStatus: 'error' }));
  };

  const ensureProjectSubscription = (projectId: string): void => {
    if (subscriptionByProject.has(projectId)) return;
    const collaboration = collaborationFor(projectId);
    // 会话维度仅占位（事件按 project 广播，重取按 watcher 列表）。
    const close = collaboration.subscribe(projectId, '*', () => {
      const watched = watchersByProject.get(projectId);
      for (const conversationId of watched?.keys() ?? []) {
        void get().refresh(projectId, conversationId);
      }
      for (const listener of projectListenersByProject.get(projectId) ?? []) listener();
    }, {
      onProjectEvent: (event) => {
        if (event.type !== 'artifact.changed') return;
        for (const listener of artifactListenersByProject.get(projectId) ?? []) listener();
      },
      onProjectRecovery: () => {
        // Snapshot recovery also invalidates Artifact/host projections. The normal
        // session.changed dispatch already refreshes watched sessions and project listeners.
        for (const listener of artifactListenersByProject.get(projectId) ?? []) listener();
      },
    });
    if (close !== undefined) subscriptionByProject.set(projectId, close);
  };

  const releaseProjectSubscriptionIfUnused = (projectId: string): void => {
    if ((watchersByProject.get(projectId)?.size ?? 0) > 0) return;
    if ((artifactListenersByProject.get(projectId)?.size ?? 0) > 0) return;
    if ((projectListenersByProject.get(projectId)?.size ?? 0) > 0) return;
    subscriptionByProject.get(projectId)?.();
    subscriptionByProject.delete(projectId);
    clientByProject.delete(projectId);
  };

  return {
    entries: new Map(),

    watch: (projectId, conversationId) => {
      const key = keyOf(projectId, conversationId);
      let watchers = watchersByProject.get(projectId);
      if (watchers === undefined) {
        watchers = new Map();
        watchersByProject.set(projectId, watchers);
      }
      const consumers = watchers.get(conversationId) ?? 0;
      watchers.set(conversationId, consumers + 1);
      if (consumers > 0) return;
      setEntry(key, { status: 'loading' });
      ensureProjectSubscription(projectId);
      void get().refresh(projectId, conversationId);
    },

    unwatch: (projectId, conversationId) => {
      const watchers = watchersByProject.get(projectId);
      if (watchers === undefined) return;
      const consumers = watchers.get(conversationId);
      if (consumers === undefined) return;
      if (consumers > 1) {
        watchers.set(conversationId, consumers - 1);
        return;
      }
      watchers.delete(conversationId);
      const key = keyOf(projectId, conversationId);
      queue.release(key);
      set((state) => { const entries = new Map(state.entries); entries.delete(key); return { entries }; });
      if (watchers.size === 0) {
        watchersByProject.delete(projectId);
        releaseProjectSubscriptionIfUnused(projectId);
      }
    },

    refresh,

    watchProjectChanges: (projectId, listener) => {
      let listeners = projectListenersByProject.get(projectId);
      if (listeners === undefined) { listeners = new Set(); projectListenersByProject.set(projectId, listeners); }
      listeners.add(listener);
      ensureProjectSubscription(projectId);
      return () => {
        const current = projectListenersByProject.get(projectId);
        current?.delete(listener);
        if (current?.size === 0) projectListenersByProject.delete(projectId);
        releaseProjectSubscriptionIfUnused(projectId);
      };
    },

    watchArtifactChanges: (projectId, listener) => {
      let listeners = artifactListenersByProject.get(projectId);
      if (listeners === undefined) {
        listeners = new Set();
        artifactListenersByProject.set(projectId, listeners);
      }
      listeners.add(listener);
      ensureProjectSubscription(projectId);
      return () => {
        const current = artifactListenersByProject.get(projectId);
        current?.delete(listener);
        if (current?.size === 0) artifactListenersByProject.delete(projectId);
        releaseProjectSubscriptionIfUnused(projectId);
      };
    },
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
