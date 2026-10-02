import { describe, expect, it } from 'vitest';

import { resolveProfessionalWindowDropTarget } from './professionalWindowDropTarget';

const viewport = { x: 0, y: 0, width: 1440, height: 900 };
const target = {
  regionId: 'target', rect: { x: 400, y: 100, width: 600, height: 500 }, canSplit: true,
  groups: [
    { groupId: 'left-pane', rect: { x: 400, y: 100, width: 297.5, height: 500 } },
    { groupId: 'right-pane', rect: { x: 702.5, y: 100, width: 297.5, height: 500 } },
  ],
};
const onePane = { regionId: 'target', rect: { x: 400, y: 100, width: 900, height: 700 }, canSplit: true, groups: [{ groupId: 'only-pane', rect: { x: 400, y: 100, width: 900, height: 700 } }] };

describe('professional window drop target', () => {
  it('uses the actual pointer pane and side to preview a split', () => {
    expect(resolveProfessionalWindowDropTarget({
      x: 415, y: 350, sourceRegionId: 'source', viewport, preferredDockWidth: 520, regions: [onePane],
    })).toMatchObject({ kind: 'split', regionId: 'target', groupId: 'only-pane', direction: 'vertical', sourceFirst: true, rect: { x: 400, width: 447.5 } });
    expect(resolveProfessionalWindowDropTarget({
      x: 1280, y: 350, sourceRegionId: 'source', viewport, preferredDockWidth: 520, regions: [onePane],
    })).toMatchObject({ kind: 'split', regionId: 'target', groupId: 'only-pane', direction: 'vertical', sourceFirst: false });
  });

  it('previews the actual group under the pointer instead of an array-neighbor region', () => {
    expect(resolveProfessionalWindowDropTarget({
      x: 850, y: 350, sourceRegionId: 'source', viewport, preferredDockWidth: 520, regions: [target],
    })).toMatchObject({ kind: 'group', regionId: 'target', groupId: 'right-pane' });
  });

  it('supports the existing right dock and ignores the dragged region itself', () => {
    expect(resolveProfessionalWindowDropTarget({
      x: 1430, y: 400, sourceRegionId: 'source', viewport, preferredDockWidth: 500, regions: [target],
    })).toMatchObject({
      kind: 'dock-right',
      rect: { x: 940, width: 500, height: 900 },
      previewRect: { x: 940, width: 500, height: 900 },
    });
    expect(resolveProfessionalWindowDropTarget({
      x: 500, y: 300, sourceRegionId: 'target', viewport, preferredDockWidth: 520, regions: [target],
    })).toBeUndefined();
  });

  it('allows tab drops back onto their source pane without treating the source as a split target', () => {
    expect(resolveProfessionalWindowDropTarget({
      x: 850, y: 350, sourceRegionId: 'target', allowSourceRegion: true, viewport, preferredDockWidth: 520, regions: [target],
    })).toMatchObject({ kind: 'group', regionId: 'target', groupId: 'right-pane' });
  });
});
