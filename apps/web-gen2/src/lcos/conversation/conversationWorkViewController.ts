// Sprint 2B（T4）：Conversation Work View 控制器 —— epoch/generation guard（T4 §4）。
//
// 规则：open/retarget 先 abort 旧 controller + bump generation；回包只在
// projectId + targetKey + generation 全匹配时提交，否则丢弃（不 toast/不污染新 target）。
// Abort 是尽力取消；generation 校验是最终 UI 防线。

import { CoreConversationClient } from '../../backend/conversations.js';
import {
  createEmptyConversationWorkViewV1,
  type ConversationWorkViewSectionKindV1,
  type ConversationWorkViewSectionStateV1,
  type ConversationWorkViewStateV1,
} from './conversationWorkViewModel.js';

interface WorkViewEpoch {
  readonly projectId: string;
  readonly targetKey: string;
  readonly generation: number;
  readonly controller: AbortController;
}

export class ConversationWorkViewController {
  private state: ConversationWorkViewStateV1 | undefined;
  private epoch: WorkViewEpoch | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: CoreConversationClient) {}

  /** React 消费侧订阅（pull-based：每次变更后通知，read() 取最新快照）。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  open(projectId: string, connectedConversationId: string): void {
    this.epoch?.controller.abort();
    const generation = (this.epoch?.generation ?? 0) + 1;
    const controller = new AbortController();
    this.epoch = { projectId, targetKey: connectedConversationId, generation, controller };
    this.state = createEmptyConversationWorkViewV1(projectId, connectedConversationId);
    this.notify();
    void this.loadAggregate(generation);
    void this.loadTimeline(generation);
  }

  read(): ConversationWorkViewStateV1 | undefined {
    return this.state;
  }

  dispose(): void {
    this.epoch?.controller.abort();
    this.epoch = undefined;
    this.state = undefined;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private async loadAggregate(generation: number): Promise<void> {
    const epoch = this.epoch;
    if (!epoch || epoch.generation !== generation) return;
    try {
      const aggregate = await this.client.getWorkView(epoch.projectId, epoch.targetKey, epoch.controller.signal);
      if (!this.epoch || this.epoch.generation !== generation || this.epoch.projectId !== epoch.projectId || this.epoch.targetKey !== epoch.targetKey) return;
      this.state = {
        ...this.state!,
        sections: {
          ...this.state!.sections,
          identity: { kind: 'identity', status: aggregate === undefined ? 'error' : 'loaded', identity: aggregate?.identity },
          reach: { kind: 'reach', status: aggregate === undefined ? 'error' : 'loaded', reach: aggregate?.reach },
        },
        runs: aggregate?.runs ?? [],
        operations: aggregate?.operations ?? [],
        revision: this.state!.revision + 1,
      };
      this.notify();
    } catch (error: unknown) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted) return;
      if (!this.epoch || this.epoch.generation !== generation) return;
      this.state = {
        ...this.state!,
        sections: {
          ...this.state!.sections,
          identity: { kind: 'identity', status: 'error', errorCode: (error as { code?: string }).code ?? 'read_error' },
          reach: { kind: 'reach', status: 'error', errorCode: (error as { code?: string }).code ?? 'read_error' },
        },
        revision: this.state!.revision + 1,
      };
      this.notify();
    }
  }

  private async loadTimeline(generation: number): Promise<void> {
    const epoch = this.epoch;
    if (!epoch || epoch.generation !== generation) return;
    try {
      const conversations = await this.client.listConnectedConversations(epoch.projectId, epoch.controller.signal);
      this.commitSection(epoch, 'timeline', { kind: 'timeline', status: 'loaded', conversations });
    } catch (error: unknown) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted) return;
      const code = (error as { code?: string }).code;
      this.commitSection(epoch, 'timeline', { kind: 'timeline', status: 'error', errorCode: code ?? 'read_error' });
    }
  }

  private commitSection(
    epoch: WorkViewEpoch,
    kind: ConversationWorkViewSectionKindV1,
    section: ConversationWorkViewSectionStateV1,
  ): void {
    if (!this.epoch) return;
    if (
      this.epoch.generation !== epoch.generation ||
      this.epoch.projectId !== epoch.projectId ||
      this.epoch.targetKey !== epoch.targetKey
    ) {
      return; // 迟到回包：丢弃，不污染新 target
    }
    this.state = {
      ...this.state!,
      sections: { ...this.state!.sections, [kind]: section },
      revision: this.state!.revision + 1,
    };
    this.notify();
  }
}
