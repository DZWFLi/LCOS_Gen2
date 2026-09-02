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
import type { DropPayload } from '@local-creative-os/web-gen2';

import { nodeIdAtScreenPoint } from '@/handler/canvasNodeAtPoint';
import type { CanvasPointerRouterContext } from '@/handler/canvasPointerRouterContext';
import type { PointerRecognizer } from '@/handler/pointerRouter';

import { useLcosDropStore } from './lcosDropState';
import { useLcosReferenceStore } from './lcosReferenceState';
import {
  installReferenceClickSuppressor,
  markReferencePickCompleted,
} from './referenceClickSuppressor';

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

  const SLOP_PX = 4;

  return {
    id: 'lcos/reference-pick',
    canClaim: (event, ctx) =>
      activePointerId === null &&
      !ctx.interactivityLocked &&
      event.pointerType === 'mouse' &&
      event.button === 0 &&
      event.isPrimary &&
      isReferencePick(pointerModifiersOf(event)),
    onDown: (event) => {
      const nodeId = nodeIdAtScreenPoint(event.clientX, event.clientY);
      // No node under the pointer → nothing to reference.
      if (!nodeId) return 'pass';
      // Native Huabu nodes are referenceable too (user ruling, option A):
      // register a canvas identity (note:<nodeId>) on first pick. Run
      // submission fail-closes later if Core does not recognize the ref —
      // identity gating belongs to the submit boundary, not the gesture.
      const store = useLcosReferenceStore.getState();
      if (!store.nodeEntityRefs.has(nodeId)) {
        store.registerNodeEntity(nodeId, {
          entityType: 'note',
          entityId: nodeId,
        });
      }
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
      if (pendingNodeId !== null) {
        useLcosReferenceStore.getState().toggleNodeReference(pendingNodeId);
        // React Flow selection listens to the trailing CLICK event, which
        // pointer-level stopPropagation cannot cancel — swallow it here or
        // the node also gets selected (looks like Ctrl became the select key).
        markReferencePickCompleted();
      }
      activePointerId = null;
      pendingNodeId = null;
    },
    onCancel: (event) => {
      if (event.pointerId !== activePointerId) return;
      activePointerId = null;
      pendingNodeId = null;
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

  return {
    id: 'lcos/drop',
    canClaim: () => false,
    onDown: () => 'pass' as const,
    observe: {
      onDown: (event) => {
        if (event.pointerType !== 'mouse') return;
        if (useLcosDropStore.getState().state.status === 'idle') return;
        activePointerId = event.pointerId;
      },
      onMove: (event, ctx) => {
        if (event.pointerId !== activePointerId) return;
        const rect = ctx.wrapper.getBoundingClientRect();
        useLcosDropStore.getState().setBounds({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        });
        useLcosDropStore.getState().advance(
          { x: event.clientX - rect.left, y: event.clientY - rect.top },
          false,
          Date.now(),
        );
      },
      onUp: (event) => {
        if (event.pointerId !== activePointerId) return;
        activePointerId = null;
        const status = useLcosDropStore.getState().state.status;
        if (status === 'tracking' || status === 'dwell' || status === 'preview') {
          useLcosDropStore.getState().cancel();
        }
      },
      onCancel: (event) => {
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
  installReferenceClickSuppressor();
  return [createReferencePickRecognizer(), createDropRecognizer()];
}