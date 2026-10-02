import { describe, expect, it } from 'vitest';
import { DropTargetRegistry } from './dropTargetRegistry';
import type { DropRect, DropTargetRegistration } from './dropTypes';

const target: DropTargetRegistration = {
  targetId: 'glyth:one', kind: 'collaboration-reference', label: 'Glyth',
  rect: { left: 0, top: 0, width: 92, height: 92 }, priority: 20, enabled: true,
  semantic: { kind: 'collaboration-reference', conversationId: 'conversation-one' },
};
describe('drop geometry after pan/zoom and unmount', () => {
  it('hits the currently drawn body, not its mount-time location', () => {
    let rect: DropRect | undefined = target.rect;
    const registry = new DropTargetRegistry();
    registry.register({ ...target, readRect: () => rect });
    expect(registry.hitTest({ x: 40, y: 40 })?.targetId).toBe(target.targetId);
    rect = { left: 500, top: 200, width: 46, height: 46 };
    expect(registry.hitTest({ x: 40, y: 40 })).toBeUndefined();
    expect(registry.hitTest({ x: 520, y: 220 })?.rect).toEqual(rect);
    rect = undefined;
    expect(registry.hitTest({ x: 520, y: 220 })).toBeUndefined();
    expect(registry.get(target.targetId)).toBeUndefined();
  });
  it('keeps a disabled visible receiver as a rejection instead of dropping onto its background', () => {
    const registry = new DropTargetRegistry();
    registry.register({ ...target, enabled: false, readRect: () => target.rect });
    expect(registry.hitTest({ x: 20, y: 20 })?.enabled).toBe(false);
    registry.register({ ...target, targetId: 'canvas', priority: 1 });
    expect(registry.hitTest({ x: 20, y: 20 })?.targetId).toBe(target.targetId);
  });
});
