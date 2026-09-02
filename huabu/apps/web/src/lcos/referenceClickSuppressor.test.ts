// Click-suppressor tests: the trailing CLICK after a reference pick must be
// swallowed when it lands on a canvas node — React Flow selection must not
// see it (Ctrl must stay the reference key, not a select key).
import { describe, expect, it, vi } from 'vitest';

import {
  handleReferenceClickSuppression,
  markReferencePickCompleted,
} from './referenceClickSuppressor';

type FakeClick = Parameters<typeof handleReferenceClickSuppression>[0];
function fakeClick(insideNode: boolean): FakeClick {
  const target = {
    closest: (sel: string) =>
      insideNode && sel === '.react-flow__node' ? {} : null,
  };
  return {
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
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

  it('lets clicks on non-node targets through', () => {
    markReferencePickCompleted();
    const click = fakeClick(false);
    expect(handleReferenceClickSuppression(click)).toBe(false);
  });
});
