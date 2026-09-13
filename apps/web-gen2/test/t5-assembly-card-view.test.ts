// 背景阅读交付 3/3 切片：assemblyCardView 纯 mapper 测试。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';
import { assemblyCardViewV1 } from '../src/lcos/assembly/assemblyCardView.js';

function item(overrides: Partial<WarehouseItemV1> = {}): WarehouseItemV1 {
  return {
    schemaVersion: 1,
    entityRef: { type: 'artifact', id: 'art-1', viewId: 'view-1' },
    kind: 'artifact',
    title: '项目定位',
    usageCount: 2,
    ...overrides,
  };
}

test('artifact → artifact 物种，refEntityType=artifact，可提交', () => {
  const view = assemblyCardViewV1(item(), new Set());
  assert.equal(view.species, 'artifact');
  assert.equal(view.refEntityType, 'artifact');
  assert.equal(view.submittable, true);
  assert.equal(view.referenceKey, 'assembly:artifact:art-1');
  assert.equal(view.referenced, false);
});

test('workflow/collection/context（scope）→ refEntityType=scope，可提交；scene → workspace', () => {
  const workflow = assemblyCardViewV1(item({ kind: 'workflow', entityRef: { type: 'workflow', id: 'wf-1' }, title: '竞品收集', usageCount: 0 }), new Set());
  assert.equal(workflow.species, 'workflow');
  assert.equal(workflow.refEntityType, 'scope');
  assert.equal(workflow.submittable, true);

  const collection = assemblyCardViewV1(item({ kind: 'collection', entityRef: { type: 'collection', id: 'col-1' }, title: '山野研究', usageCount: 0 }), new Set());
  assert.equal(collection.species, 'collection');
  assert.equal(collection.refEntityType, 'scope');

  const scene = assemblyCardViewV1(item({ kind: 'scene', entityRef: { type: 'scene', id: 'ws-1' }, title: 'Main', usageCount: 0 }), new Set());
  assert.equal(scene.species, 'scene');
  assert.equal(scene.refEntityType, 'workspace');
});

test('note/resource 不可提交（F6B 裁决），referenceKey 仍稳定', () => {
  const note = assemblyCardViewV1(item({ kind: 'note', entityRef: { type: 'note', id: 'n-1' }, title: '一条笔记', usageCount: 0 }), new Set());
  assert.equal(note.submittable, false);
  assert.equal(note.referenceKey, 'assembly:note:n-1');
  const resource = assemblyCardViewV1(item({ kind: 'resource', entityRef: { type: 'resource', id: 'r-1' }, title: '来源', usageCount: 0 }), new Set());
  assert.equal(resource.submittable, false);
});

test('referenced 由传入键集判定', () => {
  const view = assemblyCardViewV1(item(), new Set(['assembly:artifact:art-1']));
  assert.equal(view.referenced, true);
});

test('artifact 副标题按 provenance 分流，run-return 显示来源', () => {
  const fromRun = assemblyCardViewV1(item({ provenance: { origin: 'run-return', birthRunId: 'run-1' } }), new Set());
  assert.equal(fromRun.subtitle, '来自 Run 产出');
  const imported = assemblyCardViewV1(item({ provenance: { origin: 'import' } }), new Set());
  assert.equal(imported.subtitle, '导入');
});
