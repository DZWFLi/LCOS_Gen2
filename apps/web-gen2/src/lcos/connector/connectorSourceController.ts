// Sprint P0-05（T4/T7 consumer）：Connector source 控制器（epoch guard 同 §4）。
// 只消费 T7 connector-source 投影；scan/import 动作不在此发起——扫描需桌面目录选择器（web GAP）、
// 导入需会话+scope（未接线），body 按 allowedActions 与宿主能力禁用。

import type { ConnectorSourceProjectionV1 } from '@local-creative-os/contracts';
import type { CoreConnectorClient } from '../../backend/connectors.js';

export interface ConnectorSourceControllerStateV1 {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly status: 'idle' | 'loading' | 'loaded' | 'error';
  readonly sources: readonly ConnectorSourceProjectionV1[];
  readonly errorCode?: string;
  readonly revision: number;
}

interface ConnectorSourceEpoch {
  readonly projectId: string;
  readonly generation: number;
  readonly controller: AbortController;
}

export class ConnectorSourceController {
  private state: ConnectorSourceControllerStateV1 | undefined;
  private epoch: ConnectorSourceEpoch | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: CoreConnectorClient) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  open(projectId: string): void {
    this.epoch?.controller.abort();
    const generation = (this.epoch?.generation ?? 0) + 1;
    const controller = new AbortController();
    this.epoch = { projectId, generation, controller };
    this.state = { schemaVersion: 1, projectId, status: 'loading', sources: [], revision: 0 };
    this.notify();
    void this.load(generation);
  }

  read(): ConnectorSourceControllerStateV1 | undefined {
    return this.state;
  }

  dispose(): void {
    this.epoch?.controller.abort();
    this.epoch = undefined;
    this.state = undefined;
    this.notify();
  }

  /** reconcile：重读投影。 */
  async refresh(): Promise<ConnectorSourceControllerStateV1> {
    await this.reload();
    return this.requireState();
  }

  private async load(generation: number): Promise<void> {
    const state = this.requireState();
    const epoch = this.epoch;
    if (!epoch || epoch.generation !== generation) return;
    try {
      const sources = await this.client.listSources(state.projectId, epoch.controller.signal);
      if (!this.epoch || this.epoch.generation !== generation) return;
      this.setState({ status: 'loaded', sources });
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
      const sources = await this.client.listSources(state.projectId, epoch.controller.signal);
      if (!this.epoch || this.epoch.generation !== epoch.generation) return;
      this.setState({ status: 'loaded', sources });
    } catch (error: unknown) {
      if (!this.epoch || this.epoch.generation !== epoch.generation) return;
      this.setState({ errorCode: (error as { code?: string }).code ?? 'read_error' });
    }
  }

  private requireState(): ConnectorSourceControllerStateV1 {
    if (this.state === undefined) throw new Error('Connector source controller is not open.');
    return this.state;
  }

  private setState(patch: Partial<ConnectorSourceControllerStateV1>): void {
    this.state = { ...this.requireState(), ...patch, revision: this.state!.revision + 1 };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
