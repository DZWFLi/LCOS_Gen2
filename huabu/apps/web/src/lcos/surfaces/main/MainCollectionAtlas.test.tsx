// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { MainCollectionAtlas } from './MainCollectionAtlas';

import type { WarehouseItemV1 } from '@local-creative-os/contracts';

const m = vi.hoisted(() => ({ close: vi.fn(), locate: vi.fn(), openReader: vi.fn(), projectId: 'p', referenceProjectId: 'p',
  refs: new Map([
    ['collection-node', { entityType: 'collection', entityId: 'collection-1' }],
    ['artifact-node', { entityType: 'artifact', entityId: 'artifact-positioning' }],
  ]),
  collection: { schemaVersion: 1, kind: 'collection', title: '项目集合', usageCount: 0, entityRef: { type: 'collection', id: 'collection-1' } } as WarehouseItemV1,
  scene: { schemaVersion: 1, kind: 'scene', title: '目标现场', usageCount: 0, entityRef: { type: 'scene', id: 'collection-1' } } as WarehouseItemV1,
  member: { type: 'artifact', id: 'artifact-positioning', label: '项目定位', kind: 'text', availability: 'available', revisionId: 'revision-positioning' },
}));
vi.mock('../../lcosReferenceState', () => ({ useLcosReferenceStore: { getState: () => ({ projectId: m.referenceProjectId, nodeEntityRefs: m.refs }) } }));
vi.mock('../../shell/lcosShellStore', () => ({ useLcosShellStore: { getState: () => ({ projectId: m.projectId, requestLocate: m.locate, openReader: m.openReader }) } }));
vi.mock('@/store/canvasStore', () => ({ default: { getState: () => ({ canvasId: 'main-canvas' }) } }));
vi.mock('../context/ContextAtlasStage', () => ({ ContextAtlasStage: ({ mode, onEnterSurface, onReadMember }: { mode: string; onEnterSurface: (item: WarehouseItemV1) => boolean; onReadMember?: (collectionId: string, member: never) => void }) => <div data-mode={mode}>
  <button onClick={() => onEnterSurface(m.collection)}>定位集合</button>
  <button onClick={() => onEnterSurface(m.scene)}>误传现场</button>
  <button data-read-member onClick={() => onReadMember?.('collection-1', m.member as never)}>阅读现有成员</button>
</div> }));
const roots: ReturnType<typeof createRoot>[] = [];
beforeEach(() => {
  m.refs = new Map([
    ['collection-node', { entityType: 'collection', entityId: 'collection-1' }],
    ['artifact-node', { entityType: 'artifact', entityId: 'artifact-positioning' }],
  ]);
  m.projectId = 'p'; m.referenceProjectId = 'p';
});
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); vi.resetAllMocks(); });

it('projects canonical Collections and locates them in the current Main canvas without worksite navigation', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<MainCollectionAtlas projectId="p" onClose={m.close} />));
  expect(host.querySelector('[data-mode="main-collections"]')).not.toBeNull();
  await act(async () => host.querySelectorAll('button')[0]?.click());
  expect(m.locate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ surface: 'main', canvasId: 'main-canvas', nodeId: 'collection-node', preserveSelection: true, status: 'projected' }));
  expect(m.close).toHaveBeenCalledOnce();
  await act(async () => host.querySelectorAll('button')[1]?.click());
  expect(m.locate).toHaveBeenCalledOnce();
});

it('keeps the overview open when a real Collection has no current projection', async () => {
  m.refs.clear();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<MainCollectionAtlas projectId="p" onClose={m.close} />));
  await act(async () => host.querySelectorAll('button')[0]?.click());
  expect(m.locate).not.toHaveBeenCalled(); expect(m.close).not.toHaveBeenCalled();
});

it('opens the exact available Artifact revision through Shell Reader with its projected Artifact as source', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<MainCollectionAtlas projectId="p" onClose={m.close} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-read-member]')?.click());
  expect(m.openReader).toHaveBeenCalledExactlyOnceWith('项目定位', 'artifact-positioning', {
    revisionId: 'revision-positioning', source: { surface: 'main', nodeId: 'artifact-node' },
  });
  expect(m.close).not.toHaveBeenCalled();
});

it('does not claim the Collection as the Reader source when the exact Artifact has no projection', async () => {
  m.refs = new Map([['collection-node', { entityType: 'collection', entityId: 'collection-1' }]]);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<MainCollectionAtlas projectId="p" onClose={m.close} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-read-member]')?.click());
  expect(m.openReader).toHaveBeenCalledExactlyOnceWith('项目定位', 'artifact-positioning', { revisionId: 'revision-positioning' });
});
