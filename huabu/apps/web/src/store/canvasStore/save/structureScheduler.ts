// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

/**
 * Debounced scheduler for the canvas structure save
 * (`PUT /api/canvas/:id`). Holds a single module-scoped timer and
 * exposes three operations:
 *
 *   • {@link StructureScheduler.schedule} — middleware path
 *     (debounce window resets on every store mutation that the dirty
 *     detector flagged as structural).
 *   • {@link StructureScheduler.flushAsync} — canvas-switch path
 *     (`loadCanvas` awaits this before clearing state so trailing
 *     edits land before the new canvas overwrites them).
 *   • {@link StructureScheduler.cancelPending} — unload path
 *     (`beforeunload` listener uses this to decide whether to fire a
 *     `keepalive` PUT; the scheduler itself can't await on unload).
 *
 * The actual save action lives in the store slice
 * (`saveCanvas` on `useCanvasStore`) because it touches OCC state
 * (`isSaving`, `pendingSave`, `versionConflict`, `version`). This
 * module only owns the *timer*, not the work.
 */

import { CanvasConflictError } from '@/api/canvas';

/**
 * Public shape returned by {@link createStructureScheduler}.
 */
export type StructureScheduler = {
  /**
   * Start (or reset) the debounce timer. When it fires, calls
   * `getSaveCanvas()()` and swallows `CanvasConflictError` (the
   * sticky `versionConflict` flag in the store already gates further
   * saves and surfaces the toast).
   */
  schedule(): void;

  /**
   * Await both in-flight and trailing edits. Failed writes remain pending
   * for a later retry; a caller must not leave the canvas on rejection.
   */
  flushAsync(): Promise<void>;

  /**
   * Cancel any pending save timer. Returns `true` when a timer was
   * actually cancelled, `false` when nothing was pending. The unload
   * listener uses the return value to decide whether the latest
   * structure mutation needs a `keepalive` PUT — if no timer was
   * pending, the server already has the latest state.
   */
  cancelPending(): boolean;
};

/**
 * Build a {@link StructureScheduler}. Inject the save action via
 * `getSaveCanvas` (a lazy getter, not a bound reference) so the
 * scheduler always picks up the latest slice closure even if the
 * store is recreated (e.g. HMR).
 */
export function createStructureScheduler(opts: {
  getSaveCanvas: () => () => Promise<boolean>;
  delayMs: number;
}): StructureScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let revision = 0;
  let savedRevision = 0;
  let inflight: Promise<void> | null = null;

  const logIfNotConflict = (label: string, err: unknown): void => {
    if (!(err instanceof CanvasConflictError)) {
      console.error(`${label}:`, err);
    }
  };

  async function savePending(): Promise<void> {
    if (inflight) await inflight;
    if (savedRevision >= revision) return;
    const savingRevision = revision;
    const save = opts.getSaveCanvas()().then((saved) => {
      if (!saved) throw new Error('当前现场的修改尚未保存成功，请重试');
      savedRevision = Math.max(savedRevision, savingRevision);
    });
    inflight = save;
    try {
      await save;
    } finally {
      if (inflight === save) inflight = null;
    }
  }

  return {
    schedule(): void {
      revision += 1;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        savePending()
          .catch((err) => logIfNotConflict('Autosave failed', err));
      }, opts.delayMs);
    },

    async flushAsync(): Promise<void> {
      if (timer) clearTimeout(timer);
      timer = null;
      await savePending();
    },

    cancelPending(): boolean {
      if (timer) clearTimeout(timer);
      timer = null;
      return savedRevision < revision;
    },
  };
}
