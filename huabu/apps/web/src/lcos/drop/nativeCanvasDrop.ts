import { canCommitDropRelease } from './dropReleaseConsistency';

import type { CanvasNodeDragPolicy } from '../../lcos-seam/nodeDragPolicy';
import type { CoreEntityRefLike } from '../referenceBridge';
import type { DropPayload, SemanticDropState } from '@local-creative-os/web-gen2';
import type { DropResolution } from './dropTypes';
import type { Node } from '@xyflow/react';

export interface CanvasDropScope { readonly projectId: string; readonly canvasId: string }
export interface CanvasDropNode {
  readonly nodeId: string;
  readonly parentId?: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly absolutePosition: { readonly x: number; readonly y: number };
  readonly reference?: CoreEntityRefLike;
}
/** Gesture-local evidence only. Core owns identity/membership; Huabu owns all actual geometry. */
export interface NativeCanvasDropSource {
  readonly scope: CanvasDropScope;
  readonly nodes: readonly CanvasDropNode[];
  readonly blockedReason?: string;
  readonly landingRevoked?: boolean;
  readonly landing?: {
    readonly frameId: string;
    readonly collectionId: string;
    readonly framePosition: { readonly x: number; readonly y: number };
    readonly nodes: readonly CanvasDropNode[];
  };
}
export interface NativeCanvasDropPort {
  scope(): CanvasDropScope | undefined;
  snapshot(nodes: readonly Node[]): readonly CanvasDropNode[];
  read(): { readonly state: SemanticDropState; readonly resolution: DropResolution | null };
  begin(payload: DropPayload, source: NativeCanvasDropSource): void;
  advance(point: { readonly clientX: number; readonly clientY: number }): void;
  cancelDrop(): void;
  commit(source: NativeCanvasDropSource): boolean;
  /** The native owner rolls back the trial move AND its uncommitted undo snapshot. */
  cancelDrag(preserveNodeIds?: readonly string[]): void;
  clearNativePreview(): void;
  markSources(ids: readonly string[]): void;
  clearSourceMarks(): void;
  /** Never create/open a Frame implicitly. Only an already-visible host receives placement. */
  visibleCollectionFrame(collectionId: string): { readonly frameId: string; readonly position: { readonly x: number; readonly y: number } } | undefined;
  holdLanding(source: NativeCanvasDropSource): void;
  clearLanding(): void;
  reject(message: string): void;
}

function sameScope(a: CanvasDropScope, b: CanvasDropScope | undefined): boolean {
  return a.projectId === b?.projectId && a.canvasId === b.canvasId;
}
function sameIdentity(a: CanvasDropNode, b: CanvasDropNode | undefined): boolean {
  return b !== undefined && a.nodeId === b.nodeId && a.parentId === b.parentId
    && a.reference?.entityType === b.reference?.entityType
    && a.reference?.entityId === b.reference?.entityId
    && a.reference?.artifactViewId === b.reference?.artifactViewId
    && a.reference?.revisionId === b.reference?.revisionId && a.reference?.mode === b.reference?.mode;
}
function mousePoint(event: MouseEvent | TouchEvent) {
  if (!('clientX' in event) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return undefined;
  return { clientX: event.clientX, clientY: event.clientY };
}

/** Lifecycle adapter for the EXISTING React Flow callbacks, not a second pointer/movement engine.
 * Native left movement stays 1:1. Semantic release is decided BEFORE native drag-stop persistence.
 */
export function createNativeCanvasDrop(port: NativeCanvasDropPort, events?: EventTarget): CanvasNodeDragPolicy & { cancel(): void; dispose(): void } {
  let source: NativeCanvasDropSource | undefined;
  let originalNodes: readonly Node[] = [];
  let cancelledIds: ReadonlySet<string> = new Set();
  let cancelledScope: CanvasDropScope | undefined;
  let detachEvents: (() => void) | undefined;

  const stopObserving = () => { detachEvents?.(); detachEvents = undefined; port.clearSourceMarks(); };
  const rollback = () => {
    if (!source) return;
    cancelledIds = new Set(source.nodes.map((node) => node.nodeId));
    cancelledScope = source.scope;
    if (sameScope(source.scope, port.scope())) {
      const current = port.snapshot(originalNodes);
      port.cancelDrag(source.nodes.filter((node) => !sameIdentity(node, current.find((item) => item.nodeId === node.nodeId))).map((node) => node.nodeId));
    }
  };
  const cancel = () => {
    if (!source) return;
    rollback();
    // Never cancel an already-issued canonical request. This controller no longer owns it.
    if (port.read().state.status !== 'committing') port.cancelDrop();
    source = undefined;
    stopObserving();
  };
  const listen = () => {
    if (!events) return;
    const key = (event: Event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || !source) return;
      event.preventDefault(); event.stopPropagation();
      cancel();
    };
    const interrupted = () => cancel();
    const hidden = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') cancel();
    };
    events.addEventListener('keydown', key, true);
    events.addEventListener('blur', interrupted);
    events.addEventListener('pointercancel', interrupted, true);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', hidden);
    detachEvents = () => {
      events.removeEventListener('keydown', key, true);
      events.removeEventListener('blur', interrupted);
      events.removeEventListener('pointercancel', interrupted, true);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', hidden);
    };
  };

  return {
    onStart(event, _primary, draggedNodes) {
      stopObserving(); source = undefined; cancelledIds = new Set(); cancelledScope = undefined;
      // Touch/pen native owners are retained. Actual RF mouse drag has already crossed its threshold.
      if (!mousePoint(event) || ('pointerType' in event && event.pointerType !== 'mouse')) return;
      const scope = port.scope();
      if (!scope || draggedNodes.length === 0) return;
      // A pending drop keeps its request/receipt. A subsequent move revokes its visual landing.
      port.clearLanding();
      if (port.read().state.status === 'committing') return;
      originalNodes = draggedNodes;
      const nodes = port.snapshot(draggedNodes);
      const objects = nodes.flatMap((node) => node.reference ? [node.reference] : []);
      source = { scope, nodes,
        ...(objects.length !== nodes.length || nodes.length !== draggedNodes.length
          ? { blockedReason: '整组包含尚未绑定项目身份的对象；未投递任何一项' } : {}),
      };
      port.begin({ kind: 'objects', objects }, source);
      port.markSources(nodes.map((node) => node.nodeId));
      listen();
    },
    onMove(event, _primary, _nodes) {
      if (!source) return _nodes.some((node) => cancelledIds.has(node.id));
      if (!sameScope(source.scope, port.scope())) { cancel(); return true; }
      const point = mousePoint(event);
      if (!point) return false;
      port.advance(point);
      const state = port.read().state;
      const handled = state.status === 'preview';
      if (handled) port.clearNativePreview();
      return handled;
    },
    onStop(event, _primary, draggedNodes) {
      if (!source) return draggedNodes.some((node) => cancelledIds.has(node.id));
      const active = source;
      if (!sameScope(active.scope, port.scope())) { cancel(); return true; }
      const point = mousePoint(event);
      if (!point) { cancel(); return true; }
      const before = port.read();
      port.advance(point);
      const after = port.read();
      // No semantic target was previewed or released on: keep native Move + native undo/save.
      if (before.state.status !== 'preview' && after.state.status !== 'preview') {
        port.cancelDrop(); source = undefined; stopObserving(); return false;
      }
      const released = port.snapshot(draggedNodes);
      const identityStillMatches = active.nodes.length === released.length
        && active.nodes.every((node) => sameIdentity(node, released.find((item) => item.nodeId === node.nodeId)));
      // First discovering a different semantic operation on mouse-up is NOT user consent.
      if (before.state.status !== 'preview' || !canCommitDropRelease(before, after) || !identityStillMatches) {
        const reason = after.resolution?.status === 'ineligible' ? after.resolution.reason
          : '目标或来源已变化，未投递；源对象已回到原位';
        cancel(); port.reject(reason); return true;
      }
      const resolution = after.resolution;
      if (resolution?.status !== 'ready') { cancel(); return true; }
      const frame = resolution.intent.kind === 'collection-membership'
        ? port.visibleCollectionFrame(resolution.intent.collectionId) : undefined;
      const committedSource: NativeCanvasDropSource = frame && resolution.intent.kind === 'collection-membership'
        ? { ...active, landing: { frameId: frame.frameId, framePosition: frame.position, collectionId: resolution.intent.collectionId, nodes: released } }
        : active;
      // Roll back only the trial geometry. The near-field landing uses the existing native preview map.
      rollback();
      source = undefined;
      stopObserving();
      try {
        port.holdLanding(committedSource);
        if (!port.commit(committedSource)) throw new Error('Drop commit did not start.');
      } catch {
        port.clearLanding(); port.cancelDrop(); port.reject('投递未提交，源对象已保留');
      }
      return true;
    },
    filterChanges(changes) {
      if (!cancelledScope || !sameScope(cancelledScope, port.scope()) || cancelledIds.size === 0) return changes;
      return changes.filter((change) => change.type !== 'position' || change.dragging === undefined || !cancelledIds.has(change.id));
    },
    cancel,
    dispose() { cancel(); stopObserving(); port.clearLanding(); },
  };
}
