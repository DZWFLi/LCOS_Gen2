import { describe, expect, it } from 'vitest';

import { resolveInteractionPhase } from './nodePresentation';

const all = {
  editing: false,
  selected: false,
  isDragging: false,
  isResizing: false,
  hovered: false,
};

describe('resolveInteractionPhase', () => {
  it('rest when nothing is active', () => {
    expect(resolveInteractionPhase(all)).toBe('rest');
  });

  it('hover beats rest only', () => {
    expect(resolveInteractionPhase({ ...all, hovered: true })).toBe('hover');
  });

  it('selected beats hovered', () => {
    expect(
      resolveInteractionPhase({ ...all, selected: true, hovered: true }),
    ).toBe('selected');
  });

  it('dragging beats selected and hovered', () => {
    expect(
      resolveInteractionPhase({
        ...all,
        selected: true,
        isDragging: true,
        hovered: true,
      }),
    ).toBe('dragging');
  });

  it('resizing beats dragging', () => {
    expect(
      resolveInteractionPhase({ ...all, isDragging: true, isResizing: true }),
    ).toBe('resizing');
  });

  it('editing beats everything', () => {
    expect(
      resolveInteractionPhase({
        editing: true,
        selected: true,
        isDragging: true,
        isResizing: true,
        hovered: true,
      }),
    ).toBe('editing');
  });
});
