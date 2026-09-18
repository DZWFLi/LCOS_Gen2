import { describe, expect, it } from 'vitest';

import { assemblyOpenTargetOf, assemblySourceRefOf, assemblyWindowOf, describeAssemblyApplyResultV1, previewUrlOf } from './AssemblyBody';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';
import type { Workspace } from '@local-creative-os/domain';

function item(
  kind: WarehouseItemV1['kind'],
  id: string,
  viewId?: string,
): WarehouseItemV1 {
  return {
    schemaVersion: 1,
    kind,
    title: id,
    usageCount: 0,
    entityRef: {
      type: kind,
      id,
      ...(viewId === undefined ? {} : { viewId }),
    },
  };
}

describe('Assembly canonical source mapping', () => {
  it('uses the artifact view identity required by Assembly apply', () => {
    expect(assemblySourceRefOf(item('artifact', 'artifact-1', 'view-7'))).toEqual({
      kind: 'artifactView',
      id: 'view-7',
    });
  });

  it('preserves non-artifact canonical kinds instead of casting them to artifactView', () => {
    expect(assemblySourceRefOf(item('conversation', 'conversation-2'))).toEqual({
      kind: 'conversation',
      id: 'conversation-2',
    });
    expect(assemblySourceRefOf(item('note', 'note-3'))).toEqual({
      kind: 'note',
      id: 'note-3',
    });
  });
});

describe('Assembly object entry mapping', () => {
  it('opens conversations in the conversation work view', () => {
    expect(assemblyWindowOf(item('conversation', 'conversation-1'))).toBe('conversation');
  });

  it('opens material but never treats scope identities as canvas addresses', () => {
    expect(assemblyWindowOf(item('artifact', 'artifact-1'))).toBe('reader');
    expect(assemblyWindowOf(item('context', 'context-1'))).toBe('unavailable');
    expect(assemblyOpenTargetOf(item('resource', 'resource-1'))).toEqual({ bodyKey: 'unavailable', label: '暂不可打开' });
    expect(assemblyWindowOf(item('collection', 'collection-1'))).toBe('unavailable');
  });

  it('resolves a scene by exact workspace identity and preserves typed canvas target', () => {
    const workspaces = [{ id: 'workspace-1' as Workspace['id'], canvasId: 'actual-canvas' }];
    expect(assemblyOpenTargetOf(item('scene', 'workspace-1'), workspaces)).toEqual({
      bodyKey: 'portal-preview', target: 'actual-canvas', targetKind: 'canvas', label: '预览现场',
    });
    expect(assemblyOpenTargetOf(item('scene', 'actual-canvas'), workspaces).bodyKey).toBe('unavailable');
    expect(assemblyOpenTargetOf(item('scene', 'workspace-1')).bodyKey).toBe('unavailable');
  });

  it('does not treat an opaque preview reference as an image URL', () => {
    expect(previewUrlOf({ ...item('artifact', 'artifact-1'), previewRef: 'preview-ref-1' })).toBeUndefined();
    expect(previewUrlOf({ ...item('artifact', 'artifact-1'), previewRef: 'https://example.test/preview.png' })).toBe('https://example.test/preview.png');
  });
});

describe('Assembly apply outcome layering', () => {
  const item = (
    status: 'applied' | 'skipped' | 'failed',
    channel: 'presentation-membership' | 'already-member' | 'unsupported' | 'error',
    id = 'x-1',
  ) => ({ sourceRef: { kind: 'artifactView' as const, id }, status, channel });

  it('never reports all-success when HTTP 200 carried an unsupported source', () => {
    const summary = describeAssemblyApplyResultV1({
      schemaVersion: 1,
      projectId: 'p1',
      results: [item('applied', 'presentation-membership', 'a-1'), item('skipped', 'unsupported', 's-1')],
      allApplied: true,
    });
    expect(summary.tone).toBe('partial');
    expect(summary.headline).toContain('部分完成');
    expect(summary.lines.map((line) => line.tone)).toEqual(['applied', 'unsupported']);
  });

  it('distinguishes already-member from a plain skip and from a failure', () => {
    const summary = describeAssemblyApplyResultV1({
      schemaVersion: 1,
      projectId: 'p1',
      results: [
        item('skipped', 'already-member', 'a-1'),
        item('failed', 'error', 'b-1'),
      ],
      allApplied: false,
    });
    expect(summary.lines[0]?.tone).toBe('already-member');
    expect(summary.lines[1]?.tone).toBe('failed');
    expect(summary.tone).toBe('failed');
    expect(summary.headline).toContain('投放失败');
  });

  it('treats a fully landed apply as success and keeps the change set id visible', () => {
    const summary = describeAssemblyApplyResultV1({
      schemaVersion: 1,
      projectId: 'p1',
      results: [{ ...item('applied', 'presentation-membership'), changeSetId: 'cs-12345678' }],
      allApplied: true,
    });
    expect(summary.tone).toBe('applied');
    expect(summary.lines[0]?.changeSetId).toBe('cs-12345678');
  });
});