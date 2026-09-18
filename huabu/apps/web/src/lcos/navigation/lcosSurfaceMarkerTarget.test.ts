import { describe, expect, it } from 'vitest';

import { resolveSurfaceMarkerTargetV1 } from './lcosSurfaceMarkerTarget';

const root = { id: 'scope-root', kind: 'root', parentScopeId: null };

describe('resolveSurfaceMarkerTargetV1（R6 ColorPin semantic correction）', () => {
  it('maps root Main to the canonical main surface', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1', surface: 'main', scopes: [root], workspaces: [{ id: 'workspace-main', scopeId: 'scope-root' }],
    });
    expect(resolved).toEqual({ status: 'resolved', targetRef: { projectId: 'p1', kind: 'surface', id: 'main' } });
  });

  it('never turns a child workspace into a root surface target', () => {
    // 关键 correctness：root Context 上不得出现 workspace:<activeWorkspaceId>。
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1',
      surface: 'context',
      scopes: [root],
      workspaces: [{ id: 'workspace-context', scopeId: 'scope-context' }],
    });
    expect(resolved.status).toBe('unresolved');
    expect(JSON.stringify(resolved)).not.toContain('workspace-context');
  });

  it('maps root Context to the exact canonical context scope', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1',
      surface: 'context',
      scopes: [root, { id: 'scope-context', kind: 'context', parentScopeId: 'scope-root' }],
      workspaces: [{ id: 'workspace-context', scopeId: 'scope-context' }],
    });
    expect(resolved).toEqual({
      status: 'resolved',
      targetRef: { projectId: 'p1', kind: 'surface', id: 'scope:scope-context' },
    });
  });

  it('maps root Workflow to the exact canonical workflow scope', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1',
      surface: 'workflow',
      scopes: [root, { id: 'scope-workflow', kind: 'workflow', parentScopeId: 'scope-root' }],
      workspaces: [],
    });
    expect(resolved).toEqual({
      status: 'resolved',
      targetRef: { projectId: 'p1', kind: 'surface', id: 'scope:scope-workflow' },
    });
  });

  it('fails closed when the root scope is missing instead of guessing a workspace', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1', surface: 'context', scopes: [root], workspaces: [],
    });
    expect(resolved).toEqual({ status: 'unresolved', reason: 'root-scope-missing' });
  });

  it('fails closed when several scopes could be the root context surface', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1',
      surface: 'context',
      scopes: [
        root,
        { id: 'scope-context-a', kind: 'context', parentScopeId: 'scope-root' },
        { id: 'scope-context-b', kind: 'context', parentScopeId: 'scope-root' },
      ],
      workspaces: [],
    });
    expect(resolved).toEqual({ status: 'unresolved', reason: 'root-scope-ambiguous' });
  });

  it('fails closed when the project has no unique root scope', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1', surface: 'context', scopes: [], workspaces: [],
    });
    expect(resolved).toEqual({ status: 'unresolved', reason: 'root-scope-ambiguous' });
  });

  it('maps an explicit child worksite to the exact workspace it names', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1',
      surface: 'context',
      childWorkspaceId: 'workspace-child-7',
      scopes: [root, { id: 'scope-context', kind: 'context', parentScopeId: 'scope-root' }],
      workspaces: [{ id: 'workspace-child-7', scopeId: 'scope-context' }],
    });
    expect(resolved).toEqual({
      status: 'resolved',
      targetRef: { projectId: 'p1', kind: 'surface', id: 'workspace:workspace-child-7' },
    });
  });

  it('fails closed when the route names a child workspace the project does not have', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1', surface: 'main', childWorkspaceId: 'workspace-ghost', scopes: [root], workspaces: [],
    });
    expect(resolved).toEqual({ status: 'unresolved', reason: 'missing-workspace' });
  });

  it('rejects a surface it does not know', () => {
    const resolved = resolveSurfaceMarkerTargetV1({
      projectId: 'p1', surface: 'scene', scopes: [root], workspaces: [],
    });
    expect(resolved).toEqual({ status: 'unresolved', reason: 'unknown-surface' });
  });
});