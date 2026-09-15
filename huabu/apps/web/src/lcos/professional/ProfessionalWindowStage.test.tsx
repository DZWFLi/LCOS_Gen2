import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';

import { ProfessionalWindowStage } from './ProfessionalWindowStage';
import { useLcosShellStore } from '../shell/lcosShellStore';

vi.mock('./ArtifactReaderBody', () => ({ ArtifactReaderBody: () => null }));
vi.mock('./AssemblyBody', () => ({ AssemblyBody: () => null }));
vi.mock('./PortalPreviewBody', () => ({ PortalPreviewBody: () => null }));
vi.mock('./ConversationWorkViewBody', () => ({ ConversationWorkViewBody: InlineComposerFixture }));

// Reproduce the production child's Escape registration using the real Huabu hook.
function InlineComposerFixture({ connectedConversationId }: { connectedConversationId?: string }) {
  const open = useLcosShellStore((s) => s.composerOpen && s.composerTarget?.receiverConversationId === connectedConversationId);
  useCloseOnEscape(open, () => useLcosShellStore.getState().closeComposer());
  return <div data-composer-open={open} />;
}
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useLcosShellStore.getState().clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function escape() {
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
}
it('closes the inline Composer first and keeps its Work View until the next Escape', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('conversation', '会话', 'conversation-a');
  store.openComposer({ nodeId: 'n', title: '会话', receiverConversationId: 'conversation-a', anchor: { x: 0, y: 0, width: 1, height: 1 } });
  store.setComposerPrompt('保留这份草稿');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  await escape();
  expect(useLcosShellStore.getState().composerOpen).toBe(false);
  expect(useLcosShellStore.getState().composerPrompt).toBe('保留这份草稿');
  expect(useLcosShellStore.getState().windows).toHaveLength(1);
  await escape();
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
});
it('does not let a hidden Composer for another conversation block closing the current window', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('conversation', '会话 B', 'b');
  store.openComposer({ nodeId: 'n', title: 'A', receiverConversationId: 'a', anchor: { x: 0, y: 0, width: 1, height: 1 } });
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));
  await escape();
  expect(useLcosShellStore.getState().windows).toHaveLength(0);
});
