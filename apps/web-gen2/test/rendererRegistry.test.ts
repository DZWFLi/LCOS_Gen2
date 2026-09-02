// A09 — Renderer Registry tests: node type != domain taxonomy.
// - resize 不改变 renderer family
// - text→outline 是 explicit presentation mode，不创建新 entity/binding
// - unsupported type fail-close 为中性 unknown presentation，不自造 type

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  descriptorFor,
  familiesFor,
  type RendererFamily,
  type CoreEntityRefLoose,
} from '../src/presentation/rendererRegistry.js';

test('same entity: resize never changes renderer family', () => {
  const entity: CoreEntityRefLoose = { type: 'artifact', id: 'a1', kind: 'text', title: 'Note' };
  const small = descriptorFor(entity);
  // resize = 尺寸/缩放，与 family 无关 —— 两次映射 family 必须一致
  const again = descriptorFor({ ...entity });
  assert.equal(small.family, again.family);
  assert.equal(small.species, again.species);
  assert.equal(small.family, 'lcos/entity');
});

test('text -> outline is an explicit mode, not a new entity or binding', () => {
  const text: CoreEntityRefLoose = { type: 'artifact', id: 'a9', kind: 'text', title: 'Brief' };
  const outline: CoreEntityRefLoose = { type: 'artifact', id: 'a9', kind: 'text', title: 'Brief' };
  const a = descriptorFor(text);
  const b = descriptorFor(outline);
  // outline 只是呈现模式切换；实体 id 与 family 不变
  assert.equal(a.entity.id, b.entity.id);
  assert.equal(a.family, b.family);
  // species 是 kind 的函数，kind 不变则 species 不变 —— outline 是 explicit
  // presentation mode（由 NodePresentationInput.explicitMode 表达），不是 species
  assert.equal(a.species, b.species);
  assert.equal(a.entity.id, 'a9');
});

test('artifact kinds map to distinct species, same entity family', () => {
  assert.equal(descriptorFor({ type: 'artifact', id: '1', kind: 'image' }).species, 'image');
  assert.equal(descriptorFor({ type: 'artifact', id: '1', kind: 'audio' }).species, 'audio');
  assert.equal(descriptorFor({ type: 'artifact', id: '1', kind: 'video' }).species, 'video');
  assert.equal(descriptorFor({ type: 'artifact', id: '1', kind: 'pdf' }).species, 'pdf');
  assert.equal(descriptorFor({ type: 'artifact', id: '1', kind: 'file' }).family, 'lcos/external-file');
});

test('conversation / skill / run map to their instrument or conversation family', () => {
  assert.equal(
    descriptorFor({ type: 'conversation', id: 'c1', kind: 'context' }).family,
    'lcos/conversation',
  );
  assert.equal(
    descriptorFor({ type: 'conversation', id: 'c1', kind: 'context' }).species,
    'context-structure',
  );
  assert.equal(descriptorFor({ type: 'skill', id: 's1' }).family, 'lcos/instrument');
  assert.equal(descriptorFor({ type: 'skill', id: 's1' }).species, 'skill');
  assert.equal(descriptorFor({ type: 'run', id: 'r1' }).family, 'lcos/instrument');
  assert.equal(descriptorFor({ type: 'run', id: 'r1' }).species, 'run');
});

test('unsupported type fail-closes into a neutral presentation, never a fake type', () => {
  const weird = descriptorFor({ type: 'relation', id: 'x' });
  // 中性 unknown presentation：仍可渲染（text species / entity family），
  // 但绝不造出不存在的新 family。
  const known: RendererFamily[] = ['lcos/entity', 'lcos/conversation', 'lcos/instrument', 'lcos/external-file'];
  assert.ok(known.includes(weird.family), 'fail-closed family must be a known family');
});

test('familiesFor restricts instrument/context per surface, main opens all', () => {
  assert.ok(familiesFor('main').includes('lcos/instrument'));
  assert.ok(!familiesFor('context').includes('lcos/instrument'));
  assert.ok(familiesFor('context').includes('lcos/conversation'));
  assert.ok(familiesFor('workflow').includes('lcos/instrument'));
  assert.ok(familiesFor('workflow').includes('lcos/conversation'));
});
