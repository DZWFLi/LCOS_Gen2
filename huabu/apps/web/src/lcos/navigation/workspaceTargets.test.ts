import { describe, expect, it } from 'vitest';

import { childSurfaceForItem, workspaceTargetsForItem } from './workspaceTargets';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';


const workspace = (
  id: string,
  scopeId: string,
  canvasId?: string,
): Workspace => ({
  id: id as Workspace['id'],
  projectId: 'project-a' as Workspace['projectId'],
  scopeId: scopeId as Workspace['scopeId'],
  name: id,
  intent: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  focusedViewIds: [],
  visibleLayers: ['core'],
  contextPolicy: 'selection-only',
  ...(canvasId === undefined ? {} : { canvasId }),
  updatedAt: '2026-09-15T00:00:00.000Z',
});

const item = (
  kind: WarehouseItemV1['kind'],
  id: string,
): Pick<WarehouseItemV1, 'kind' | 'entityRef'> => ({
  kind,
  entityRef: { type: kind, id },
});

describe('workspaceTargetsForItem', () => {
  it('keeps every workspace for a scope, including a candidate without canvasId', () => {
    const targets = workspaceTargetsForItem(item('context', 'scope-context'), [
      workspace('workspace-context-a', 'scope-context', 'canvas-a'),
      workspace('workspace-context-b', 'scope-context'),
      workspace('workspace-other', 'scope-other', 'canvas-other'),
    ]);

    expect(targets.map((target) => target.id)).toEqual([
      'workspace-context-a',
      'workspace-context-b',
    ]);
    expect(targets[1]?.canvasId).toBeUndefined();
  });

  it('matches workflow and collection by scope without using preferred surface or title', () => {
    const workspaces = [
      workspace('workspace-workflow', 'scope-shared', 'canvas-workflow'),
      { ...workspace('workspace-same-name', 'scope-other', 'canvas-other'), name: 'scope-shared' },
    ];

    expect(workspaceTargetsForItem(item('workflow', 'scope-shared'), workspaces).map((target) => target.id))
      .toEqual(['workspace-workflow']);
    expect(workspaceTargetsForItem(item('collection', 'scope-shared'), workspaces).map((target) => target.id))
      .toEqual(['workspace-workflow']);
  });

  it('matches scene identity to workspace id and never treats canvasId as workspace id', () => {
    const targets = workspaceTargetsForItem(item('scene', 'workspace-scene'), [
      workspace('workspace-scene', 'scope-a', 'canvas-scene'),
      workspace('canvas-scene', 'scope-a', 'canvas-other'),
    ]);

    expect(targets.map((target) => target.id)).toEqual(['workspace-scene']);
  });

  it('returns no candidates for non-workspace-target item kinds', () => {
    expect(workspaceTargetsForItem(item('artifact', 'artifact-a'), [
      workspace('workspace-a', 'scope-a', 'canvas-a'),
    ])).toEqual([]);
    expect(workspaceTargetsForItem(item('note', 'note-a'), [
      workspace('workspace-a', 'note-a', 'canvas-a'),
    ])).toEqual([]);
  });
});

describe('childSurfaceForItem', () => {
  it('keeps context and workflow child destinations semantic', () => {
    expect(childSurfaceForItem(item('context', 'scope-a'))).toBe('context');
    expect(childSurfaceForItem(item('collection', 'scope-a'))).toBe('context');
    expect(childSurfaceForItem(item('workflow', 'scope-a'))).toBe('workflow');
  });

  it('only trusts an explicit workspace preferredSurface for a scene', () => {
    expect(childSurfaceForItem(item('scene', 'workspace-a'), { preferredSurface: 'context' })).toBe('context');
    expect(childSurfaceForItem(item('scene', 'workspace-a'), { preferredSurface: 'unknown' })).toBeUndefined();
    expect(childSurfaceForItem(item('scene', 'workspace-a'))).toBeUndefined();
  });
});
