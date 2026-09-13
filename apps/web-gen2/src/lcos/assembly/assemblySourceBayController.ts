// Sprint 2B（T4）：Assembly Source Bay 控制器（React-free，epoch guard 同 §4）。
//
// Source Bay 四来源（Project/Capture/Sources/Skills）共用一个 region（regionId=lcos:assembly），
// 切 tab 不复制 source truth；warehouse 是既有 Core read model，无第二 assembly 表。

import type { WarehouseSnapshotV1 } from '@local-creative-os/contracts';
import { CoreAssemblyClient } from '../../backend/assembly.js';

export type AssemblySourceTabV1 = 'project' | 'capture' | 'sources' | 'skills';

export interface AssemblySourceBayStateV1 {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly tab: AssemblySourceTabV1;
  readonly warehouseStatus: 'idle' | 'loading' | 'loaded' | 'error';
  readonly warehouse?: WarehouseSnapshotV1;
  readonly errorCode?: string;
  readonly revision: number;
}

export class AssemblySourceBayController {
  private state: AssemblySourceBayStateV1 | undefined;
  private epoch: { readonly projectId: string; readonly generation: number; readonly controller: AbortController } | undefined;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly client: CoreAssemblyClient) {}

  /** React 消费侧订阅（pull-based）。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  open(projectId: string): void {
    this.epoch?.controller.abort();
    const generation = (this.epoch?.generation ?? 0) + 1;
    const controller = new AbortController();
    this.epoch = { projectId, generation, controller };
    this.state = { schemaVersion: 1, projectId, tab: 'project', warehouseStatus: 'loading', revision: 0 };
    this.notify();
    void this.loadWarehouse(generation);
  }

  selectTab(tab: AssemblySourceTabV1): void {
    if (!this.state) return;
    this.state = { ...this.state, tab };
    this.notify();
  }

  read(): AssemblySourceBayStateV1 | undefined {
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

  private async loadWarehouse(generation: number): Promise<void> {
    const epoch = this.epoch;
    if (!epoch || epoch.generation !== generation) return;
    try {
      const warehouse = await this.client.getWarehouse(epoch.projectId, epoch.controller.signal);
      if (!this.epoch || this.epoch.generation !== generation || this.epoch.projectId !== epoch.projectId) return;
      this.state = { ...this.state!, warehouseStatus: 'loaded', warehouse, revision: this.state!.revision + 1 };
      this.notify();
    } catch (error: unknown) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      if (aborted) return;
      if (!this.epoch || this.epoch.generation !== generation) return;
      this.state = {
        ...this.state!,
        warehouseStatus: 'error',
        errorCode: (error as { code?: string }).code ?? 'read_error',
        revision: this.state!.revision + 1,
      };
      this.notify();
    }
  }
}
