import { describe, expect, it } from 'vitest';

import { isWorkflowCardItem } from './workflowCardSemantics';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';

function item(kind: WarehouseItemV1['kind']): WarehouseItemV1 {
  return {
    schemaVersion: 1,
    entityRef: { type: kind, id: `${kind}-1` },
    kind,
    title: kind,
    usageCount: 0,
  };
}

describe('Workflow card pool UX semantics', () => {
  it('only admits workflow entities as task cards', () => {
    expect(isWorkflowCardItem(item('workflow'))).toBe(true);
    expect(isWorkflowCardItem(item('artifact'))).toBe(false);
    expect(isWorkflowCardItem(item('conversation'))).toBe(false);
  });
});
