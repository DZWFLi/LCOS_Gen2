// Sprint P0-04（T4/T6 consumer）：Capture Inbox 控制器（epoch guard 同 §4）。
// 只消费 T6 capture-operation 投影 + materialize 路由；apply 后回读投影（receipt → 逐项结果）。
// 跨目标迟到回包：open/retarget 先 abort 旧 epoch + bump generation。

import type { CaptureMaterializeResultV1, CaptureOperationProjectionV1 } from '@local-creative-os/contracts';
import type { CoreCaptureClient } from '../../backend/captures.js';

export interface CaptureInboxControllerStateV1 {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly status: 'idle' | 'loading' | 'loaded' | 'error';
  readonly operations: readonly CaptureOperationProjectionV1[];
  readonly applyingOperationId: string | null;
  readonly appliedThisSession: boolean;
  readonly lastMaterialize?: CaptureMaterializeResultV1;
  readonly errorCode?: string;
  readonly revision: number;
}

interface CaptureInboxEpoch {
  readonly projectId: string;
  readonly generation: number;
  readonly controller: AbortController;
}

export class CaptureInboxController {
  private state: CaptureInboxControllerStateV1 | undefined;
  private epoch: CaptureInboxEpoch | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: CoreCaptureClient) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(projectId: string): void {
    this.epoch?.controller.abort();
    const generation = (this.epoch?.generation ?? 0) + 1;
    const controller = new AbortController();
    this.epoch = { projectId, generation, controller };
    this.state = {
      schemaVersion: 1, projectId, status: 'loading', operations: [],
      applyingOperationId: null, appliedThisSession: false, revision: 0,
    };
    this.notify();
    void this.load(generation);
  }

  read(): CaptureInboxControllerStateV1 | undefined {
    return this.state;
  }

  dispose(): void {
    this.epoch?.controller.abort();
    this.epoch = undefined;
    this.state = undefined;
    this.notify();
  }

  /** apply：materialize 该 operation 的 staging items 到当前 project，成功后回读投影。 */
  async apply(operation: CaptureOperationProjectionV1): Promise<CaptureInboxControllerStateV1> {
    const state = this.requireState();
    if (!operation.allowedActions.includes('apply')) throw new Error(`Capture action apply is not allowed for ${operation.operationId}.`);
    if (state.applyingOperationId !== null) throw new Error('Capture apply already in flight.');
    const epoch = this.epoch;
    if (!epoch || epoch.projectId !== state.projectId) throw new Error('Capture target changed.');

    this.setState({ applyingOperationId: operation.operationId, errorCode: undefined });
    try {
      const materialize = await this.client.materialize(state.projectId, operation.stagingItemIds, epoch.controller.signal);
      if (!this.epoch || this.epoch.generation !== epoch.generation || this.epoch.projectId !== epoch.projectId) return this.requireState();
      this.setState({ lastMaterialize: materialize, appliedThisSession: true });
    } catch (error: unknown) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted) return this.requireState();
      if (!this.epoch || this.epoch.generation !== epoch.generation) return this.requireState();
      this.setState({ errorCode: (error as { code?: string }).code ?? 'apply_error' });
    } finally {
      if (this.epoch?.generation === epoch.generation) this.setState({ applyingOperationId: null });
    }
    await this.reload();
    return this.requireState();
  }

  /** reconcile：重读投影（unknown 核对，不重抓）。 */
  async refresh(): Promise<CaptureInboxControllerStateV1> {
    await this.reload();
    return this.requireState();
  }

  private async load(generation: number): Promise<void> {
    const state = this.requireState();
    const epoch = this.epoch;
    if (!epoch || epoch.generation !== generation) return;
    try {
      const operations = await this.client.listOperations(state.projectId, epoch.controller.signal);
      if (!this.epoch || this.epoch.generation !== generation) return;
      this.setState({ status: 'loaded', operations });
    } catch (error: unknown) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted) return;
      if (!this.epoch || this.epoch.generation !== generation) return;
      this.setState({ status: 'error', errorCode: (error as { code?: string }).code ?? 'read_error' });
    }
  }

  private async reload(): Promise<void> {
    const state = this.requireState();
    const epoch = this.epoch;
    if (!epoch) return;
    try {
      const operations = await this.client.listOperations(state.projectId, epoch.controller.signal);
      if (!this.epoch || this.epoch.generation !== epoch.generation) return;
      this.setState({ status: 'loaded', operations });
    } catch (error: unknown) {
      if (!this.epoch || this.epoch.generation !== epoch.generation) return;
      this.setState({ errorCode: (error as { code?: string }).code ?? 'read_error' });
    }
  }

  private requireState(): CaptureInboxControllerStateV1 {
    if (this.state === undefined) throw new Error('Capture Inbox controller is not open.');
    return this.state;
  }

  private setState(patch: Partial<CaptureInboxControllerStateV1>): void {
    this.state = { ...this.requireState(), ...patch, revision: this.state!.revision + 1 };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
