// Pointer intent grammar (Phase A03) — lifted from Gen1
// `features/spatial/pointerInteractionLanguage.ts` (R2-D pointer grammar).
//
// These helpers are deliberately presentation-only: they classify input
// intent but never mutate Selection / Reference / Relation truth. The frozen
// modifier semantics (user ruling, unchanged from Gen1):
//
//   - Multi-selection is Shift-ONLY.
//   - Ctrl/Cmd is reserved for this-run Reference picking.
//   - Shift always WINS over Ctrl/Cmd when both are held: Shift is the
//     explicit multi-selection signal and must never be reinterpreted as a
//     platform-habit selection modifier.

/** Modifier keys of a pointer event (subset — no buttons, no coords). */
export interface PointerModifiers {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

/** Extract the modifier subset from any event-shaped object. */
export function pointerModifiersOf(event: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}): PointerModifiers {
  return {
    shiftKey: event.shiftKey === true,
    ctrlKey: event.ctrlKey === true,
    metaKey: event.metaKey === true,
    altKey: event.altKey === true,
  };
}

/** Multi-selection is Shift-only. Ctrl/Cmd is reserved for Reference. */
export function isAdditiveSelection(modifiers: PointerModifiers): boolean {
  return modifiers.shiftKey;
}

/**
 * Ctrl/Cmd (either) means this-run Reference pick — unless Shift is also
 * held, in which case the explicit multi-selection signal wins.
 */
export function isReferencePick(modifiers: PointerModifiers): boolean {
  return !modifiers.shiftKey && (modifiers.ctrlKey || modifiers.metaKey);
}

/**
 * The mutual-exclusion gate for pointer routing: at most ONE of
 * additive-selection / reference-pick may claim a click. Shift+Ctrl/Cmd
 * resolves to additive selection (Shift wins) — never both.
 */
export function isAdditiveSelectionExclusively(modifiers: PointerModifiers): boolean {
  return isAdditiveSelection(modifiers) && !isReferencePick(modifiers);
}
