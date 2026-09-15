import { describe, expect, it } from 'vitest';

import { buildAtlasGroups, canAtlasLocate, isAtlasItem } from './contextAtlasSemantics';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';

function item(overrides: Partial<WarehouseItemV1> = {}): WarehouseItemV1 {
  return {
    schemaVersion: 1,
    entityRef: { type: 'artifact', id: 'a-1' },
    kind: 'artifact',
    title: '材料',
    updatedAt: '2026-09-14T10:00:00.000Z',
    usageCount: 0,
    ...overrides,
  };
}

describe('Context Atlas UX semantics', () => {
  it('does not turn kind or updatedAt into organization groups', () => {
    const groups = buildAtlasGroups([
      item(),
      item({ kind: 'conversation', entityRef: { type: 'conversation', id: 'c-1' }, updatedAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('未指定组织');
    expect(groups[0]?.list).toHaveLength(2);
  });

  it('only reports locate when the exact entity is projected', () => {
    const projected = [{ entityId: 'a-1', entityType: 'artifact' }];
    expect(canAtlasLocate(item(), projected)).toBe(true);
    expect(canAtlasLocate(item({ entityRef: { type: 'artifact', id: 'missing' } }), projected)).toBe(false);
  });

  it('only admits context/collection/scene to Atlas', () => {
    expect(isAtlasItem(item({ kind: 'context', entityRef: { type: 'context', id: 'ctx-1' } }))).toBe(true);
    expect(isAtlasItem(item({ kind: 'collection', entityRef: { type: 'collection', id: 'col-1' } }))).toBe(true);
    expect(isAtlasItem(item({ kind: 'scene', entityRef: { type: 'scene', id: 'scene-1' } }))).toBe(true);
    expect(isAtlasItem(item({ kind: 'conversation', entityRef: { type: 'conversation', id: 'conv-1' } }))).toBe(false);
    expect(isAtlasItem(item({ kind: 'workflow', entityRef: { type: 'workflow', id: 'wf-1' } }))).toBe(false);
  });
});
