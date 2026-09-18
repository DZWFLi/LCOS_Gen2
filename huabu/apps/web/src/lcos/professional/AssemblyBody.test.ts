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
    changeSetId?: string,
  ) => ({
    sourceRef: { kind: 'artifactView' as const, id },
    status,
    channel,
    ...(changeSetId === undefined ? {} : { changeSetId }),
  });

  const summarize = (
    results: ReadonlyArray<ReturnType<typeof item>>,
    allApplied = true,
  ) => describeAssemblyApplyResultV1({ schemaVersion: 1, projectId: 'p1', results, allApplied });

  it('reports a full landing as applied and keeps the change set id visible', () => {
    const summary = summarize([item('applied', 'presentation-membership', 'a-1', 'cs-12345678')]);
    expect(summary.tone).toBe('applied');
    expect(summary.lines[0]?.changeSetId).toBe('cs-12345678');
    expect(summary.headline).toContain('全部成功');
  });

  it('never claims success when HTTP 200 carried an unsupported source', () => {
    const summary = summarize([
      item('applied', 'presentation-membership', 'a-1'),
      item('skipped', 'unsupported', 's-1'),
    ]);
    expect(summary.tone).toBe('partial');
    expect(summary.headline).not.toContain('全部成功');
    expect(summary.counts.applied).toBe(1);
    expect(summary.counts.unsupported).toBe(1);
    expect(summary.lines.map((line) => line.tone)).toEqual(['applied', 'unsupported']);
  });

  it('does not call an all-already-member apply a success', () => {
    const summary = summarize([item('skipped', 'already-member', 'a-1'), item('skipped', 'already-member', 'b-1')]);
    expect(summary.tone).toBe('already-present');
    expect(summary.tone).not.toBe('applied');
    expect(summary.headline).toContain('没有新增变更');
  });

  it('does not call an all-skipped apply a success', () => {
    const summary = summarize([item('skipped', 'presentation-membership', 'a-1')]);
    expect(summary.tone).toBe('skipped');
    expect(summary.headline).toContain('没有来源落地');
  });

  it('reports an all-unsupported apply as truthful unsupported', () => {
    const summary = summarize([item('skipped', 'unsupported', 'a-1')]);
    expect(summary.tone).toBe('unsupported');
    expect(summary.headline).toContain('不支持');
    expect(summary.headline).not.toContain('全部成功');
  });

  it('treats applied + already-member as partial (applied-with-skip)', () => {
    const summary = summarize([
      item('applied', 'presentation-membership', 'a-1'),
      item('skipped', 'already-member', 'b-1'),
    ]);
    expect(summary.tone).toBe('partial');
    expect(summary.headline).not.toContain('全部成功');
    expect(summary.headline).toContain('已在目标中 1');
  });

  it('distinguishes a failure with no landing from a partial landing', () => {
    const failed = summarize([item('skipped', 'already-member', 'a-1'), item('failed', 'error', 'b-1')], false);
    expect(failed.tone).toBe('failed');
    expect(failed.headline).toContain('投放失败');

    const partial = summarize([item('applied', 'presentation-membership', 'a-1'), item('failed', 'error', 'b-1')], false);
    expect(partial.tone).toBe('partial');
    expect(partial.headline).toContain('1 项落地');
  });

  it('never reports success for an empty result set', () => {
    const summary = summarize([]);
    expect(summary.tone).not.toBe('applied');
    expect(summary.headline).toContain('没有可投放的来源');
  });
});