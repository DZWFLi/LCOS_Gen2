// LCOS pointer recognizers (Phase A03 + A06) — typed intent recognizers
// injected into Huabu's canvas pointer router via hostExtension.recognizers.
//
// Design rules (Phase A task card):
//   - Recognizers produce INTENT, never mutate Core/canvas truth directly.
//   - Ctrl/Cmd+click = this-run Reference pick; Shift+click stays Huabu's
//     additive selection (Shift ALWAYS wins — pointerModifiersOf /
//     isReferencePick enforce the frozen Gen1 grammar).
//   - Mouse only: touch/pen gestures keep their Huabu owners.
//   - Reference picking only applies to nodes PROJECTED by LCOS (the
//     nodeEntityRefs map); native Huabu nodes are untouched.
//
// A06: the semantic-drop recognizer is a PURE OBSERVER ("observe" only, never
// claims a pointer). It never invents a payload — a drop only begins when a
// data source calls `acquireDrop(payload)`; the recognizer then advances the
// machine from pointer position and cancels on release.

import { isReferencePick, pointerModifiersOf } from '@local-creative-os/web-gen2';


import { getDragActivationDistance } from '@/handler/canvasGestureSession';
import { nodeIdAtScreenPoint } from '@/handler/canvasNodeAtPoint';

import { resolveDropPointerTarget } from './drop/dropPointerResolution';
import { canCommitDropRelease } from './drop/dropReleaseConsistency';
import { useLcosDropStore } from './lcosDropState';
import { useLcosReferenceStore } from './lcosReferenceState';
import { beginCarryContextMenu, finishCarryContextMenu } from './referenceClickSuppressor';
import { createRightCarryRecognizer } from './drop/rightCarry';
import { sameCanvasDropNode, snapshotCanvasDropNodes } from './drop/nativeCanvasDropGeometry';
import useCanvasStore from '@/store/canvasStore';
import { toast } from '@/components/Common/Toast';
import { draftReferenceUnavailableReason, snapshotDraftReference } from './composer/referenceSnapshot';
import { useLcosShellStore } from './shell/lcosShellStore';
import { markReferencePickCompleted } from './referenceClickSuppressor';
import { composerInputKey } from './composer/composerInputJourney';
import type { LcosNodeEntityRef } from './lcosReferenceState';

import type { CanvasPointerRouterContext } from '@/handler/canvasPointerRouterContext';
import type { PointerRecognizer } from '@/handler/pointerRouter';
import type { DropPayload } from '@local-creative-os/web-gen2';

/**
 * Ctrl/Cmd+click on an LCOS-projected node toggles it in the ordered draft
 * references and claims the pointer so React Flow never sees the click —
 * selection must NOT change (Selection ≠ Reference, the frozen A04 rule).
 *
 * The toggle fires on pointerUP only when the gesture stayed a click
 * (no drag beyond a small slop): a Ctrl+drag remains free for future
 * gestures without a phantom reference toggle.
 */
export function createReferencePickRecognizer(): PointerRecognizer<
  PointerEvent,
  CanvasPointerRouterContext
> {
  let activePointerId: number | null = null;
  let startClient = { x: 0, y: 0 };
  let pendingNodeId: string | null = null;
  let claimedNodeId: string | null = null;
  let capturedRef: LcosNodeEntityRef | undefined;
  let origin: { projectId: string | null; inputKey: string | undefined; canvasId: string | null } | null = null;

  const SLOP_PX = 4;

  return {
    id: 'lcos/reference-pick',
    canClaim: (event, ctx) =>
      activePointerId === null &&
      !ctx.interactivityLocked &&
      event.pointerType === 'mouse' &&
      event.button === 0 &&
      event.isPrimary &&
      useLcosShellStore.getState().composerOpen &&
      useLcosShellStore.getState().composerTarget !== null &&
      (isReferencePick(pointerModifiersOf(event))
        || (!event.shiftKey && !event.altKey && useLcosReferenceStore.getState().referencePickOwner !== null)),
    onDown: (event) => {
      const nodeId = nodeIdAtScreenPoint(event.clientX, event.clientY);
      // No node under the pointer → nothing to reference.
      if (!nodeId) return 'pass';
      const target = event.target as Element | null;
      if (target?.closest?.('button, input, textarea, select, a[href], [contenteditable="true"], [data-lcos-relation-handle]')) return 'pass';
      const store = useLcosReferenceStore.getState();
      const shell = useLcosShellStore.getState();
      // An unbound object still consumes the pick gesture. It must never fall
      // through into ordinary selection, and no invented Core id is allowed.
      const ref = store.nodeEntityRefs.get(nodeId);
      capturedRef = ref ? snapshotDraftReference(ref) : undefined;
      claimedNodeId = nodeId;
      origin = { projectId: store.projectId, inputKey: composerInputKey(shell.composerTarget),
        canvasId: useCanvasStore.getState().canvasId };
      activePointerId = event.pointerId;
      startClient = { x: event.clientX, y: event.clientY };
      pendingNodeId = nodeId;
      // Suppress the default click chain early: React Flow must not turn
      // this into a selection change while we decide on pointerup.
      event.preventDefault();
      event.stopPropagation();
      return 'claim';
    },
    onMove: (event) => {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      event.stopPropagation();
      // Drag beyond slop cancels the pick (keeps Ctrl+drag free).
      const moved = Math.hypot(
        event.clientX - startClient.x,
        event.clientY - startClient.y,
      );
      if (moved > SLOP_PX) {
        pendingNodeId = null;
      }
    },
    onUp: (event) => {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (pendingNodeId !== null && origin) {
        const references = useLcosReferenceStore.getState();
        const shell = useLcosShellStore.getState();
        const live = references.nodeEntityRefs.get(pendingNodeId);
        const sameInput = shell.composerOpen && shell.projectId === origin.projectId
          && references.projectId === origin.projectId && composerInputKey(shell.composerTarget) === origin.inputKey
          && useCanvasStore.getState().canvasId === origin.canvasId;
        if (!sameInput) {
          toast('输入或现场已改变，本次点取已取消。', { tone: 'danger' });
        } else if (!capturedRef || !live || live.entityType !== capturedRef.entityType || live.entityId !== capturedRef.entityId) {
          toast('这项内容尚未保存为可引用材料；已保留当前选择和草稿。', { tone: 'danger' });
        } else if (!references.toggleEntityReference(capturedRef, shell.composerTarget?.intent)) {
          toast(draftReferenceUnavailableReason(capturedRef, shell.composerTarget?.intent) ?? '引用尚未就绪。', { tone: 'danger' });
        }
      }
      if (claimedNodeId) markReferencePickCompleted(claimedNodeId);
      activePointerId = null;
      pendingNodeId = null;
      claimedNodeId = null;
      origin = null;
      capturedRef = undefined;
    },
    onCancel: (event) => {
      if (event.pointerId !== activePointerId) return;
      if (claimedNodeId) markReferencePickCompleted(claimedNodeId);
      activePointerId = null;
      pendingNodeId = null;
      claimedNodeId = null;
      origin = null;
      capturedRef = undefined;
    },
  };
}

/**
 * Acquire a payload and begin a spatial drop (Phase A06 acquisition entry).
 * Called by data sources — native file drop, object drag, assembly pick —
 * once an actual payload is in hand; the recognizer never invents one.
 */
export function acquireDrop(payload: DropPayload): void {
  useLcosDropStore.getState().begin(payload);
}

/**
 * Advance an in-flight drop from a screen-space point. Pointer-router and
 * native HTML5 dragover events share this exact path, so a source cannot get
 * one resolver for pointer dragging and another for browser dragging.
 */
export function advanceDropAtScreenPoint(
  point: { readonly clientX: number; readonly clientY: number },
  ctx: Pick<CanvasPointerRouterContext, 'wrapper' | 'instance'>,
  now = Date.now(),
): void {
  const store = useLcosDropStore.getState();
  const state = store.state;
  if (state.status === 'idle' || state.status === 'committing' || state.status === 'failed') return;
  const rect = ctx.wrapper.getBoundingClientRect();
  store.setBounds({
    left: 0,
    right: rect.width,
    top: 0,
    bottom: rect.height,
  });
  const { target, resolution } = resolveDropPointerTarget(state.payload,
    store.targetAt({ x: point.clientX, y: point.clientY }), {
      native: store.nativeSource !== null, rightCarry: store.carrySourceNodeId !== null,
      ...(store.nativeSource?.blockedReason === undefined ? {} : { blockedReason: store.nativeSource.blockedReason }),
    });
  const destination = target === undefined ? undefined : {
    targetId: target.targetId,
    previewPoint: { x: point.clientX - rect.left, y: point.clientY - rect.top },
  };
  const placementPoint = target?.kind === 'canvas'
    ? ctx.instance.screenToFlowPosition({
        x: point.clientX,
        y: point.clientY,
      })
    : undefined;
  store.advance(
    { x: point.clientX - rect.left, y: point.clientY - rect.top },
    target !== undefined,
    now,
    destination,
    resolution,
    placementPoint,
  );
}

/**
 * Semantic-drop recognizer: positional driver for an in-flight drop. Pure
 * observer — it never claims a pointer (so it never fights node drag /
 * selection) and only advances the machine while a drop with a payload is
 * active in the store. On pointer release it cancels any uncommitted
 * tracking/dwell/preview.
 */
export function createDropRecognizer(): PointerRecognizer<
  PointerEvent,
  CanvasPointerRouterContext
> {
  let activePointerId: number | null = null;
  const isNativeAssembly = (): boolean => {
    const state = useLcosDropStore.getState().state;
    return useLcosDropStore.getState().carrySourceNodeId !== null || useLcosDropStore.getState().nativeSource !== null || ('payload' in state && state.payload.kind === 'assembly');
  };

  return {
    id: 'lcos/drop',
    canClaim: () => false,
    onDown: () => 'pass' as const,
    observe: {
      onDown: (event) => {
        if (isNativeAssembly()) { activePointerId = null; return; }
        if (event.pointerType !== 'mouse') return;
        if (useLcosDropStore.getState().state.status === 'idle') return;
        activePointerId = event.pointerId;
      },
      onMove: (event, ctx) => {
        if (isNativeAssembly()) { activePointerId = null; return; }
        // Native drag sources can acquire the payload just after pointerdown;
        // accept the first subsequent move for the in-flight gesture instead
        // of silently missing the whole drop.
        if (activePointerId === null) {
          if (useLcosDropStore.getState().state.status === 'idle') return;
          activePointerId = event.pointerId;
        }
        if (event.pointerId !== activePointerId) return;
        advanceDropAtScreenPoint(event, ctx);
      },
      onUp: (event, ctx) => {
        if (isNativeAssembly()) { activePointerId = null; return; }
        if (event.pointerId !== activePointerId) return;
        const before = useLcosDropStore.getState();
        advanceDropAtScreenPoint(event, ctx);
        activePointerId = null;
        const store = useLcosDropStore.getState();
        const status = store.state.status;
        if (canCommitDropRelease(before, store)) {
          const id = globalThis.crypto?.randomUUID?.() ?? `drop-${Date.now()}`;
          store.commitAt(id);
          return;
        }
        if (status === 'tracking' || status === 'dwell' || status === 'preview') {
          store.cancel();
        }
      },
      onCancel: (event) => {
        // Native HTML5 drag emits pointercancel when the browser takes over.
        // Its drop/dragend transport, not this observer, ends that gesture.
        if (isNativeAssembly()) { activePointerId = null; return; }
        if (event.pointerId !== activePointerId) return;
        activePointerId = null;
        const status = useLcosDropStore.getState().state.status;
        if (status !== 'idle' && status !== 'committing' && status !== 'failed') {
          useLcosDropStore.getState().cancel();
        }
      },
    },
  };
}

/**
 * All LCOS recognizers for the canvas host extension, in claim order.
 * Each entry is a fresh instance — the array itself is memoized once per
 * host by the caller (useLcosCanvasProps) so the router never re-installs
 * mid-gesture.
 */
export function createLcosRecognizers(): readonly PointerRecognizer<
  PointerEvent,
  CanvasPointerRouterContext
>[] {
  return [createReferencePickRecognizer(), createNodeCarryRecognizer(), createDropRecognizer()];
}

/** T3 Right Carry shares the native pointer router and the existing drop owner. */
export function createNodeCarryRecognizer(): PointerRecognizer<PointerEvent, CanvasPointerRouterContext> {
  const sourceScope = () => {
    const canvas = useCanvasStore.getState();
    const reference = useLcosReferenceStore.getState();
    const projectId = useLcosShellStore.getState().projectId;
    return projectId && canvas.canvasId && !canvas.isLoading && reference.projectId === projectId
      && reference.bindingCanvasId === canvas.canvasId ? { projectId, canvasId: canvas.canvasId } : undefined;
  };
  const snapshot = (ids: readonly string[]) => snapshotCanvasDropNodes(ids,
    useCanvasStore.getState().nodes, useLcosReferenceStore.getState().nodeEntityRefs);
  return createRightCarryRecognizer({
    acquire: (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(
        'input,textarea,select,button,a[href],[contenteditable="true"],.react-flow__handle,[data-resize-handle]',
      )) return undefined;
      const nodeId = nodeIdAtScreenPoint(event.clientX, event.clientY);
      const scope = sourceScope();
      const canvas = useCanvasStore.getState();
      const primary = canvas.nodes.find((node) => node.id === nodeId);
      const element = target.closest('.react-flow__node');
      if (!scope || !primary || !element || !useLcosReferenceStore.getState().nodeEntityRefs.has(primary.id)) return undefined;
      const ids = primary.selected ? canvas.nodes.filter((node) => node.selected).map((node) => node.id) : [primary.id];
      const nodes = snapshot(ids);
      return nodes.length === ids.length ? { scope, primaryNodeId: primary.id, nodes, element } : undefined;
    },
    isCurrent: (source) => {
      const scope = sourceScope();
      const current = snapshot(source.nodes.map((node) => node.nodeId));
      return scope?.projectId === source.scope.projectId && scope.canvasId === source.scope.canvasId
        && source.nodes.every((node) => sameCanvasDropNode(node, current.find((item) => item.nodeId === node.nodeId)));
    },
    read: () => useLcosDropStore.getState(),
    begin: (payload, sourceNodeId, sourceNodeIds) => useLcosDropStore.getState().begin(payload, sourceNodeId, sourceNodeIds),
    advance: advanceDropAtScreenPoint,
    commit: () => useLcosDropStore.getState().commitAt(crypto.randomUUID()),
    cancel: () => useLcosDropStore.getState().cancel(),
    reject: (message) => toast(message, { tone: 'danger' }),
    threshold: () => getDragActivationDistance('mouse'),
    beginMenu: beginCarryContextMenu,
    finishMenu: finishCarryContextMenu,
  });
}
