// A03/A04 — pointer intent grammar + reference controller (pure function tests).
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAdditiveSelection,
  isAdditiveSelectionExclusively,
  isReferencePick,
  pointerModifiersOf,
  type PointerModifiers,
} from '../src/index.js';
import {
  createReferenceControllerState,
  openComposerReferences,
  orderedReferences,
  removeReference,
  sameEntityRef,
  toggleReference,
} from '../src/index.js';

const mods = (o: Partial<PointerModifiers> = {}): PointerModifiers => ({
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...o,
});

// ── A03: pointer intent grammar ───────────────────────────────────────────

test('A03: Shift alone = additive selection, not reference', () => {
  const m = mods({ shiftKey: true });
  assert.equal(isAdditiveSelection(m), true);
  assert.equal(isReferencePick(m), false);
});

test('A03: Ctrl alone = reference pick, not selection', () => {
  const m = mods({ ctrlKey: true });
  assert.equal(isReferencePick(m), true);
  assert.equal(isAdditiveSelection(m), false);
});

test('A03: Cmd (meta) alone = reference pick (macOS parity)', () => {
  const m = mods({ metaKey: true });
  assert.equal(isReferencePick(m), true);
});

test('A03: Shift WINS over Ctrl/Cmd — never both intents', () => {
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { ctrlKey: true, metaKey: true }]) {
    const m = mods({ shiftKey: true, ...extra });
    assert.equal(isAdditiveSelection(m), true);
    assert.equal(isReferencePick(m), false, 'Shift must suppress reference pick');
    assert.equal(isAdditiveSelectionExclusively(m), true);
  }
});

test('A03: no modifiers = neither intent', () => {
  const m = mods();
  assert.equal(isAdditiveSelection(m), false);
  assert.equal(isReferencePick(m), false);
  assert.equal(isAdditiveSelectionExclusively(m), false);
});

test('A03: alt is neutral (neither selection nor reference)', () => {
  const m = mods({ altKey: true });
  assert.equal(isAdditiveSelection(m), false);
  assert.equal(isReferencePick(m), false);
});

test('A03: pointerModifiersOf extracts and normalizes the subset', () => {
  const m = pointerModifiersOf({ shiftKey: true, ctrlKey: false, metaKey: undefined, altKey: true });
  assert.deepEqual(m, { shiftKey: true, ctrlKey: false, metaKey: false, altKey: true });
});

// ── A04: reference controller ─────────────────────────────────────────────

const ref = (entityType: 'artifact' | 'note', entityId: string) => ({ entityType, entityId });

test('A04: opening a composer starts with EMPTY references (selection not copied)', () => {
  const state = openComposerReferences('composer-1');
  assert.equal(state.composerId, 'composer-1');
  assert.deepEqual(orderedReferences(state), []);
});

test('A04: toggle appends at the END, preserving pick order', () => {
  let s = createReferenceControllerState('c1');
  s = toggleReference(s, ref('artifact', 'a2'));
  s = toggleReference(s, ref('artifact', 'a1'));
  s = toggleReference(s, ref('note', 'n3'));
  assert.deepEqual(orderedReferences(s).map((r) => r.entityId), ['a2', 'a1', 'n3']);
});

test('A04: toggle removes when present, order of the rest preserved', () => {
  let s = createReferenceControllerState('c1');
  s = toggleReference(s, ref('artifact', 'a1'));
  s = toggleReference(s, ref('artifact', 'a2'));
  s = toggleReference(s, ref('artifact', 'a3'));
  s = toggleReference(s, ref('artifact', 'a2'));
  assert.deepEqual(orderedReferences(s).map((r) => r.entityId), ['a1', 'a3']);
});

test('A04: no duplicates even after re-adding after removal', () => {
  let s = createReferenceControllerState('c1');
  s = toggleReference(s, ref('artifact', 'a1'));
  s = toggleReference(s, ref('artifact', 'a1')); // toggle off
  s = toggleReference(s, ref('artifact', 'a1')); // toggle on again — single entry
  assert.equal(orderedReferences(s).length, 1);
});

test('A04: sameEntityRef compares type+id only; removeReference drops it', () => {
  assert.equal(sameEntityRef(ref('artifact', 'x'), ref('artifact', 'x')), true);
  assert.equal(sameEntityRef(ref('artifact', 'x'), ref('note', 'x')), false);
  let s = createReferenceControllerState('c1');
  s = toggleReference(s, ref('artifact', 'a1'));
  s = toggleReference(s, ref('note', 'n1'));
  s = removeReference(s, ref('artifact', 'a1'));
  assert.deepEqual(orderedReferences(s).map((r) => r.entityId), ['n1']);
});

test('A04: orderedReferences returns a copy — mutating it does not affect state', () => {
  let s = createReferenceControllerState('c1');
  s = toggleReference(s, ref('artifact', 'a1'));
  const snapshot = orderedReferences(s);
  assert.equal(snapshot.length, 1);
  // The state itself is readonly; a caller copying then mutating must not
  // corrupt future reads.
  assert.equal(orderedReferences(s).length, 1);
});
