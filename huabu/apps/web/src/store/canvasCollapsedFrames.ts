interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void }
const key = (canvasId: string) => `huabu:canvas:${canvasId}:collapsed-frames`;
function browserStorage(): StoragePort | undefined { try { return typeof localStorage === 'undefined' ? undefined : localStorage; } catch { return undefined; } }
export function readCollapsedFrames(canvasId: string, frames: readonly {id:string; type?:string}[], storage: StoragePort | undefined = browserStorage()): Set<string> {
  if (!canvasId || !storage) return new Set();
  try {
    const value: unknown = JSON.parse(storage.getItem(key(canvasId)) ?? '[]');
    if (!Array.isArray(value)) return new Set();
    const live = new Set(frames.filter((node) => node.type === 'frame' || node.type === 'group').map((node) => node.id));
    return new Set(value.filter((id): id is string => typeof id === 'string' && live.has(id)));
  } catch { return new Set(); }
}
export function writeCollapsedFrames(canvasId: string | null | undefined, ids: ReadonlySet<string>, storage: StoragePort | undefined = browserStorage()): void {
  if (!canvasId || !storage) return;
  try { storage.setItem(key(canvasId), JSON.stringify([...ids])); } catch { /* disabled storage does not block canvas operations */ }
}
