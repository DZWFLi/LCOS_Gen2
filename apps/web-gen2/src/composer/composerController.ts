// Sprint P0-03（T3/T4/T6 consumer）：Composer controller —— 草稿 + 提交 + receipt 回读。
//
// 规则（T3 §2 / T6 §3.2 / T5 P0-03）：
// - open/retarget 先 abort 旧 epoch + bump generation；回包只在 projectId+anchor+generation
//   全匹配时提交，否则丢弃（迟到回包不污染新 target）。
// - 提交只走 owner allowedActions（submit_run / submit_continuation），由 body 从 projection 读取，
//   controller 校验后执行；普通 Run 提交 → POST /runs；续工提交 → POST conversation-continuations（新 operation）。
// - 本地 outcome=unconfirmed（timeout/未知）后禁止重复提交，直到 refresh() 重新核对。
// - 提交内容含选定引用：把 body 传入的 typed refs 映射为 OrderedRunReferenceV2（view/artifact），
//   view/artifact 之外的类型本 Sprint 不提交（诚实边界，不伪造）。

import type { CommandDraftV1, ComposerSubmitActionV1, ComposerSubmitProjectionV1, ContinuationSubmitRequestV1, OrderedRunReferenceV2 } from '@local-creative-os/contracts';
import type { CoreContinuationClient } from '../backend/continuation.js';
import type { CoreDraftClient } from '../backend/drafts.js';
import type { CreateRunInputV1, CoreRunClient } from '../backend/runs.js';
import type { ComposerSubmitOutcomeV1 } from './composerSubmitMapper.js';

export interface ComposerReferenceLikeV1 {
  readonly entityType: string;
  readonly entityId: string;
}

export interface ComposerControllerStateV1 {
  readonly projectId: string;
  readonly composerAnchor: string;
  readonly workspaceId: string | null;
  readonly draft: CommandDraftV1 | null;
  readonly projection: ComposerSubmitProjectionV1 | null;
  readonly submitting: boolean;
  readonly outcome: ComposerSubmitOutcomeV1;
  readonly errorCode: string | undefined;
  readonly coreReachable: boolean;
  readonly revision: number;
}

interface ComposerEpoch {
  readonly projectId: string;
  readonly composerAnchor: string;
  readonly workspaceId: string | null;
  readonly generation: number;
  readonly controller: AbortController;
}

const SUBMIT_ACTIONS: readonly ComposerSubmitActionV1[] = ['submit_run', 'submit_continuation'];

export class ComposerController {
  private state: ComposerControllerStateV1 | undefined;
  private epoch: ComposerEpoch | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly clients: {
    readonly drafts: CoreDraftClient;
    readonly runs: CoreRunClient;
    readonly continuations: CoreContinuationClient;
  }) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  read(): ComposerControllerStateV1 | undefined {
    return this.state;
  }

  open(projectId: string, composerAnchor: string, workspaceId: string | null = null): void {
    this.epoch?.controller.abort();
    const generation = (this.epoch?.generation ?? 0) + 1;
    const controller = new AbortController();
    this.epoch = { projectId, composerAnchor, workspaceId, generation, controller };
    this.state = {
      projectId, composerAnchor, workspaceId,
      draft: null, projection: null, submitting: false, outcome: 'none',
      errorCode: undefined, coreReachable: true, revision: 0,
    };
    this.notify();
    void this.load(generation);
  }

  dispose(): void {
    this.epoch?.controller.abort();
    this.epoch = undefined;
    this.state = undefined;
    this.notify();
  }

  /** 保存草稿（prompt/receiver/intent 等），保存后重读 submit projection。 */
  async saveDraft(patch: Partial<Pick<CommandDraftV1, 'prompt' | 'receiverId' | 'intent' | 'resultPolicy' | 'provider' | 'contextViewIds' | 'selectionViewIds'>>): Promise<CommandDraftV1> {
    const state = this.requireState();
    if (state.draft === null) {
      throw new Error('Composer draft is not loaded; cannot save before open().');
    }
    const draft = {
      ...state.draft,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const saved = await this.clients.drafts.saveDraft(state.projectId, state.composerAnchor, {
      workspaceId: state.workspaceId,
      surfaceKind: draft.surfaceKind,
      surfaceId: draft.surfaceId,
      prompt: draft.prompt,
      contextViewIds: draft.contextViewIds,
      selectionViewIds: draft.selectionViewIds,
      receiverId: draft.receiverId,
      provider: draft.provider,
      createAsNewNode: draft.createAsNewNode,
      intent: draft.intent,
      resultPolicy: draft.resultPolicy,
    });
    this.setState({ draft: saved });
    await this.reloadProjection();
    return saved;
  }

  /** 提交（kind 必须来自 projection.allowedActions）；unconfirmed 后禁止重复提交。 */
  async submit(kind: ComposerSubmitActionV1, refs: readonly ComposerReferenceLikeV1[]): Promise<ComposerControllerStateV1> {
    const state = this.requireState();
    if (state.submitting) throw new Error('Composer submit already in flight.');
    if (state.outcome === 'unconfirmed') throw new Error('Composer submit is unconfirmed; refresh before submitting again.');
    if (!SUBMIT_ACTIONS.includes(kind)) throw new Error(`Composer action ${kind} is not a submit action.`);
    const projection = state.projection;
    if (projection === null || !projection.allowedActions.includes(kind)) {
      throw new Error(`Composer action ${kind} is not allowed by the current projection.`);
    }
    const draft = state.draft;
    if (draft === null || draft.receiverId === null || draft.prompt.trim().length === 0) {
      throw new Error('Composer requires a draft with a receiver and a non-empty prompt before submit.');
    }
    const epoch = this.epoch;
    if (!epoch) throw new Error('Composer target changed.');
    if (epoch.projectId !== state.projectId || epoch.composerAnchor !== state.composerAnchor) {
      throw new Error('Composer target changed.');
    }

    this.setState({ submitting: true, outcome: 'none', errorCode: undefined });
    try {
      if (kind === 'submit_continuation') {
        const operationId = `cont-${globalThis.crypto.randomUUID()}`;
        await this.clients.continuations.submit(draft.projectId, {
          operationId,
          connectedConversationId: draft.receiverId,
          mode: 'continue_existing',
          contextInheritance: 'inherit',
          checkout: 'shared',
          provider: draft.provider,
          ...(refs.length === 0 ? {} : { orderedReferences: this.orderedReferencesFromRefs(refs) }),
        } satisfies Omit<ContinuationSubmitRequestV1, 'projectId' | 'schemaVersion'>);
      } else {
        await this.clients.runs.createRun(draft.projectId, this.runInputFromDraft(draft, refs));
      }
      this.setState({ outcome: 'acknowledged', submitting: false });
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        this.setState({ outcome: 'rejected', submitting: false, errorCode: (error as { code?: string }).code ?? 'rejected' });
      } else {
        // timeout / 5xx / network：无 canonical receipt 可核对 → unconfirmed，禁重复提交
        this.setState({ outcome: 'unconfirmed', submitting: false, errorCode: (error as { code?: string }).code ?? 'unconfirmed' });
      }
    }
    await this.reloadProjection();
    return this.requireState();
  }

  /** refresh：重读投影（unknown → reconciling 后回读）。 */
  async refresh(): Promise<ComposerControllerStateV1> {
    await this.reloadProjection();
    return this.requireState();
  }

  /** 提交确认后复位本地 outcome（receipt 已在 Core 持久化），Composer 回到可编辑态，无需重载。 */
  resetOutcome(): ComposerControllerStateV1 {
    this.requireState();
    this.setState({ outcome: 'none', errorCode: undefined });
    return this.requireState();
  }

  private async load(generation: number): Promise<void> {
    const state = this.requireState();
    const epoch = this.epoch;
    if (!epoch || epoch.generation !== generation) return;
    try {
      const [draft, projection] = await Promise.all([
        this.clients.drafts.getDraft(state.projectId, state.composerAnchor, state.workspaceId, epoch.controller.signal),
        this.clients.drafts.getComposerSubmitProjection(state.projectId, state.composerAnchor, state.workspaceId, epoch.controller.signal),
      ]);
      if (!this.epoch || this.epoch.generation !== generation) return;
      this.setState({ draft, projection, coreReachable: true });
    } catch (error: unknown) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted) return;
      if (!this.epoch || this.epoch.generation !== generation) return;
      const status = (error as { status?: number }).status;
      this.setState({
        coreReachable: !(typeof status === 'number' && status >= 500),
        errorCode: (error as { code?: string }).code ?? 'read_error',
      });
    }
  }

  private async reloadProjection(): Promise<void> {
    const state = this.requireState();
    const epoch = this.epoch;
    if (!epoch) return;
    try {
      const projection = await this.clients.drafts.getComposerSubmitProjection(state.projectId, state.composerAnchor, state.workspaceId, epoch.controller.signal);
      if (!this.epoch || this.epoch.generation !== epoch.generation) return;
      this.setState({ projection, coreReachable: true });
    } catch (error: unknown) {
      if (!this.epoch || this.epoch.generation !== epoch.generation) return;
      this.setState({ errorCode: (error as { code?: string }).code ?? 'read_error' });
    }
  }

  private runInputFromDraft(draft: CommandDraftV1, refs: readonly ComposerReferenceLikeV1[]): CreateRunInputV1 {
    const orderedReferences = this.orderedReferencesFromRefs(refs);
    return {
      instruction: draft.prompt,
      outputIntent: draft.intent,
      ...(draft.workspaceId === null ? {} : { workspaceId: draft.workspaceId }),
      requestedProvider: draft.provider === 'workbuddy' || draft.provider === 'auto' ? draft.provider : 'codex',
      ...(draft.receiverId === null ? {} : { receiverRef: { connectedConversationId: draft.receiverId } }),
      ...(orderedReferences.length > 0 ? { orderedReferences } : {}),
      ...(draft.resultPolicy === 'reply_only' ? {} : { resultPolicy: { type: draft.resultPolicy } }),
    };
  }

  /** typed refs → OrderedRunReferenceV2（普通 Run 与续工共用；note/resource 等 F6B 裁决类型诚实跳过）。 */
  private orderedReferencesFromRefs(refs: readonly ComposerReferenceLikeV1[]): OrderedRunReferenceV2[] {
    const orderedReferences: OrderedRunReferenceV2[] = [];
    for (const [order, ref] of refs.entries()) {
      switch (ref.entityType) {
        case 'artifact': orderedReferences.push({ ref: { type: 'artifact', artifactId: ref.entityId }, order }); break;
        case 'view': orderedReferences.push({ ref: { type: 'view', viewId: ref.entityId }, order }); break;
        case 'scope': orderedReferences.push({ ref: { type: 'scope', scopeId: ref.entityId }, order }); break;
        case 'workspace': orderedReferences.push({ ref: { type: 'workspace', workspaceId: ref.entityId }, order }); break;
        case 'conversation': orderedReferences.push({ ref: { type: 'conversation', conversationSessionId: ref.entityId }, order }); break;
        case 'component': orderedReferences.push({ ref: { type: 'component', componentId: ref.entityId }, order }); break;
        default: break; // note/resource/其它类型不进 OrderedRunReference（F6B 裁决），诚实跳过
      }
    }
    return orderedReferences;
  }

  private requireState(): ComposerControllerStateV1 {
    if (this.state === undefined) throw new Error('Composer controller is not open.');
    return this.state;
  }

  private setState(patch: Partial<ComposerControllerStateV1>): void {
    this.state = { ...this.requireState(), ...patch, revision: this.state!.revision + 1 };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
