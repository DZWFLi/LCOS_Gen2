// createLcosNodePresentationSeam 测试（happy-dom）：
// resolve 依赖 reference store（binding）；未绑定 → native fallback（undefined）；
// late binding 通知 → 组件重解析（reactive）。

import { beforeEach, describe, expect, it } from 'vitest';

import { useLcosReferenceStore } from '../lcosReferenceState';
import { createLcosNodePresentationSeam } from './createLcosNodePresentationSeam';

const SEAM = createLcosNodePresentationSeam();

beforeEach(() => {
  useLcosReferenceStore.getState().resetNodeEntities();
});

describe('createLcosNodePresentationSeam', () => {
  it('unbound node → undefined（native fallback，诚实）', () => {
    const body = SEAM.resolve({ nodeId: 'n-unknown', nodeType: 'note', data: {} });
    expect(body).toBeUndefined();
  });

  it('conversation binding → glyth body', () => {
    useLcosReferenceStore.getState().registerNodeEntity('n-glyth', {
      entityType: 'conversation',
      entityId: 'c-1',
    });
    const body = SEAM.resolve({ nodeId: 'n-glyth', nodeType: 'note', data: {} });
    expect(typeof body).toBe('function'); // opaque ComponentType
  });

  it('run binding → run body；artifact → source body', () => {
    useLcosReferenceStore.getState().registerNodeEntity('n-run', { entityType: 'run', entityId: 'r-1' });
    useLcosReferenceStore.getState().registerNodeEntity('n-art', { entityType: 'artifact', entityId: 'a-1' });
    expect(SEAM.resolve({ nodeId: 'n-run', nodeType: 'note', data: {} })).toBeDefined();
    expect(SEAM.resolve({ nodeId: 'n-art', nodeType: 'note', data: {} })).toBeDefined();
  });

  it('bizarre entityType binding → native（不静默降级为其它物种）', () => {
    useLcosReferenceStore.getState().registerNodeEntity('n-x', { entityType: 'mystery', entityId: 'x' });
    expect(SEAM.resolve({ nodeId: 'n-x', nodeType: 'note', data: {} })).toBeUndefined();
  });

  it('subscribe 在 store 变更时通知（late binding 原位换 body）', () => {
    let notified = 0;
    const unsubscribe = SEAM.subscribe(() => {
      notified += 1;
    });
    useLcosReferenceStore.getState().registerNodeEntity('n-late', { entityType: 'conversation', entityId: 'c-late' });
    expect(notified).toBeGreaterThan(0);
    unsubscribe();
    const before = notified;
    useLcosReferenceStore.getState().registerNodeEntity('n-late-2', { entityType: 'run', entityId: 'r-late' });
    expect(notified).toBe(before);
  });
});