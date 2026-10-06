import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetTemporalPreviewForTests, useTemporalPreviewStore } from './temporalPreviewState';
import { TemporalRail } from './TemporalRail';

import type { LcosNodeEntityRef } from '../../lcosReferenceState';
import type { TemporalIndexV1 } from '@local-creative-os/contracts';

const mocks = vi.hoisted(() => ({
  getIndex: vi.fn(),
  requestLocate: vi.fn(),
  bindings: { bindingCanvasId: 'canvas-a' as string | null, nodeEntityRefs: new Map<string, LcosNodeEntityRef>() },
}));
vi.mock('../../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ temporal: { getIndex: mocks.getIndex } }) }));
vi.mock('../../lcosReferenceState', () => ({ useLcosReferenceStore: (select: (state: typeof mocks.bindings) => unknown) => select(mocks.bindings) }));
vi.mock('../../shell/lcosShellStore', () => ({ useLcosShellStore: { getState: () => ({ requestLocate: mocks.requestLocate }) } }));

// Unit-test input only: no persisted scope, workspace, canvas or temporal facts.
const index: TemporalIndexV1 = {
  schemaVersion: 1, projectId: 'project', workspaceId: 'child', scopeId: 'scope-child', source: 'canonical_durable_records',
  facts: [{ id: 'fact-a', kind: 'artifact.created', occurredAt: '2026-09-01T00:00:00.000Z', targets: [{ type: 'artifact', id: 'artifact-a' }] }],
  far: [], mid: [{ id: 'group-a', level: 'mid', start: '2026-09-01T00:00:00.000Z', end: '2026-09-01T00:01:00.000Z', eventIds: ['fact-a'], eventCount: 1, targets: [{ type: 'artifact', id: 'artifact-a' }, { type: 'note', id: 'note-missing' }] }],
  omissions: ['conversation_timeline_unscoped', 'project_event_hub_ephemeral'],
};
let host: HTMLDivElement;
let root: Root;
function item(): HTMLButtonElement {
  const result = host.querySelector<HTMLButtonElement>('[data-temporal-item="group-a"]');
  if (!result) throw new Error('Expected real TemporalRailView group button');
  return result;
}
async function render(canvasId: string | undefined = 'canvas-a', workspaceId: string | undefined = 'child'): Promise<void> {
  await act(async () => root.render(<TemporalRail projectId="project" {...(workspaceId === undefined ? {} : { workspaceId })} {...(canvasId === undefined ? {} : { canvasId })} />));
}
beforeEach(() => {
  mocks.getIndex.mockReset().mockResolvedValue({ ok: true, value: index });
  mocks.requestLocate.mockReset();
  mocks.bindings = { bindingCanvasId: 'canvas-a', nodeEntityRefs: new Map() };
  resetTemporalPreviewForTests();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); resetTemporalPreviewForTests(); });

describe('TemporalRail current-canvas continuity', () => {
  it('explains durable records without projected targets and becomes usable when real bindings arrive', async () => {
    await render();
    expect(item().disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('1 组时间记录的目标尚未投影到当前现场');
    await act(async () => item().click());
    expect(mocks.requestLocate).not.toHaveBeenCalled();
    mocks.bindings.nodeEntityRefs = new Map([['node-a', { entityType: 'artifact', entityId: 'artifact-a' }]]);
    await render();
    expect(item().disabled).toBe(false);
    expect(host.textContent).not.toContain('1 组时间记录的目标尚未投影');
    await act(async () => item().click());
    expect(mocks.requestLocate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ canvasId: 'canvas-a', nodeIds: ['node-a'], surface: 'context' }));
  });

  it('clears old hover and refuses old canvas node ids during recovery of the same child', async () => {
    mocks.bindings.nodeEntityRefs = new Map([['node-a', { entityType: 'artifact', entityId: 'artifact-a' }]]);
    await render();
    await act(async () => item().focus());
    expect(item().dataset.preview).toBe('true');
    expect(useTemporalPreviewStore.getState()).toMatchObject({ canvasId: 'canvas-a', nodeIds: ['node-a'] });
    await render('canvas-b');
    expect(item().disabled).toBe(true);
    expect(item().dataset.preview).toBeUndefined();
    expect(useTemporalPreviewStore.getState()).toMatchObject({ canvasId: null, nodeIds: [] });
    expect(host.textContent).toContain('当前现场的对象绑定尚未就绪');
    await act(async () => item().click());
    expect(mocks.requestLocate).not.toHaveBeenCalled();
    mocks.bindings = { bindingCanvasId: 'canvas-b', nodeEntityRefs: new Map([['node-b', { entityType: 'artifact', entityId: 'artifact-a' }]]) };
    await render('canvas-b');
    expect(item().disabled).toBe(false);
    await act(async () => item().dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(useTemporalPreviewStore.getState()).toMatchObject({ canvasId: 'canvas-b', nodeIds: ['node-b'] });
    await act(async () => item().click());
    expect(mocks.requestLocate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ canvasId: 'canvas-b', nodeIds: ['node-b'] }));
  });

  it('retires a same-canvas hover when its bound node changes or disappears', async () => {
    mocks.bindings.nodeEntityRefs = new Map([['node-a', { entityType: 'artifact', entityId: 'artifact-a' }]]);
    await render();
    await act(async () => item().dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(useTemporalPreviewStore.getState().nodeIds).toEqual(['node-a']);
    mocks.bindings.nodeEntityRefs = new Map([['node-b', { entityType: 'artifact', entityId: 'artifact-a' }]]);
    await render();
    expect(item().disabled).toBe(false);
    expect(item().dataset.preview).toBeUndefined();
    expect(useTemporalPreviewStore.getState().nodeIds).toEqual([]);
    await act(async () => item().dispatchEvent(new PointerEvent('pointerover', { bubbles: true })));
    expect(useTemporalPreviewStore.getState().nodeIds).toEqual(['node-b']);
    mocks.bindings.nodeEntityRefs = new Map();
    await render();
    expect(item().disabled).toBe(true);
    expect(item().dataset.preview).toBeUndefined();
    expect(useTemporalPreviewStore.getState().nodeIds).toEqual([]);
    expect(mocks.requestLocate).not.toHaveBeenCalled();
  });

  it('drops the previous partial-activation message when the child address disappears', async () => {
    mocks.bindings.nodeEntityRefs = new Map([['node-a', { entityType: 'artifact', entityId: 'artifact-a' }]]);
    await render();
    await act(async () => item().click());
    expect(host.textContent).toContain('已定位 1/2');
    await act(async () => root.render(<TemporalRail projectId="project" />));
    expect(host.querySelector('[data-lcos-temporal-rail]')).toBeNull();
    expect(host.textContent).not.toContain('已定位');
    expect(host.querySelector('[data-temporal-item]')).toBeNull();
  });
});
