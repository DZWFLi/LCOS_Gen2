

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ delegate: vi.fn(), send: vi.fn(), refresh: vi.fn(), retry: vi.fn() }));
vi.mock('@local-creative-os/web-gen2', async (importOriginal) => ({
  ...await importOriginal<typeof WebGen2>(),
  CoreCollaborationClient: class { delegate = mocks.delegate; send = mocks.send; },
}));
vi.mock('../app/lcosCoreClient', () => ({ createLcosCoreSession: () => ({ http: {} }) }));
vi.mock('./useComposerContinuation', () => ({ useComposerContinuation: () => ({ blockedReason: undefined, retry: mocks.retry, error: false }) }));
vi.mock('../collaboration/useCollaborationSession', () => ({
  useCollaborationSession: () => ({ status: 'ready', projection: { userState: 'ready', capabilities: { canResume: true, canBlankNew: true, canSelectedContext: true, canFork: false } } }),
}));
vi.mock('../collaboration/collaborationSessionStore', () => ({ useCollaborationSessionStore: { getState: () => ({ refresh: mocks.refresh }) } }));

import { LcosComposerHost } from './LcosComposerHost';
import { useLcosDropStore } from '../lcosDropState';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore, type LcosComposerTarget } from '../shell/lcosShellStore';

import type * as WebGen2 from '@local-creative-os/web-gen2';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let el: HTMLDivElement;
const target = (id: string): LcosComposerTarget => ({ nodeId: id, title: id, anchor: { x: 10, y: 10, width: 100, height: 100 } });
const accepted = { ok: true, receipt: { command: 'delegate', runId: 'actual-run' } };
beforeEach(() => { mocks.delegate.mockReset(); mocks.send.mockReset(); useLcosShellStore.getState().clear(); useLcosReferenceStore.getState().reset(); useLcosDropStore.getState().reset(); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });
async function mount(next = target('a')) {
  const shell = useLcosShellStore.getState(); shell.setProject('project'); shell.openComposer(next); shell.setComposerPrompt('原始输入');
  useLcosReferenceStore.getState().setProject('project');
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  await act(async () => root!.render(<LcosComposerHost projectId="project" workspaceId="workspace" anchor={null} inline open onClose={() => {}} />));
}
function submitKey() { el.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); }

it('blocks two submit shortcuts in the same event turn', async () => {
  let finish!: (value: unknown) => void;
  mocks.delegate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount();
  await act(async () => { submitKey(); submitKey(); });
  expect(mocks.delegate).toHaveBeenCalledTimes(1);
  await act(async () => finish(accepted));
  expect(el.textContent).toContain('任务已创建');
  expect(useLcosShellStore.getState().composerPrompt).toBe('');
});

it.each(['success', 'failure'])('does not put an old receiver %s into the new draft', async (outcome) => {
  let finish!: (value: unknown) => void;
  mocks.delegate.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  await mount(); await act(async () => submitKey());
  await act(async () => {
    useLcosShellStore.getState().openComposer(target('b'));
    useLcosShellStore.getState().setComposerPrompt('新目标草稿');
  });
  await act(async () => finish(outcome === 'success' ? accepted : { ok: false, error: { userMessage: '旧目标的错误' } }));
  expect(useLcosShellStore.getState().composerPrompt).toBe('新目标草稿');
  expect(el.textContent).not.toContain('旧目标的错误');
  expect(el.textContent).not.toContain('任务已创建');
  expect(el.querySelector('[data-lcos-composer]')?.getAttribute('data-ui-state')).toBe('editing');
});

it('mounts continuation choices inside the same Composer without creating a window or sending', async () => {
  await mount({ ...target('a'), intent: 'continue', receiverConversationId: 'conversation', continuationOperationId: 'operation', messageId: 'message' });
  expect(el.querySelectorAll('[data-lcos-composer]')).toHaveLength(1);
  const toggle = el.querySelector<HTMLButtonElement>('.lcos-continuation-toggle');
  expect(toggle).not.toBeNull();
  await act(async () => toggle!.click());
  expect(el.querySelectorAll('fieldset input[type="radio"]')).toHaveLength(4);
  expect(el.querySelector<HTMLInputElement>('input[value="continue_existing"]')?.checked).toBe(true);
  expect(el.querySelector('textarea')?.value).toBe('原始输入');
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.delegate).not.toHaveBeenCalled();
});

it('does not submit a visible draft when the reference owner belongs to another project', async () => {
  await mount();
  await act(async () => useLcosReferenceStore.getState().setProject('other-project'));
  await act(async () => submitKey());
  expect(mocks.delegate).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(useLcosShellStore.getState().composerPrompt).toBe('原始输入');
});


it('accepts a carried reference over the strip and editor, but not the receiver heading, and follows live geometry', async () => {
  let shifted = 0;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-lcos-composer-reference-surface')) return new DOMRect(200 + shifted, 200, 300, 160);
    if (this.tagName === 'TEXTAREA') return new DOMRect(210 + shifted, 240, 280, 60);
    return new DOMRect(200 + shifted, 150, 300, 45);
  });
  await mount();
  const drop = useLcosDropStore.getState();
  expect(drop.targetAt({ x: 220, y: 210 })?.kind).toBe('composer-reference');
  expect(drop.targetAt({ x: 220, y: 270 })?.kind).toBe('composer-reference');
  expect(drop.targetAt({ x: 220, y: 170 })).toBeUndefined();
  await act(async () => drop.begin({ kind: 'object', entityType: 'artifact', entityId: 'material' }));
  expect(el.querySelector('[data-lcos-composer]')).not.toBeNull();
  expect(drop.targetAt({ x: 220, y: 210 })?.kind).toBe('composer-reference');
  shifted = 400;
  expect(drop.targetAt({ x: 220, y: 210 })).toBeUndefined();
  expect(drop.targetAt({ x: 620, y: 210 })?.kind).toBe('composer-reference');
  await act(async () => root!.unmount()); root = undefined;
  expect(drop.targetAt({ x: 620, y: 210 })).toBeUndefined();
});


it('shows the real bound title for a bare carried reference without changing its submitted identity', async () => {
  await mount();
  await act(async () => {
    const references = useLcosReferenceStore.getState();
    references.registerNodeEntity('source-node', { entityType: 'artifact', entityId: 'material', descriptor: { title: '施工纪律', secondaryLine: '', species: 'source', entityType: 'artifact', entityId: 'material' } });
    references.addEntityToDraft({ entityType: 'artifact', entityId: 'material' });
  });
  expect(el.querySelector('.lcos-composer-reference-label')?.textContent).toBe('施工纪律');
  expect(useLcosReferenceStore.getState().draft.orderedEntityRefs).toEqual([{ entityType: 'artifact', entityId: 'material' }]);
});
