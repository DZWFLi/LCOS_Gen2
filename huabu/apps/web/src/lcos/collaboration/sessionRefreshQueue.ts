/** Ephemeral scheduling for the existing projection store, not another cache or event bus.
 * Invalidation during a read schedules one follow-up read. Reads never race each other; released scopes never publish.
 */
export class SessionRefreshQueue {
  private readonly pending = new Map<string, { dirty: boolean; controller: AbortController; promise: Promise<void> }>();

  refresh<T>(key: string, read: (signal: AbortSignal) => Promise<T>, publish: (value: T) => void, failed: (error: unknown) => void): Promise<void> {
    const current = this.pending.get(key);
    if (current) { current.dirty = true; return current.promise; }
    const job = { dirty: false, controller: new AbortController(), promise: Promise.resolve() };
    this.pending.set(key, job);
    job.promise = (async () => {
      do {
        job.dirty = false;
        try {
          const value = await read(job.controller.signal);
          // Publish this genuine serial snapshot even during a token-event stream;
          // otherwise continuous invalidations could starve all progress updates.
          if (this.pending.get(key) === job && !job.controller.signal.aborted) publish(value);
        } catch (error) {
          if (this.pending.get(key) === job && !job.controller.signal.aborted && !job.dirty) failed(error);
        }
      } while (this.pending.get(key) === job && !job.controller.signal.aborted && job.dirty);
    })().finally(() => { if (this.pending.get(key) === job) this.pending.delete(key); });
    return job.promise;
  }

  release(key: string): void {
    const job = this.pending.get(key);
    this.pending.delete(key);
    job?.controller.abort();
  }
}
