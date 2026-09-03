// Click-suppressor tests: the trailing CLICK after a reference pick must be
// swallowed when it lands on a canvas node — React Flow selection must not
// see it (Ctrl must stay the reference key, not a select key).
import { describe, expect, it, vi } from 'vitest';

import {
  handleReferenceClickSuppression,
  installReferenceClickSuppressor,
  markReferencePickCompleted,
} from './referenceClickSuppressor';

type FakeClick = Parameters<typeof handleReferenceClickSuppression>[0];
function fakeClick(insideNode: boolean, opts: { shiftKey?: boolean } = {}): FakeClick {
  const target = {
    closest: (sel: string) =>
      insideNode && sel === '.react-flow__node' ? {} : null,
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
    markReferencePickCompleted();
    const click = fakeClick(true);
    expect(handleReferenceClickSuppression(click)).toBe(true);
    expect(click.preventDefault).toHaveBeenCalled();
    expect(click.stopPropagation).toHaveBeenCalled();
  });

  it('lets clicks through outside the pick window', () => {
    markReferencePickCompleted();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1000);
    const click = fakeClick(true);
    expect(handleReferenceClickSuppression(click)).toBe(false);
    vi.useRealTimers();
  });

  it('never swallows a Shift click, even inside the pick window', () => {
    markReferencePickCompleted();
    const click = fakeClick(true, { shiftKey: true });
    expect(handleReferenceClickSuppression(click)).toBe(false);
    expect(click.preventDefault).not.toHaveBeenCalled();
  });

  it('lets clicks on non-node targets through', () => {
    markReferencePickCompleted();
    const click = fakeClick(false);
    expect(handleReferenceClickSuppression(click)).toBe(false);
  });

  it('install returns a dispose that removes the document listener (runtime lifecycle, audit 4.4)', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const uninstall = installReferenceClickSuppressor();
    expect(addSpy).toHaveBeenCalledWith('click', expect.any(Function), { capture: true });
    // idempotent: second install does not add again until the first is disposed
    installReferenceClickSuppressor();
    expect(addSpy).toHaveBeenCalledTimes(1);
    uninstall();
    expect(removeSpy).toHaveBeenCalledWith('click', expect.any(Function), { capture: true });
    // after dispose the module re-arms on next install
    installReferenceClickSuppressor();
    expect(addSpy).toHaveBeenCalledTimes(2);
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
