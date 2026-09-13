import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveNodeSpecies,
  resolveNodeSpeciesFromEntityType,
  NODE_SPECIES_LABEL,
} from '../src/presentation/nodeSpecies.js';

describe('resolveNodeSpecies', () => {
  it('conversation → glyth（活得身份，不是 chat badge）', () => {
    assert.equal(resolveNodeSpecies({ entityType: 'conversation' }), 'glyth');
  });

  it('run → run；skill → source（可复用材料）', () => {
    assert.equal(resolveNodeSpecies({ entityType: 'run' }), 'run');
    assert.equal(resolveNodeSpecies({ entityType: 'skill' }), 'source');
  });

  it('managed AI 输出（sourceRunId+managed）→ draft，绝不冒充 source/current', () => {
    assert.equal(
      resolveNodeSpecies({ entityType: 'artifact', sourceRunId: 'run-1', managed: true }),
      'draft',
    );
  });

  it('kind 决定 container/决策/prompt 物种', () => {
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', artifactKind: 'collection' }), 'collection');
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', artifactKind: 'workflow' }), 'workflow-collection');
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', artifactKind: 'portal' }), 'portal');
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', artifactKind: 'decision' }), 'decision');
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', artifactKind: 'question' }), 'prompt-frame');
  });

  it('reference 语义 → context-reference', () => {
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', artifactKind: 'reference' }), 'context-reference');
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', sourceKind: 'context' }), 'context-reference');
  });

  it('内容族（kind/mime/url/file）→ source', () => {
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', artifactKind: 'pdf' }), 'source');
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', mimeType: 'image/png' }), 'source');
    assert.equal(resolveNodeSpecies({ entityType: 'artifact', sourceKind: 'url' }), 'source');
  });

  it('无信号 → unknown（不静默降级）', () => {
    assert.equal(resolveNodeSpecies({}), 'unknown');
    assert.equal(resolveNodeSpecies({ entityType: 'mystery' }), 'unknown');
  });

  it('fromEntityType 覆盖全部已知 entityType', () => {
    assert.equal(resolveNodeSpeciesFromEntityType('conversation'), 'glyth');
    assert.equal(resolveNodeSpeciesFromEntityType('run'), 'run');
    assert.equal(resolveNodeSpeciesFromEntityType('artifact'), 'source');
    assert.equal(resolveNodeSpeciesFromEntityType(undefined), 'unknown');
  });

  it('全部物种都有标签', () => {
    for (const key of Object.keys(NODE_SPECIES_LABEL)) {
      assert.ok(NODE_SPECIES_LABEL[key as keyof typeof NODE_SPECIES_LABEL].length > 0, key);
    }
  });
});