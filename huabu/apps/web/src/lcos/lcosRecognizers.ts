// LCOS pointer recognizers (Phase A03) — typed intent recognizers injected
// into Huabu's canvas pointer router via hostExtension.recognizers.
//
// Design rules (Phase A task card):
//   - Recognizers produce INTENT, never mutate Core/canvas truth directly.
//   - Ctrl/Cmd+click = this-run Reference pick; Shift+click stays Huabu's
//     additive selection (Shift ALWAYS wins — pointerModifiersOf /
//     isReferencePick enforce the frozen Gen1 grammar).
//   - Mouse only: touch/pen gestures keep their Huabu owners.
//   - Reference picking only applies to nodes PROJECTED by LCOS (the
//     nodeEntityRefs map); native Huabu nodes are untouched.

import { isReferencePick, pointerModifiersOf } from '@local-creative-os/web-gen2';

import { nodeIdAtScreenPoint } from '@/handler/canvasNodeAtPoint';
import type { CanvasPointerRouterContext } from '@/handler/canvasPointerRouterContext';
import type { PointerRecognizer } from '@/handler/pointerRouter';

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
  return [createReferencePickRecognizer()];
}
