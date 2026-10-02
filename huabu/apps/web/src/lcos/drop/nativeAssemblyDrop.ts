import { canCommitDropRelease } from './dropReleaseConsistency';

import type { SemanticDropState } from '@local-creative-os/web-gen2';
import type { DropResolution } from './dropTypes';

export const ASSEMBLY_DRAG_MIME = 'application/x-lcos-assembly';

export interface NativeAssemblyDropPort {
  readonly read: () => { readonly state: SemanticDropState; readonly resolution: DropResolution | null };
  /** Re-hit-test the RELEASE point through the same live resolver used for the preview. */
  readonly advance: (point: { clientX: number; clientY: number }) => boolean;
  readonly commit: () => void;
  readonly cancel: () => void;
}

function pending(state: SemanticDropState): boolean {
  return state.status === 'tracking' || state.status === 'dwell' || state.status === 'preview';
}
function assembly(state: SemanticDropState): boolean {
  return 'payload' in state && state.payload.kind === 'assembly';
}

/** Native drag transport only. The existing Drop store/resolver/router still owns the gesture. */
export function bindNativeAssemblyDropEvents(host: Window, port: NativeAssemblyDropPort): () => void {
  const belongsToAssembly = (event: DragEvent): boolean => assembly(port.read().state)
    || Array.from(event.dataTransfer?.types ?? []).includes(ASSEMBLY_DRAG_MIME);
  const consume = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  const cancelPending = (): void => {
    const { state } = port.read();
    if (assembly(state) && pending(state)) port.cancel();
  };
  const over = (event: DragEvent): void => {
    if (!belongsToAssembly(event)) return;
    consume(event);
    const { state } = port.read();
    const advanced = assembly(state) && pending(state) && port.advance(event);
    const current = port.read();
    if (event.dataTransfer) event.dataTransfer.dropEffect = advanced
      && current.state.status === 'preview' && current.resolution?.status === 'ready' ? 'copy' : 'none';
  };
  const drop = (event: DragEvent): void => {
    if (!belongsToAssembly(event)) return;
    // Consume before Core work: stock Canvas import must never reinterpret this
    // payload, even if the target disappeared, rejected it, or the write fails.
    consume(event);
    const before = port.read();
    const { state } = before;
    if (!assembly(state) || !pending(state)) return;
    if (!port.advance(event)) { cancelPending(); return; }
    const current = port.read();
    if (canCommitDropRelease(before, current)) port.commit();
    else cancelPending();
  };
  const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') cancelPending(); };
  host.addEventListener('dragover', over, { capture: true });
  host.addEventListener('drop', drop, { capture: true });
  host.addEventListener('dragend', cancelPending, { capture: true });
  host.addEventListener('keydown', key, { capture: true });
  host.addEventListener('blur', cancelPending);
  return () => {
    host.removeEventListener('dragover', over, { capture: true });
    host.removeEventListener('drop', drop, { capture: true });
    host.removeEventListener('dragend', cancelPending, { capture: true });
    host.removeEventListener('keydown', key, { capture: true });
    host.removeEventListener('blur', cancelPending);
    cancelPending();
  };
}
