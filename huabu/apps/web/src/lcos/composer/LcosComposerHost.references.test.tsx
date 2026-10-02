import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';

import { LcosComposerHost } from './LcosComposerHost';
import { useLcosReferenceStore } from '../lcosReferenceState';
import { useLcosShellStore } from '../shell/lcosShellStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  useLcosReferenceStore.getState().reset();
  useLcosShellStore.getState().clear();
});
it('removes one explicit reference through the real Composer without deleting its binding or other references', async () => {
  const refs = useLcosReferenceStore.getState();
  refs.setProject('project-a');
  const first = { entityType: 'artifact', entityId: 'a', displayLabel: '照片 A' };
  const second = { entityType: 'artifact', entityId: 'b', displayLabel: '照片 B' };
  refs.registerNodeEntity('node-a', first);
  refs.addEntityToDraft(first);
  refs.addEntityToDraft(second);
  useLcosShellStore.getState().setComposerPrompt('继续保留这段输入');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<LcosComposerHost projectId="project-a" workspaceId="workspace-a" anchor={null} open inline onClose={() => {}} />));
  const remove = host.querySelector<HTMLButtonElement>('[aria-label="移除引用 照片 A"]');
  expect(remove).not.toBeNull();
  await act(async () => remove!.click());
  expect(useLcosReferenceStore.getState().draft.orderedEntityRefs.map(ref => ref.entityId)).toEqual(['b']);
  expect(useLcosReferenceStore.getState().nodeEntityRefs.get('node-a')).toEqual(first);
  expect(useLcosShellStore.getState().composerPrompt).toBe('继续保留这段输入');
  expect(host.querySelectorAll('[data-lcos-composer-ref]')).toHaveLength(1);
});


it('Escape leaves canvas pick first, preserving Composer, prompt and explicit references', async () => {
  const state = useLcosReferenceStore.getState(); state.setProject('project-a'); state.addEntityToDraft({ entityType: 'artifact', entityId: 'a' });
  useLcosShellStore.getState().setComposerPrompt('保留草稿');
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); roots.push(root);
  let closed = 0;
  await act(async () => root.render(<LcosComposerHost projectId="project-a" workspaceId="workspace-a" anchor={null} open inline onClose={() => { closed++; }} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="从画布添加引用"]')?.click());
  expect(useLcosReferenceStore.getState().referencePickOwner).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(closed).toBe(0); expect(useLcosReferenceStore.getState().referencePickOwner).toBeNull();
  expect(useLcosShellStore.getState().composerPrompt).toBe('保留草稿'); expect(state.orderedNodeReferences()).toHaveLength(1);
  expect(document.activeElement).toBe(host.querySelector('textarea'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(closed).toBe(1);
});

it('explains unsupported task references before send and lets the user remove them without losing the prompt', async () => {
  const refs = useLcosReferenceStore.getState(); refs.setProject('project-a');
  refs.addEntityToDraft({ entityType: 'artifact', entityId: 'image', revisionId: 'r1', mimeType: 'image/png', displayLabel: '参考图片' });
  const shell = useLcosShellStore.getState();
  shell.openComposer({ nodeId: 'node', title: '任务', anchor: { x: 0, y: 0, width: 1, height: 1 }, intent: 'delegate' });
  shell.setComposerPrompt('保留这段创作要求');
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); roots.push(root);
  await act(async () => root.render(<LcosComposerHost projectId="project-a" workspaceId="workspace-a" anchor={null} open inline onClose={() => {}} />));
  expect(host.querySelector('[data-lcos-composer-reference-blocked]')?.textContent).toContain('当前任务暂不能读取图片');
  expect(host.querySelector<HTMLButtonElement>('button[title*="当前任务暂不能读取"]')?.disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除引用 参考图片"]')!.click());
  expect(host.querySelector('[data-lcos-composer-reference-blocked]')).toBeNull();
  expect(useLcosReferenceStore.getState().draft.orderedEntityRefs).toHaveLength(0);
  expect(useLcosShellStore.getState().composerPrompt).toBe('保留这段创作要求');
});
