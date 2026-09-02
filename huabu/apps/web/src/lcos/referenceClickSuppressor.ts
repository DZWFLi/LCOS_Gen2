// A03 fix: click-event suppression for the reference-pick gesture.
// Root cause: the pointer router intercepts pointerdown/move/up, but React
// Flow's node selection listens to the independently dispatched CLICK event,
// which pointerdown's stopPropagation cannot cancel. Result: Ctrl+click
// toggled a reference AND selected the node (selection rim/bounds lit up,
// making Ctrl look like the multi-select key).
//
// Fix: after a successful reference pick, swallow the trailing click within
// a short window. The suppressor is a document-level CAPTURE listener so it
// runs before React Flow's own handling regardless of which container the
// click targets.

const PICK_SUPPRESS_WINDOW_MS = 400;
let lastReferencePickAt = 0;
let suppressorInstalled = false;

/** Mark "a reference pick just completed" — the trailing click is ours. */
export function markReferencePickCompleted(): void {
  lastReferencePickAt = Date.now();
}

/**
 * Shared click handler (exported for tests). Returns true when the click was
 * suppressed (it belonged to a just-finished reference-pick gesture on a
 * canvas node).
 */
export function handleReferenceClickSuppression(event: {
  target: EventTarget | null;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation?(): void;
}): boolean {
  if (Date.now() - lastReferencePickAt > PICK_SUPPRESS_WINDOW_MS) return false;
  const target = event.target as Element | null;
  if (!target || typeof target.closest !== 'function') return false;
  if (!target.closest('.react-flow__node')) return false;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
  return true;
}

/** Install the document-level capture listener once (idempotent). */
export function installReferenceClickSuppressor(): void {
  if (suppressorInstalled || typeof document === 'undefined') return;
  suppressorInstalled = true;
  document.addEventListener(
    'click',
    (event) => {
      handleReferenceClickSuppression(event);
    },
    { capture: true },
  );
}
