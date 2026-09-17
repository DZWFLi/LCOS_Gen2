import { describe, expect, it } from 'vitest';

import { projectRailwayDestinations } from './railwayProjection';

describe('projectRailwayDestinations', () => {
  const base = {
    workspaces: [
      { id: 'workspace-main', name: '主现场', scopeId: 'scope-root' },
      { id: 'workspace-context', name: '研究现场', scopeId: 'scope-context' },
    ],
    scopes: [
      { id: 'scope-root', name: '项目根', kind: 'root' },
      { id: 'scope-context', name: '研究集', kind: 'context' },
      { id: 'scope-collection', name: '资料集', kind: 'collection' },
    ],
    surfaceByWorkspace: new Map([
      ['workspace-main', 'main' as const],
      ['workspace-context', 'context' as const],
    ]),
  };

  it('keeps an empty Core order empty instead of adding static surfaces', () => {
    expect(projectRailwayDestinations({ ...base, orderedRefs: [] })).toEqual(
      [],
    );
  });

  it('filters only legacy root-workspace rows instead of rendering a second SurfaceDock', () => {
    const result = projectRailwayDestinations({
      ...base,
      orderedRefs: [
        { kind: 'scene', viewId: 'workspace-main' },
        { kind: 'context', viewId: 'workspace-context' },
      ],
    });

    expect(result).toMatchObject([
      {
        key: 'context:workspace-context',
        available: true,
        workspaceId: 'workspace-context',
        surface: 'context',
        sourceRef: { kind: 'context', viewId: 'workspace-context' },
        sourceIndex: 1,
      },
    ]);
  });

  it('preserves Core order and never collapses a concrete destination into a root Surface click', () => {
    const result = projectRailwayDestinations({
      ...base,
      orderedRefs: [
        { kind: 'scene', viewId: 'workspace-main' },
        { kind: 'context', viewId: 'scope-context' },
        { kind: 'collection', viewId: 'scope-collection' },
        { kind: 'workflow', viewId: 'missing-scope' },
      ],
    });

    expect(result.map((item) => item.key)).toEqual([
      'context:scope-context',
      'collection:scope-collection',
      'workflow:missing-scope',
    ]);
    expect(result[0]).toMatchObject({
      label: '研究集',
      available: true,
      workspaceId: 'workspace-context',
      surface: 'context',
    });
    expect(result[1]).toMatchObject({ available: false });
    expect(result[2]).toMatchObject({ available: false });
  });

  it('keeps raw source identity and full-order index when legacy rows are hidden', () => {
    const result = projectRailwayDestinations({
      ...base,
      orderedRefs: [
        { kind: 'scene', viewId: 'workspace-main' },
        { kind: 'context', viewId: 'scope-context' },
      ],
    });
    expect(result[0]).toMatchObject({
      sourceRef: { kind: 'context', viewId: 'scope-context' },
      sourceIndex: 1,
    });
  });

  it('resolves a concrete child scene to its exact workspace and surface', () => {
    const result = projectRailwayDestinations({
      ...base,
      workspaces: [
        ...base.workspaces,
        { id: 'workspace-scene', name: '镜头现场', scopeId: 'scope-context' },
      ],
      surfaceByWorkspace: new Map([
        ...base.surfaceByWorkspace,
        ['workspace-scene', 'context' as const],
      ]),
      orderedRefs: [{ kind: 'scene', viewId: 'workspace-scene' }],
    });

    expect(result).toEqual([
      expect.objectContaining({
        key: 'scene:workspace-scene',
        label: '镜头现场',
        available: true,
        workspaceId: 'workspace-scene',
        surface: 'context',
      }),
    ]);
  });

  it('disables ambiguous context refs rather than guessing a surface', () => {
    const workspaces = [
      ...base.workspaces,
      {
        id: 'workspace-context-2',
        name: '研究现场 2',
        scopeId: 'scope-context',
      },
    ];
    const result = projectRailwayDestinations({
      ...base,
      workspaces,
      surfaceByWorkspace: new Map([
        ...base.surfaceByWorkspace,
        ['workspace-context-2', 'context' as const],
      ]),
      orderedRefs: [{ kind: 'context', viewId: 'scope-context' }],
    });

    expect(result[0]).toMatchObject({
      available: false,
      reason: '未解析到唯一可恢复的工作现场',
    });
  });
});
