// Host lifecycle reconciliation — wiring the "callable runner" into the real host
// lifecycle (project open, mutation success, connection restored), with a periodic
// fallback as the LAST resort (NOT the primary). Cooldown prevents duplicate runs;
// mutation triggers are debounced so a burst of mutations coalesces into one sweep.

import type { ReconciliationRunner } from '../spatial/reconciliationRunner.js';

export type ReconcileTrigger = 'project-open' | 'mutation' | 'reconnect' | 'periodic';

export interface HostLifecycleReconcilerOptions {
  /** Minimum gap (ms) between actual runs; bursts/periodic are skipped inside this window. */
  cooldownMs?: number;
  /** Debounce (ms) after a mutation before sweeping. */
  debounceMs?: number;
  /** Periodic fallback interval (ms). Disabled by default. */
  periodicMs?: number;
}

export interface RunnerLike {
  runOnce(): Promise<unknown>;
}

export type ReconcileObserver = (trigger: ReconcileTrigger) => void;

export class HostLifecycleReconciler {
  private readonly cooldownMs: number;
  private readonly debounceMs: number;
  private readonly runner: RunnerLike;
  private lastRunAt = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private readonly observer: ReconcileObserver | undefined;

  constructor(runner: RunnerLike, private readonly projectId: string, options: HostLifecycleReconcilerOptions = {}, observer?: ReconcileObserver) {
    this.runner = runner;
    this.cooldownMs = options.cooldownMs ?? 500;
    this.debounceMs = options.debounceMs ?? 300;
    this.observer = observer;
  }

  /** True if an actual sweep ran; false if throttled (cooldown/in-flight). */
  async runNow(trigger: ReconcileTrigger): Promise<boolean> {
    const now = Date.now();
    if (this.inFlight) return false;
    if (now - this.lastRunAt < this.cooldownMs) return false;
    this.inFlight = true;
    this.lastRunAt = now;
    this.observer?.(trigger);
    try {
      await this.runner.runOnce();
      return true;
    } finally {
      this.inFlight = false;
    }
  }

  /** Project opened: immediate reconcile (respects cooldown). */
  onProjectOpen(): void {
    void this.runNow('project-open');
  }

  /** A relevant mutation succeeded: debounced reconcile (coalesces bursts). */
  onMutationSuccess(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runNow('mutation');
    }, this.debounceMs);
  }

  /** Connection restored: rescue reconcile (immediate, respects cooldown). */
  onConnectionRestored(): void {
    void this.runNow('reconnect');
  }

  /** Periodic fallback — LAST resort, not primary. Starts a cooldown-respecting interval. */
  startPeriodic(intervalMs?: number): void {
    const period = intervalMs ?? 60_000;
    this.stopPeriodic();
    this.periodicTimer = setInterval(() => void this.runNow('periodic'), period);
  }

  stopPeriodic(): void {
    if (this.periodicTimer !== null) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
  }

  dispose(): void {
    this.stopPeriodic();
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
