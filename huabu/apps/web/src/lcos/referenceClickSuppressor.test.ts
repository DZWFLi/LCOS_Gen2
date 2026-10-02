// Click-suppressor tests: the trailing CLICK after a reference pick must be
// swallowed when it lands on a canvas node — React Flow selection must not
// see it (Ctrl must stay the reference key, not a select key).
import { describe, expect, it, vi } from 'vitest';

import {
  handleReferenceClickSuppression,
  installReferenceClickSuppressor,
  markReferencePickCompleted,
  markCarryCompleted,
} from './referenceClickSuppressor';

type FakeClick = Parameters<typeof handleReferenceClickSuppression>[0];
function fakeClick(insideNode: boolean, opts: { shiftKey?: boolean } = {}): FakeClick {
  const target = {
    closest: (sel: string) =>
      insideNode && sel === '.react-flow__node[data-id]' ? {dataset:{id:'node-a'}} : null,
  };
  return {
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    shiftKey: opts.shiftKey ?? false,
  } as unknown as FakeClick;
}

describe('reference click suppressor', () => {
  it('swallows a click on a canvas node right after a pick', () => {
    markReferencePickCompleted('node-a');
    const click = fakeClick(true);
    expect(handleReferenceClickSuppression(click)).toBe(true);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopPropagation).toHaveBeenCalled();
  });

  it('lets clicks through outside the pick window', () => {
    markReferencePickCompleted('node-a');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1000);
    const click = fakeClick(true);
    expect(handleReferenceClickSuppression(click)).toBe(false);
    vi.useRealTimers();
  });

  it('never swallows a Shift click, even inside the pick window', () => {
    markReferencePickCompleted('node-a');
    const click = fakeClick(true, { shiftKey: true });
    expect(handleReferenceClickSuppression(click)).toBe(false);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  it('lets clicks on non-node targets through', () => {
    markReferencePickCompleted('node-a');
    const click = fakeClick(false);
    expect(handleReferenceClickSuppression(click)).toBe(false);
  });

  it('owns both trailing click and carry-context listeners for the runtime lifetime', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const uninstall = installReferenceClickSuppressor();
    for (const event of ['click', 'pointerdown', 'contextmenu']) {
      expect(addSpy.mock.calls.filter(([name]) => name === event)).toHaveLength(1);
    }
    const redundantUninstall = installReferenceClickSuppressor();
    redundantUninstall();
    expect(removeSpy).not.toHaveBeenCalled();
    for (const event of ['click', 'pointerdown', 'contextmenu']) {
      expect(addSpy.mock.calls.filter(([name]) => name === event)).toHaveLength(1);
    }
    markCarryCompleted();
    const trailing = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(trailing);
    expect(trailing.defaultPrevented).toBe(true);
    const next = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    document.body.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
    uninstall();
    uninstall();
    for (const event of ['click', 'pointerdown', 'contextmenu']) {
      const handler = addSpy.mock.calls.find(([name]) => name === event)?.[1];
      expect(removeSpy).toHaveBeenCalledWith(event, handler, { capture: true });
      expect(removeSpy.mock.calls.filter(([name]) => name === event)).toHaveLength(1);
    }
    const reinstall = installReferenceClickSuppressor();
    for (const event of ['click', 'pointerdown', 'contextmenu']) {
      expect(addSpy.mock.calls.filter(([name]) => name === event)).toHaveLength(2);
    }
    reinstall();
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
