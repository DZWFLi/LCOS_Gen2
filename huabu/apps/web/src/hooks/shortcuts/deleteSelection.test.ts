import { describe, expect, it } from 'vitest';

import { deletableCanvasNodeIds } from './deleteSelection';

describe('deletableCanvasNodeIds', () => {
  it('excludes Core projections but preserves native nodes', () => {
    const nodes = [
      { id: 'native', parentId: undefined },
      { id: 'bound', parentId: undefined },
    ];
    const bindings = new Map([
      ['bound', { entityType: 'artifact', entityId: 'a1' }],
    ]);

    expect(deletableCanvasNodeIds(nodes, bindings)).toEqual(['native']);
  });

  it('does not delete an unbound frame when a bound descendant would cascade', () => {
    const nodes = [
      { id: 'frame', parentId: undefined },
      { id: 'bound-child', parentId: 'frame' },
      { id: 'native', parentId: undefined },
    ];
    const bindings = new Map([
      ['bound-child', { entityType: 'artifact', entityId: 'a1' }],
    ]);

    expect(deletableCanvasNodeIds(nodes, bindings)).toEqual(['native']);
  });

  it('checks unselected descendants before deleting a selected frame', () => {
    const nodes = [
      { id: 'frame', parentId: undefined },
      { id: 'bound-child', parentId: 'frame' },
    ];
    const bindings = new Map([
      ['bound-child', { entityType: 'artifact', entityId: 'a1' }],
    ]);

    expect(deletableCanvasNodeIds(nodes, bindings, ['frame'])).toEqual([]);
  });
});
