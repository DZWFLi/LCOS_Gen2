import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { occurrenceRowLabel } from '../src/navigation/occurrenceLabel.js';

describe('occurrenceRowLabel', () => {
  it('surface only when workspace name missing', () => {
    assert.equal(occurrenceRowLabel({ surface: 'context' }), 'Context');
    assert.equal(occurrenceRowLabel({}), '画布');
  });

  it('joins surface and workspace name', () => {
    assert.equal(
      occurrenceRowLabel({ surface: 'main', workspaceName: '项目主现场' }),
      'Main · 项目主现场',
    );
  });

  it('does not duplicate surface prefix already present in name', () => {
    assert.equal(
      occurrenceRowLabel({ surface: 'context', workspaceName: 'Context · 材料' }),
      'Context · 材料',
    );
    assert.equal(
      occurrenceRowLabel({ surface: 'workflow', workspaceName: 'Workflow·B链' }),
      'Workflow·B链',
    );
    assert.equal(occurrenceRowLabel({ surface: 'main', workspaceName: 'Main' }), 'Main');
  });

  it('falls back to raw surface value for unknown surfaces', () => {
    assert.equal(occurrenceRowLabel({ surface: 'side', workspaceName: '侧栏' }), 'side · 侧栏');
  });
});