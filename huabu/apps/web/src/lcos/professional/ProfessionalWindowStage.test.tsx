import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { useCloseOnEscape } from '@/hooks/useCloseOnEscape';

import { ProfessionalWindowStage } from './ProfessionalWindowStage';
import { useLcosShellStore } from '../shell/lcosShellStore';

vi.mock('./ArtifactReaderBody', () => ({
  ArtifactReaderBody: ({ artifactId }: { artifactId?: string }) => <div data-reader-artifact={artifactId} />,
}));
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
it('renders every independent region and publishes every region as occupied', async () => {
  const store = useLcosShellStore.getState();
  store.openWindow('reader', '材料 A', 'artifact-a');
  store.openWindow('reader', '材料 B', 'artifact-b');
  await act(async () => root.render(<ProfessionalWindowStage projectId="p" />));

  expect(host.querySelectorAll('[data-lcos-professional-stage]')).toHaveLength(1);
  const regions = host.querySelectorAll('[data-lcos-window-region-id]');
  expect(regions).toHaveLength(2);
  expect((regions[0] as HTMLElement | undefined)?.style.left).not.toBe((regions[1] as HTMLElement | undefined)?.style.left);
  expect(new Set(Array.from(regions, (element) => element.getAttribute('data-lcos-window-region-id')))).toEqual(
    new Set(useLcosShellStore.getState().windowRegions.map((region) => region.id)),
  );
  expect(host.querySelectorAll('[data-reader-artifact]')).toHaveLength(2);
  expect(useLcosShellStore.getState().windowEnvironment?.occupiedRects).toHaveLength(2);
  expect(useLcosShellStore.getState().windowEnvironment?.activeRegionId).toBe(
    useLcosShellStore.getState().windowRegions[1]?.id,
  );
});
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
