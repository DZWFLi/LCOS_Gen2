import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { createStructureScheduler } from './structureScheduler';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it('retains failed autosave work after its timer ended and retries on flush', async () => {
  const save = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const scheduler = createStructureScheduler({ getSaveCanvas: () => save, delayMs: 10 });
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  scheduler.schedule();
  await vi.advanceTimersByTimeAsync(10);
  expect(save).toHaveBeenCalledTimes(1);
  await scheduler.flushAsync();
  expect(save).toHaveBeenCalledTimes(2);
  expect(scheduler.cancelPending()).toBe(false);
  log.mockRestore();
});

it('rejects a failed explicit flush and retains it for the next retry', async () => {
  const save = vi.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(true);
  const scheduler = createStructureScheduler({ getSaveCanvas: () => save, delayMs: 10 });
  scheduler.schedule();
  await expect(scheduler.flushAsync()).rejects.toThrow('offline');
  expect(scheduler.cancelPending()).toBe(true);
  await scheduler.flushAsync();
  expect(save).toHaveBeenCalledTimes(2);
});

it('awaits the in-flight save then persists edits made while it was running', async () => {
  let finish!: (saved: boolean) => void;
  const save = vi.fn<() => Promise<boolean>>()
    .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(true);
  const scheduler = createStructureScheduler({ getSaveCanvas: () => save, delayMs: 10 });
  scheduler.schedule();
  await vi.advanceTimersByTimeAsync(10);
  scheduler.schedule();
  let drained = false;
  const pending = scheduler.flushAsync().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);
  expect(save).toHaveBeenCalledTimes(1);
  finish(true);
  await pending;
  expect(save).toHaveBeenCalledTimes(2);
  expect(drained).toBe(true);
});

it('does not write a clean canvas merely because navigation drains it', async () => {
  const save = vi.fn<() => Promise<boolean>>();
  const scheduler = createStructureScheduler({ getSaveCanvas: () => save, delayMs: 10 });
  await scheduler.flushAsync();
  expect(save).not.toHaveBeenCalled();
});
