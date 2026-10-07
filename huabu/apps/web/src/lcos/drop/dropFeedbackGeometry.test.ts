import { describe, expect, it } from 'vitest';
import { DROP_FEEDBACK_NEAR_PX, dropFeedbackPosition, isNearDropFeedback, nearestDropFeedbackPoint } from './dropFeedbackGeometry';
import { DropTargetRegistry } from './dropTargetRegistry';

const rect = { left: 100, top: 100, width: 80, height: 60 };
describe('GEN1 carry feedback geometry', () => {
  it('keeps the GEN1 48 CSS-pixel approach hint without expanding a real target', () => {
    const registry = new DropTargetRegistry();
    registry.register({ targetId: 'receiver', kind: 'collection-membership', label: '资料', priority: 30, enabled: true,
      rect, semantic: { kind: 'collection-membership', collectionId: 'collection-a' } });
    expect(DROP_FEEDBACK_NEAR_PX).toBe(48);
    expect(isNearDropFeedback(rect, { x: 228, y: 120 })).toBe(true);
    expect(isNearDropFeedback(rect, { x: 229, y: 120 })).toBe(false);
    expect(registry.hitTest({ x: 228, y: 120 })).toBeUndefined();
  });
  it('measures diagonal proximity rather than using an inflated rectangle', () => {
    expect(isNearDropFeedback(rect, { x: 210, y: 190 })).toBe(true);
    expect(isNearDropFeedback(rect, { x: 220, y: 200 })).toBe(false);
  });
  it.each([
    { ...rect, width: 0 }, { ...rect, height: -1 }, { ...rect, left: Number.NaN },
  ])('ignores unusable live geometry', (value) => {
    expect(nearestDropFeedbackPoint(value, { x: 120, y: 120 })).toBeUndefined();
  });
  it('follows screen samples without converting them through the canvas zoom', () => {
    const viewport = { width: 1440, height: 900 }, footprint = { width: 280, height: 64 };
    const a = dropFeedbackPosition({ x: 400, y: 300 }, viewport, footprint);
    const b = dropFeedbackPosition({ x: 437, y: 319 }, viewport, footprint);
    expect(b.left - a.left).toBe(37);
    expect(b.top - a.top).toBe(19);
  });
  it.each([{ width: 1440, height: 900 }, { width: 390, height: 844 }])('flips at viewport edges', (viewport) => {
    const footprint = { width: 280, height: 64 };
    const p = dropFeedbackPosition({ x: viewport.width - 12, y: viewport.height - 16 }, viewport, footprint);
    expect(p.side).toBe('left');
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.left + footprint.width).toBeLessThanOrEqual(viewport.width - 8);
    expect(p.top + footprint.height).toBeLessThanOrEqual(viewport.height - 8);
  });
});
