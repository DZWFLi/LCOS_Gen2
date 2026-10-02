import { getAbsolutePosition } from '@huabu/shared/canvas-engine';
import { toast } from '@/components/Common/Toast';
import useCanvasStore from '@/store/canvasStore';
import { useGesturePreviewStore } from '@/store/gesturePreviewStore';
import { useLcosDropStore } from '../lcosDropState';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { advanceDropAtScreenPoint } from '../lcosRecognizers';
import { useLcosShellStore } from '../shell/lcosShellStore';
import { createNativeCanvasDrop, type NativeCanvasDropSource } from './nativeCanvasDrop';
import { sameCanvasDropNode, snapshotCanvasDropNodes } from './nativeCanvasDropGeometry';
import { createCollectionDragCompanions } from '../nodes/collectionDragCompanions';

/** Adapt established owners to native RF drag callbacks; no new pointer engine. */
export function createNativeCanvasDropHost(projectId: string) {
  const companions = createCollectionDragCompanions(() => useCanvasStore.getState().nodes);
  const scope = () => {
    const canvasId = useCanvasStore.getState().canvasId;
    return canvasId && useLcosShellStore.getState().projectId === projectId ? { projectId, canvasId } : undefined;
  };
  const refs = () => {
    const state = useLcosReferenceStore.getState();
    return state.projectId === projectId && state.bindingCanvasId === useCanvasStore.getState().canvasId
      ? state.nodeEntityRefs : new Map();
  };
  const snapshot = (ids: readonly string[]) => snapshotCanvasDropNodes(ids, useCanvasStore.getState().nodes, refs());
  let marked: Element[] = [];
  let pendingElements: Element[] = [];
  let held: NativeCanvasDropSource | undefined;
  let heldMap: ReturnType<typeof useGesturePreviewStore.getState>['nodeGeometryPreviews'] = null;
  const clearMarks = () => { for (const node of marked) node.removeAttribute('data-lcos-native-drop-source'); marked = []; };
  const elements = (ids: ReadonlySet<string>) => [...(useCanvasStore.getState().canvasWrapper?.querySelectorAll('.react-flow__node') ?? [])]
    .filter((element) => ids.has(element.getAttribute('data-id') ?? ''));
  const clearHeld = () => {
    held = undefined;
    // A later native gesture owns its own map. Never erase that newer preview.
    if (heldMap !== null && useGesturePreviewStore.getState().nodeGeometryPreviews === heldMap) {
      useGesturePreviewStore.getState().clearNodeGeometryPreviews();
    }
    heldMap = null;
    for (const element of pendingElements) element.removeAttribute('data-lcos-native-drop-pending');
    pendingElements = [];
  };
  const controller = createNativeCanvasDrop({
    scope,
    snapshot: (nodes) => snapshot(nodes.map((node) => node.id)),
    read: () => useLcosDropStore.getState(),
    begin: (payload, source) => useLcosDropStore.getState().beginNative(payload, source),
    advance: (point) => {
      const state = useCanvasStore.getState();
      if (state.canvasWrapper && state.rfInstance) advanceDropAtScreenPoint(point, { wrapper: state.canvasWrapper, instance: state.rfInstance });
      else useLcosDropStore.getState().cancel();
    },
    cancelDrop: () => {
      if (useLcosDropStore.getState().state.status !== 'committing') useLcosDropStore.getState().cancel();
    },
    commit: (source) => {
      const store = useLcosDropStore.getState();
      if (store.state.status !== 'preview' || store.resolution?.status !== 'ready') return false;
      const transactionId = crypto.randomUUID();
      store.commitNative(source, transactionId);
      const committed = useLcosDropStore.getState().state;
      return committed.status === 'committing' && committed.transactionId === transactionId;
    },
    cancelDrag: (preserveNodeIds) => { useCanvasStore.getState().cancelActiveNodeDrag([...(preserveNodeIds ?? []), ...companions.externallyChanged()]); companions.clear(); },
    clearNativePreview: () => useCanvasStore.getState().clearNodeDragPreview(),
    markSources: (ids) => { clearMarks(); marked = elements(new Set(ids)); for (const node of marked) node.setAttribute('data-lcos-native-drop-source', ''); },
    clearSourceMarks: clearMarks,
    visibleCollectionFrame: (collectionId) => {
      const state = useCanvasStore.getState();
      const frame = state.nodes.find((node) => node.type === 'frame' && node.data.lcosCollectionId === collectionId);
      if (!frame || frame.hidden || frame.data.locked || state.collapsedFrameIds.has(frame.id)) return undefined;
      const position = getAbsolutePosition(state.nodes, frame.id);
      return position ? { frameId: frame.id, position } : undefined;
    },
    holdLanding: (source) => {
      clearHeld();
      if (!source.landing) return;
      held = source;
      const state = useCanvasStore.getState();
      const landingNodes = source.landing.nodes.flatMap((released) => {
        const node = state.nodes.find((candidate) => candidate.id === released.nodeId);
        return node ? [{ ...node, position: { ...released.position } }] : [];
      });
      useGesturePreviewStore.getState().setNodeGeometryPreviews(landingNodes);
      heldMap = useGesturePreviewStore.getState().nodeGeometryPreviews;
      pendingElements = elements(new Set(landingNodes.map((node) => node.id)));
      for (const element of pendingElements) element.setAttribute('data-lcos-native-drop-pending', '');
    },
    clearLanding: () => { clearHeld(); useLcosDropStore.getState().revokeNativeLanding(); },
    reject: (message) => toast(message, { tone: 'danger' }),
  }, typeof window === 'undefined' ? undefined : window);

  const stopDrop = useLcosDropStore.subscribe((state) => {
    if (held && ((state.state.status !== 'committing' && state.state.status !== 'preview') || state.nativeSource !== held)) clearHeld();
  });
  const stopCanvas = useCanvasStore.subscribe((state, previous) => {
    // switchCanvas announces loading before draining saves. Stop the gesture
    // there, not only after a new canvasId has already replaced its source.
    if (state.isLoading && !previous.isLoading) controller.cancel();
    if (state.canvasId !== previous.canvasId) {
      controller.cancel(); clearHeld(); useLcosDropStore.getState().revokeNativeLanding(); return;
    }
    if (!held || state.nodes === previous.nodes) return;
    const current = snapshot(held.nodes.map((node) => node.nodeId));
    if (!held.nodes.every((node) => sameCanvasDropNode(node, current.find((candidate) => candidate.nodeId === node.nodeId)))) {
      clearHeld(); useLcosDropStore.getState().revokeNativeLanding();
    }
  });
  return { ...controller,
    companionNodes: companions.companionNodes,
    onStart: (...args: Parameters<typeof controller.onStart>) => { companions.onStart(args[2]); controller.onStart(...args); },
    filterChanges: (changes: Parameters<typeof controller.filterChanges>[0]) => companions.filterChanges(controller.filterChanges(changes)),
    dispose: () => { stopDrop(); stopCanvas(); controller.dispose(); companions.clear(); clearMarks(); clearHeld(); } };

}
