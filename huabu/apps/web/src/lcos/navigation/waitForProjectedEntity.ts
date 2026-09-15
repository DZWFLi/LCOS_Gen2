import useCanvasStore from '@/store/canvasStore';

import { useLcosReferenceStore } from '../lcosReferenceState';

export interface WaitForProjectedEntityOptions {
  readonly projectId: string;
  readonly canvasId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

function findProjectedNode(
  options: WaitForProjectedEntityOptions,
): string | undefined {
  const referenceState = useLcosReferenceStore.getState();
  const canvasState = useCanvasStore.getState();

  if (
    referenceState.projectId !== options.projectId ||
    canvasState.canvasId !== options.canvasId
  ) {
    return undefined;
  }

  const currentNodeIds = new Set(canvasState.nodes.map((node) => node.id));
  for (const [nodeId, ref] of referenceState.nodeEntityRefs) {
    if (
      currentNodeIds.has(nodeId) &&
      ref.entityType === options.entityType &&
      ref.entityId === options.entityId
    ) {
      return nodeId;
    }
  }
  return undefined;
}

/**
 * Wait for an already projected Core entity to arrive in the requested
 * project/canvas. The reference binding and canvas nodes remain the only
 * sources of truth; this helper only observes their existing stores.
 */
export function waitForProjectedEntity(
  options: WaitForProjectedEntityOptions,
): Promise<string | undefined> {
  const { signal } = options;
  if (signal?.aborted) return Promise.resolve(undefined);

  const timeoutMs = options.timeoutMs ?? 5000;

  return new Promise<string | undefined>((resolve) => {
    let settled = false;

    const cleanup = (): void => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      unsubscribeReference?.();
      unsubscribeCanvas?.();
      signal?.removeEventListener('abort', onAbort);
    };

    const finish = (nodeId: string | undefined): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(nodeId);
    };

    const onAbort = (): void => finish(undefined);
    const check = (): void => {
      if (signal?.aborted) {
        finish(undefined);
        return;
      }
      const nodeId = findProjectedNode(options);
      if (nodeId !== undefined) finish(nodeId);
      else {
        const current = useCanvasStore.getState();
        const project = useLcosReferenceStore.getState();
        if (
          current.canvasId !== options.canvasId ||
          project.projectId !== options.projectId
        ) {
          finish(undefined);
        }
      }
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    const timeoutId = setTimeout(() => finish(undefined), Math.max(0, timeoutMs));
    const unsubscribeReference = useLcosReferenceStore.subscribe(check);
    const unsubscribeCanvas = useCanvasStore.subscribe(check);
    check();
  });
}
