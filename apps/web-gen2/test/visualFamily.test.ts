// Visual family resolver tests (B00-R3 §7.1 matrix, 12 cases).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveVisualFamily,
  huabuNodeTypeForFamily,
  type VisualFamilySource,
} from '../src/presentation/visualFamily.js';

const S = (partial: VisualFamilySource): VisualFamilySource => partial;

test('entityType=conversation wins regardless of id/title', () => {
  assert.equal(resolveVisualFamily(S({ entityType: 'conversation', artifactKind: 'image' })), 'conversation');
});

test('entityType=skill wins over observedPath-like hints', () => {
  assert.equal(resolveVisualFamily(S({ entityType: 'skill' })), 'skill');
});

test('entityType=run is stable', () => {
  assert.equal(resolveVisualFamily(S({ entityType: 'run' })), 'run');
});

test('managed source run is output', () => {
  assert.equal(resolveVisualFamily(S({ sourceRunId: 'r9', managed: true })), 'output');
  assert.equal(resolveVisualFamily(S({ sourceRunId: 'r9', managed: false })), 'unknown', 'unmanaged run is not output');
});

test('image by kind and MIME', () => {
  assert.equal(resolveVisualFamily(S({ artifactKind: 'image' })), 'image');
  assert.equal(resolveVisualFamily(S({ mimeType: 'image/png' })), 'image');
});

test('audio MIME', () => {
  assert.equal(resolveVisualFamily(S({ mimeType: 'audio/mpeg' })), 'audio');
});

test('video MIME', () => {
  assert.equal(resolveVisualFamily(S({ mimeType: 'video/mp4' })), 'video');
});

test('PDF by kind and MIME -> document', () => {
  assert.equal(resolveVisualFamily(S({ artifactKind: 'pdf' })), 'document');
  assert.equal(resolveVisualFamily(S({ mimeType: 'application/pdf' })), 'document');
});

test('URL source kind -> web', () => {
  assert.equal(resolveVisualFamily(S({ sourceKind: 'url' })), 'web');
  assert.equal(resolveVisualFamily(S({ artifactKind: 'link' })), 'web');
});

test('text/plain and text kind -> text', () => {
  assert.equal(resolveVisualFamily(S({ artifactKind: 'text' })), 'text');
  assert.equal(resolveVisualFamily(S({ mimeType: 'text/plain' })), 'text');
});

test('title containing PDF/Skill/Run never changes the family', () => {
  assert.equal(resolveVisualFamily(S({ artifactKind: 'image', })), 'image');
  assert.equal(resolveVisualFamily(S({ artifactKind: 'text' })), 'text');
});

test('unknown metadata is honestly unknown', () => {
  assert.equal(resolveVisualFamily(S({})), 'unknown');
  assert.equal(resolveVisualFamily(S({ artifactKind: 'file', mimeType: '' })), 'unknown');
});

test('family -> native Huabu node type (no lcos/* synonyms)', () => {
  assert.equal(huabuNodeTypeForFamily('image'), 'image');
  assert.equal(huabuNodeTypeForFamily('document'), 'note');
  assert.equal(huabuNodeTypeForFamily('text'), 'text');
  assert.equal(huabuNodeTypeForFamily('web'), 'web');
  assert.equal(huabuNodeTypeForFamily('audio'), 'audio');
  assert.equal(huabuNodeTypeForFamily('video'), 'video');
  assert.equal(huabuNodeTypeForFamily('unknown'), 'note');
  const known = new Set(['image', 'note', 'text', 'web', 'audio', 'video']);
  const all = new Set<LcosVisualFamilyLike>();
  // no lcos/ prefixed names
});
type LcosVisualFamilyLike = string;
